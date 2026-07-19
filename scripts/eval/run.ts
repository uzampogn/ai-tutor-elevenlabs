/**
 * Offline eval runner (spec/eval-harness §4–5). Run: npm run eval
 * Requires: LANGFUSE_*, ANTHROPIC_API_KEY, VOYAGE_API_KEY, DATABASE_URL.
 * Never part of test:run — this spends real tokens (~25 gen + ~25 judge calls).
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { LangfuseClient } from '@langfuse/client';
import { prepareAnswerContext, buildRetrievedBlock, CHAT_MODEL, CHAT_MAX_TOKENS } from '@/lib/answerPipeline';
import { EVAL_DATASET_NAME, type EvalKind } from '@/lib/eval/dataset';
import { scoreRetrieval } from '@/lib/eval/retrievalMetrics';
import { scoreCitations } from '@/lib/eval/citationMetrics';
import { judgeAnswer } from '@/lib/eval/judge';
import { diffAgainstBaseline, formatDiffTable, type BaselineFile } from '@/lib/eval/baseline';

const REQUIRED_ENV = ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY', 'ANTHROPIC_API_KEY', 'VOYAGE_API_KEY'];
const MAX_FAILED_RATIO = 0.2;
const BASELINE_PATH = 'eval/baseline.json';
const LAST_RUN_PATH = 'eval/last-run.json';

interface TaskOutput {
  answer: string;
  retrievedSlugs: string[];
  scores: Record<string, number>;
  rationales: Record<string, string>;
  error?: string;
}

// Voyage free tier allows 3 requests/min and each item embeds its question once.
// maxConcurrency: 1 alone is not enough: fast items (offtopic → short answer,
// quick judge) can cycle in <20s, trip HTTP 429, and silently degrade retrieval
// to [] — contaminating recall/mrr. Enforce a hard floor between item starts so
// embeds never exceed ~2.4/min.
const MIN_ITEM_INTERVAL_MS = 25_000;
let lastItemStart = 0;
async function throttleItemStart(): Promise<void> {
  const wait = lastItemStart + MIN_ITEM_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastItemStart = Date.now();
}

async function main() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[eval] missing env vars: ${missing.join(', ')} (set them in .env.local)`);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    console.error('[eval] DATABASE_URL or POSTGRES_URL required (retrieval reads pgvector)');
    process.exit(1);
  }

  const sdk = new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] });
  sdk.start();

  const langfuse = new LangfuseClient();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const sha = execSync('git rev-parse --short HEAD').toString().trim();
  const runName = `eval-${sha}-${Date.now()}`;

  const dataset = await langfuse.dataset.get(EVAL_DATASET_NAME);
  console.log(`[eval] ${dataset.items.length} items · run ${runName} · judge+gen on live APIs`);

  let failedCount = 0;
  const perItemScores: Record<string, number>[] = [];

  const result = await dataset.runExperiment({
    name: 'rag-quality',
    runName,
    description: `spec/eval-harness offline run @ ${sha}`,
    maxConcurrency: 1, // serialized: Voyage free-tier is 3 RPM — per-item gen+judge pacing keeps embeds under the limit
    metadata: { chatModel: CHAT_MODEL, sha },
    task: async (item): Promise<TaskOutput> => {
      const question = (item.input as { question: string }).question;
      const expected = (item.expectedOutput as { slugs: string[] } | null)?.slugs ?? [];
      const kind = ((item.metadata as { kind?: EvalKind } | null)?.kind ?? 'single') as EvalKind;
      try {
        await throttleItemStart();
        const messages = [{ role: 'user' as const, content: question }];
        const { system, retrieved } = await prepareAnswerContext(messages);
        const stream = anthropic.messages.stream({
          model: CHAT_MODEL, max_tokens: CHAT_MAX_TOKENS, system, messages,
        });
        const final = await stream.finalMessage();
        const answer = final.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');

        const retrievedSlugs = retrieved.map((r) => r.slug);
        const scores: Record<string, number> = {
          ...scoreRetrieval(expected, retrievedSlugs, kind),
          ...scoreCitations(answer, retrieved.length),
        };
        let rationales: Record<string, string> = {};

        const sourcesBlock = retrieved.length > 0 ? buildRetrievedBlock(retrieved) : '';
        const verdict = await judgeAnswer(anthropic, { question, sourcesBlock, answer });
        if (verdict) {
          Object.assign(scores, verdict.scores);
          rationales = verdict.rationales;
        } else {
          failedCount++; // judge failure counts as a failed item (metrics still recorded)
        }

        perItemScores.push(scores);
        return { answer, retrievedSlugs, scores, rationales };
      } catch (err) {
        failedCount++;
        console.error(`[eval] item failed ("${question.slice(0, 60)}…"):`, err);
        return { answer: '', retrievedSlugs: [], scores: {}, rationales: {}, error: String(err) };
      }
    },
    evaluators: [
      async ({ output }) => {
        const o = output as TaskOutput;
        if (o.error) return [{ name: 'item_failed', value: 1, comment: o.error }];
        return Object.entries(o.scores).map(([name, value]) => ({
          name,
          value,
          comment: o.rationales[name],
        }));
      },
    ],
  });

  console.log(await result.format());

  // ---- aggregate → baseline gate -----------------------------------------
  const sums = new Map<string, { total: number; n: number }>();
  for (const scores of perItemScores) {
    for (const [metric, value] of Object.entries(scores)) {
      const e = sums.get(metric) ?? { total: 0, n: 0 };
      e.total += value; e.n += 1;
      sums.set(metric, e);
    }
  }
  const aggregates: Record<string, number> = {};
  for (const [metric, { total, n }] of Array.from(sums)) aggregates[metric] = total / n;

  mkdirSync('eval', { recursive: true });
  writeFileSync(LAST_RUN_PATH, JSON.stringify(
    { runName, sha, timestamp: new Date().toISOString(), itemCount: dataset.items.length, failedCount, aggregates },
    null, 2,
  ) + '\n');

  await sdk.shutdown(); // flush all traces/scores before verdict output

  const failedRatio = dataset.items.length === 0 ? 1 : failedCount / dataset.items.length;
  if (failedRatio > MAX_FAILED_RATIO) {
    console.error(`[eval] ${failedCount}/${dataset.items.length} items failed (> ${MAX_FAILED_RATIO * 100}%) — run incomplete, no baseline verdict`);
    process.exit(1);
  }

  const baseline: BaselineFile | null = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    : null;

  const { rows, failed } = diffAgainstBaseline(baseline, aggregates);
  console.log('\n' + formatDiffTable(rows));
  if (!baseline) {
    console.log('\n[eval] no baseline yet — run `npm run eval:accept` to bless this run');
    process.exit(0);
  }

  // diffAgainstBaseline silently drops any baseline metric absent from the
  // current aggregates, so a metric that stops being emitted would never trip
  // the gate. A missing metric IS a regression — surface it and fail the gate
  // (exit 1), alongside the tolerance-based regression check below.
  const dropped = Object.keys(baseline.metrics).filter((m) => !(m in aggregates));
  if (dropped.length > 0) {
    console.error(`[eval] baseline metric(s) absent from this run (no longer emitted — treated as a regression): ${dropped.join(', ')}`);
  }

  if (failed || dropped.length > 0) {
    console.error('\n[eval] REGRESSION vs baseline ' + baseline.runName + ' — fix or explicitly re-bless with npm run eval:accept');
    process.exit(1);
  }
  console.log('\n[eval] ok — no regression vs ' + baseline.runName);
  process.exit(0);
}

main().catch((err) => { console.error('[eval] fatal:', err); process.exit(1); });
