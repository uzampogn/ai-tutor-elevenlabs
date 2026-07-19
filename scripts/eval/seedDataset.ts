/**
 * Seed golden-dataset candidates from digest.questions[] (spec/eval-harness §3).
 * Idempotent: merges by question hash, never touches existing/hand-edited items.
 * Run: npm run eval:seed   (needs ANTHROPIC_API_KEY for digest cache misses)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { getClaudeArticles } from '@/lib/scraper';
import { getArticleDigests } from '@/lib/digest';
import { articleSlug } from '@/lib/parseAnswer';
import { mergeCandidates, questionId, type EvalItem } from '@/lib/eval/dataset';

const DATASET_PATH = 'eval/dataset.json';

async function main() {
  const articles = await getClaudeArticles();
  const digests = await getArticleDigests();

  const candidates: EvalItem[] = [];
  for (const a of articles) {
    const digest = digests[a.url];
    if (!digest) continue;
    for (const q of digest.questions) {
      candidates.push({
        id: questionId(q),
        question: q,
        expectedSlugs: [articleSlug(a.url)],
        kind: 'single',
        curated: false,
      });
    }
  }

  // mergeCandidates dedupes candidates against existing items but NOT within the
  // batch itself — two articles yielding the same normalized question would both
  // be appended under one id. Dedupe within the batch first (first wins).
  const seenInBatch = new Set<string>();
  const uniqueCandidates = candidates.filter((c) => {
    if (seenInBatch.has(c.id)) return false;
    seenInBatch.add(c.id);
    return true;
  });

  const existing: EvalItem[] = existsSync(DATASET_PATH)
    ? JSON.parse(readFileSync(DATASET_PATH, 'utf8'))
    : [];
  const merged = mergeCandidates(existing, uniqueCandidates);

  mkdirSync('eval', { recursive: true });
  writeFileSync(DATASET_PATH, JSON.stringify(merged, null, 2) + '\n');
  console.log(
    `[eval:seed] ${merged.length} items total (${merged.length - existing.length} new candidates, ` +
    `${merged.filter((i) => i.curated).length} curated)`,
  );
}

main().catch((err) => { console.error('[eval:seed] failed:', err); process.exit(1); });
