# Langfuse Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backlog-#9 eval harness: production tracing of `/api/chat` plus an offline `npm run eval` that scores retrieval, citation integrity, and LLM-judged answer quality against a Langfuse golden dataset, with a committed-baseline regression gate.

**Architecture:** Extract prompt assembly from the chat route into `src/lib/answerPipeline.ts` (one code path for prod and eval). Instrument the route with Langfuse v5 OTel tracing (silent no-op without keys). A tsx runner executes each golden-dataset item through the real pipeline via `dataset.runExperiment()`, computes deterministic metrics + an in-repo Claude judge, pushes scores to Langfuse, and diffs aggregates against `eval/baseline.json` (non-zero exit on regression).

**Tech Stack:** Next.js 14 (App Router, `src/`), TypeScript 5, Vitest 2 (jsdom, module-boundary mocks), `@anthropic-ai/sdk` ^0.40, Langfuse SDK v5 (`@langfuse/tracing`, `@langfuse/otel`, `@langfuse/client` — all ^5.9), `@opentelemetry/sdk-trace-node` + `@opentelemetry/sdk-node`, `tsx` runner, Node 24.

## Global Constraints

- Spec: `spec/eval-harness/spec.md`. Deviations must be reconciled in the spec, not silently.
- `/api/chat` behavior byte-identical after extraction: system blocks (incl. `cache_control` placement), streaming, `X-Sources` header. Existing `src/app/api/chat/route.test.ts` must keep passing **unmodified**.
- App fully functional with no `LANGFUSE_*` keys set. No new required env vars.
- `npm run test:run` stays offline — every external boundary mocked via `vi.mock`; no test reads real API keys. `npm run eval` is never part of the quality gate.
- Chat model stays `claude-sonnet-4-6`, max_tokens 1024. Judge default `claude-sonnet-4-6`, override via `EVAL_JUDGE_MODEL` (mirrors `DIGEST_MODEL` pattern).
- Langfuse env var names (v5): `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` (EU cloud `https://cloud.langfuse.com`). NOT `LANGFUSE_BASEURL`/`LANGFUSE_HOST`.
- Next 14 has **no stable `after()`** — flush Langfuse in the route's stream `finally`, and `await sdk.shutdown()` in scripts.
- Quality gate before every push: `npm run lint && npm run typecheck && npm run test:run`.
- Tests colocate as `src/**/*.test.ts`; Vitest picks up only `src/**` — scripts stay thin orchestrators with logic in `src/lib/eval/`.
- Commit after every task (conventional commits, `feat(eval):` / `refactor(chat):` / `docs(eval):`).

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/answerPipeline.ts` (new) | Prompt assembly: `prepareAnswerContext()`, `buildRetrievedBlock()`, `CHAT_MODEL`, `CHAT_MAX_TOKENS` |
| `src/app/api/chat/route.ts` (modify) | Thin streaming wrapper + tracing + flush |
| `src/lib/langfuse.ts` (new) | Guarded singleton: `langfuseEnabled()`, `getLangfuseProcessor()`, `flushLangfuse()` |
| `src/instrumentation.ts` (new) | Next.js `register()` — OTel provider when keys set |
| `next.config.js` (modify) | `experimental.instrumentationHook: true` |
| `src/lib/eval/dataset.ts` (new) | `EvalItem` types, `questionId()`, `mergeCandidates()`, `EVAL_DATASET_NAME` |
| `src/lib/eval/retrievalMetrics.ts` (new) | `scoreRetrieval()` — recall/precision/MRR/offtopic |
| `src/lib/eval/citationMetrics.ts` (new) | `scoreCitations()` — in-range/coverage/glue round-trip |
| `src/lib/eval/judge.ts` (new) | `buildJudgePrompt()`, `parseJudgeJson()`, `judgeAnswer()` |
| `src/lib/eval/baseline.ts` (new) | `diffAgainstBaseline()`, `toBaseline()`, `formatDiffTable()` |
| `scripts/eval/seedDataset.ts` (new) | digest.questions[] → `eval/dataset.json` candidates |
| `scripts/eval/pushDataset.ts` (new) | curated items → Langfuse dataset `rag-golden` |
| `scripts/eval/run.ts` (new) | experiment runner: pipeline → metrics → judge → scores → baseline diff |
| `scripts/eval/accept.ts` (new) | `eval/last-run.json` → `eval/baseline.json` |
| `eval/dataset.json`, `eval/baseline.json`, `eval/last-run.json` | Committed dataset + baseline; last-run is gitignored |
| `spec/eval-harness/langfuse-setup.md` (new) | Managed-evaluator UI setup steps |

---

### Task 1: Extract `answerPipeline.ts` from the chat route

**Files:**
- Create: `src/lib/answerPipeline.ts`
- Create: `src/lib/answerPipeline.test.ts`
- Modify: `src/app/api/chat/route.ts`

**Interfaces:**
- Consumes: `retrieveArticles` (`src/lib/retrieval.ts:21`), `getGroundingContext` (`src/lib/scraper.ts:576`)
- Produces (later tasks import these):
  - `CHAT_MODEL: string` (= `'claude-sonnet-4-6'`), `CHAT_MAX_TOKENS: number` (= `1024`)
  - `buildRetrievedBlock(retrieved: RetrievedArticle[]): string`
  - `prepareAnswerContext(messages: unknown): Promise<AnswerContext>` where `AnswerContext = { system: SystemBlock[]; retrieved: RetrievedArticle[] }` and `SystemBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/answerPipeline.test.ts`. It mirrors the block-shape assertions of the existing route tests, but against the extracted function:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getGroundingContextMock } = vi.hoisted(() => ({ getGroundingContextMock: vi.fn() }));
vi.mock('@/lib/scraper', () => ({ getGroundingContext: getGroundingContextMock }));

const { retrieveArticlesMock } = vi.hoisted(() => ({ retrieveArticlesMock: vi.fn() }));
vi.mock('@/lib/retrieval', () => ({ retrieveArticles: retrieveArticlesMock }));

import { prepareAnswerContext, CHAT_MODEL, CHAT_MAX_TOKENS } from './answerPipeline';

const retrieved = (slug: string, body = 'FULL BODY') => ({
  slug, title: `Title ${slug}`, url: `https://claude.com/blog/${slug}`,
  pubDate: '', description: '', body, summary: 'sum', heroImage: '', similarity: 0.9,
});

beforeEach(() => {
  getGroundingContextMock.mockReset().mockResolvedValue('GROUNDING_MARKER');
  retrieveArticlesMock.mockReset().mockResolvedValue([]);
});

describe('prepareAnswerContext', () => {
  it('exports the prod model constants', () => {
    expect(CHAT_MODEL).toBe('claude-sonnet-4-6');
    expect(CHAT_MAX_TOKENS).toBe(1024);
  });

  it('no retrieval → single cached grounding block', async () => {
    const { system, retrieved: r } = await prepareAnswerContext([{ role: 'user', content: 'hi' }]);
    expect(r).toEqual([]);
    expect(system).toHaveLength(1);
    expect(system[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } });
    expect(system[0].text).toContain('GROUNDING_MARKER');
  });

  it('retrieval hit → appends uncached [Source n] block with capped bodies', async () => {
    retrieveArticlesMock.mockResolvedValue([retrieved('post-a', 'A'.repeat(9_000)), retrieved('post-b')]);
    const { system, retrieved: r } = await prepareAnswerContext([
      { role: 'assistant', content: 'earlier' },
      { role: 'user', content: 'tell me about MCP' },
    ]);
    expect(retrieveArticlesMock).toHaveBeenCalledWith('tell me about MCP');
    expect(r.map((x) => x.slug)).toEqual(['post-a', 'post-b']);
    expect(system).toHaveLength(2);
    expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(system[1].cache_control).toBeUndefined();
    expect(system[1].text).toContain('[Source 1] Title post-a');
    expect(system[1].text).toContain('inline marker like [1]');
    expect(system[1].text).not.toContain('A'.repeat(8_001));
  });

  it('embeds the LATEST user message', async () => {
    await prepareAnswerContext([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'second' },
    ]);
    expect(retrieveArticlesMock).toHaveBeenCalledWith('second');
  });

  it('non-array messages → retrieves with empty question', async () => {
    await prepareAnswerContext(undefined);
    expect(retrieveArticlesMock).toHaveBeenCalledWith('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/answerPipeline.test.ts`
Expected: FAIL — `Cannot find module './answerPipeline'` (or equivalent resolve error).

- [ ] **Step 3: Create `src/lib/answerPipeline.ts`**

Move code out of `src/app/api/chat/route.ts` **verbatim** (the system-prompt template string, `BODY_EXCERPT_CAP`, `buildRetrievedBlock`, the last-user-message extraction, and the system-array assembly). Do not reword the prompt — byte-identical output is a hard constraint.

```ts
/**
 * Prompt assembly for the chat answer (spec/eval-harness): ONE code path
 * consumed by both the streaming route and the offline eval runner.
 */
import { getGroundingContext } from '@/lib/scraper';
import { retrieveArticles, type RetrievedArticle } from '@/lib/retrieval';

export const CHAT_MODEL = 'claude-sonnet-4-6';
export const CHAT_MAX_TOKENS = 1024;

// Per-article body excerpt in the retrieved block. 3 × 8k chars ≈ 6k tokens —
// comfortable headroom, and real depth vs the 700-char summaries in block 1.
const BODY_EXCERPT_CAP = 8_000;

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface AnswerContext {
  system: SystemBlock[];
  retrieved: RetrievedArticle[];
}

export function buildRetrievedBlock(retrieved: RetrievedArticle[]): string {
  // ← moved UNCHANGED from route.ts:12-21
}

export async function prepareAnswerContext(messages: unknown): Promise<AnswerContext> {
  const lastUser = Array.isArray(messages)
    ? [...messages].reverse().find((m) => m?.role === 'user')
    : undefined;
  const retrieved = await retrieveArticles(
    typeof lastUser?.content === 'string' ? lastUser.content : '',
  );

  const articleContext = await getGroundingContext();

  const systemPrompt = `...`; // ← the ENTIRE template moved UNCHANGED from route.ts:35-82

  const system: SystemBlock[] = [
    { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    ...(retrieved.length > 0 ? [{ type: 'text' as const, text: buildRetrievedBlock(retrieved) }] : []),
  ];

  return { system, retrieved };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/answerPipeline.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Slim the route to a thin wrapper**

`src/app/api/chat/route.ts` becomes:

```ts
import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { prepareAnswerContext, CHAT_MODEL, CHAT_MAX_TOKENS } from '@/lib/answerPipeline';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { messages } = await req.json();
  const { system, retrieved } = await prepareAnswerContext(messages);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const messageStream = client.messages.stream({
          model: CHAT_MODEL,
          max_tokens: CHAT_MAX_TOKENS,
          system,
          messages,
        });
        for await (const chunk of messageStream) {
          if (chunk.type === 'message_start' && process.env.NODE_ENV !== 'production') {
            const u = chunk.message.usage;
            console.log('[chat] cache usage', {
              cache_read: u.cache_read_input_tokens,
              cache_creation: u.cache_creation_input_tokens,
              input: u.input_tokens,
            });
          }
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
      } catch (err) {
        console.error('[chat] Stream error:', err);
        controller.enqueue(encoder.encode('Sorry, an error occurred. Please try again.'));
      } finally {
        controller.close();
      }
    },
  });

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
  };
  if (retrieved.length > 0) headers['X-Sources'] = retrieved.map((r) => r.slug).join(',');
  return new Response(stream, { headers });
}
```

Note: the `system` param now has our `SystemBlock[]` type — if `tsc` complains against the SDK's `TextBlockParam`, cast at the call site with `system: system as Anthropic.TextBlockParam[]` rather than weakening `SystemBlock`.

- [ ] **Step 6: Run the FULL existing route suite + quality gate**

Run: `npx vitest run src/app/api/chat/route.test.ts` → Expected: PASS, all 8 tests, file **unmodified** (its `vi.mock` of `@/lib/scraper` and `@/lib/retrieval` intercepts the same modules transitively through `answerPipeline`).
Run: `npm run lint && npm run typecheck && npm run test:run` → Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/answerPipeline.ts src/lib/answerPipeline.test.ts src/app/api/chat/route.ts
git commit -m "refactor(chat): extract prompt assembly into answerPipeline (eval-harness step 1)"
```

---

### Task 2: Langfuse client, instrumentation, and no-op degradation

**Files:**
- Create: `src/lib/langfuse.ts`, `src/lib/langfuse.test.ts`, `src/instrumentation.ts`
- Modify: `next.config.js`, `package.json` (deps), `.env.example`

**Interfaces:**
- Produces:
  - `langfuseEnabled(): boolean` — true iff `LANGFUSE_PUBLIC_KEY` && `LANGFUSE_SECRET_KEY`
  - `getLangfuseProcessor(): LangfuseSpanProcessor | null` — singleton, null when disabled
  - `flushLangfuse(): Promise<void>` — never throws
- Consumed by: Task 3 (route flush), instrumentation.

- [ ] **Step 1: Install dependencies**

```bash
npm install @langfuse/tracing@^5.9.1 @langfuse/otel@^5.9.1 @langfuse/client@^5.9.1 @opentelemetry/sdk-trace-node @opentelemetry/sdk-node
npm install -D tsx
```

Expected: clean install, no peer warnings blocking (Node 24 satisfies the SDK's Node 20+ floor).

- [ ] **Step 2: Write the failing test**

Create `src/lib/langfuse.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('langfuse guarded client', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
  });

  it('disabled without keys: no processor, flush resolves silently', async () => {
    const { langfuseEnabled, getLangfuseProcessor, flushLangfuse } = await import('./langfuse');
    expect(langfuseEnabled()).toBe(false);
    expect(getLangfuseProcessor()).toBeNull();
    await expect(flushLangfuse()).resolves.toBeUndefined(); // no throw, no network
  });

  it('enabled with keys: returns a memoized processor', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-lf-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-lf-test';
    const { langfuseEnabled, getLangfuseProcessor } = await import('./langfuse');
    expect(langfuseEnabled()).toBe(true);
    const p = getLangfuseProcessor();
    expect(p).not.toBeNull();
    expect(getLangfuseProcessor()).toBe(p);
  });

  it('flush never throws even if the processor rejects', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-lf-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-lf-test';
    const { getLangfuseProcessor, flushLangfuse } = await import('./langfuse');
    const p = getLangfuseProcessor()!;
    vi.spyOn(p, 'forceFlush').mockRejectedValue(new Error('network down'));
    await expect(flushLangfuse()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/langfuse.test.ts`
Expected: FAIL — module `./langfuse` not found.

- [ ] **Step 4: Implement `src/lib/langfuse.ts`**

```ts
/**
 * Guarded Langfuse singleton (spec/eval-harness): mirrors the embeddings.ts
 * degradation pattern — no LANGFUSE_* keys ⇒ everything is a silent no-op and
 * the app behaves exactly as before this feature existed.
 */
import { LangfuseSpanProcessor } from '@langfuse/otel';

export function langfuseEnabled(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

let processor: LangfuseSpanProcessor | null = null;

export function getLangfuseProcessor(): LangfuseSpanProcessor | null {
  if (!langfuseEnabled()) return null;
  if (!processor) processor = new LangfuseSpanProcessor();
  return processor;
}

/** Flush pending events; never throws into the caller (chat path safety). */
export async function flushLangfuse(): Promise<void> {
  try {
    await processor?.forceFlush();
  } catch (err) {
    console.warn('[langfuse] flush failed:', err);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/langfuse.test.ts` → Expected: PASS (3 tests).

- [ ] **Step 6: Create `src/instrumentation.ts` and enable the hook**

```ts
/**
 * Next.js instrumentation hook: registers the OTel tracer provider with the
 * Langfuse span processor — only in the Node runtime and only when keys exist.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { langfuseEnabled, getLangfuseProcessor } = await import('@/lib/langfuse');
  if (!langfuseEnabled()) return;
  const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
  const provider = new NodeTracerProvider({ spanProcessors: [getLangfuseProcessor()!] });
  provider.register();
}
```

`next.config.js`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { instrumentationHook: true },
};
module.exports = nextConfig;
```

- [ ] **Step 7: Add env vars to `.env.example`**

Append:

```bash
# Langfuse (spec/eval-harness) — tracing + offline evals. OPTIONAL: unset ⇒ no
# tracing, app behaves exactly as before. EU cloud; create keys in project settings.
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=https://cloud.langfuse.com

# Judge model override for npm run eval (default claude-sonnet-4-6).
# EVAL_JUDGE_MODEL=claude-sonnet-4-6
```

- [ ] **Step 8: Quality gate + boot check**

Run: `npm run lint && npm run typecheck && npm run test:run` → all green.
Run: `npm run build` → Expected: builds; instrumentation compiled without errors. (Do NOT run while `next dev` is live — shared `.next/`.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/langfuse.ts src/lib/langfuse.test.ts src/instrumentation.ts next.config.js .env.example package.json package-lock.json
git commit -m "feat(eval): Langfuse v5 client + instrumentation with no-op degradation"
```

---

### Task 3: Trace the chat route (retrieval + generation spans)

**Files:**
- Modify: `src/app/api/chat/route.ts`
- Modify: `spec/eval-harness/spec.md` (one line — see Step 4)

**Interfaces:**
- Consumes: `startObservation` (`@langfuse/tracing`), `flushLangfuse` (Task 2), `RETRIEVAL_K`, `SIM_FLOOR` (`src/lib/retrieval.ts`)
- Produces: trace shape `chat` → span `retrieval` + generation `generation` (names used by the managed evaluator in Task 12).

- [ ] **Step 1: Add tracing to the route**

Without a registered provider (no keys / tests), OTel spans are non-recording — zero behavior change, so existing tests stay green. Modify `route.ts`:

```ts
import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { startObservation } from '@langfuse/tracing';
import { prepareAnswerContext, CHAT_MODEL, CHAT_MAX_TOKENS } from '@/lib/answerPipeline';
import { RETRIEVAL_K, SIM_FLOOR } from '@/lib/retrieval';
import { flushLangfuse } from '@/lib/langfuse';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  const lastUser = Array.isArray(messages)
    ? [...messages].reverse().find((m) => m?.role === 'user')
    : undefined;
  const question = typeof lastUser?.content === 'string' ? lastUser.content : '';

  const root = startObservation('chat', { input: { question } });
  const retrievalSpan = root.startObservation('retrieval', { input: { question } });
  const { system, retrieved } = await prepareAnswerContext(messages);
  retrievalSpan
    .update({
      output: { slugs: retrieved.map((r) => r.slug), similarities: retrieved.map((r) => r.similarity) },
      metadata: { k: RETRIEVAL_K, simFloor: SIM_FLOOR },
    })
    .end();

  const generation = root.startObservation(
    'generation',
    { model: CHAT_MODEL, input: { question } },
    { asType: 'generation' },
  );

  const encoder = new TextEncoder();
  let answerText = '';
  let usage: { input?: number; output?: number; cacheRead?: number } = {};

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const messageStream = client.messages.stream({
          model: CHAT_MODEL,
          max_tokens: CHAT_MAX_TOKENS,
          system,
          messages,
        });
        for await (const chunk of messageStream) {
          if (chunk.type === 'message_start') {
            const u = chunk.message.usage;
            usage = { input: u.input_tokens, cacheRead: u.cache_read_input_tokens ?? 0 };
            if (process.env.NODE_ENV !== 'production') {
              console.log('[chat] cache usage', {
                cache_read: u.cache_read_input_tokens,
                cache_creation: u.cache_creation_input_tokens,
                input: u.input_tokens,
              });
            }
          }
          if (chunk.type === 'message_delta' && chunk.usage) {
            usage.output = chunk.usage.output_tokens;
          }
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            answerText += chunk.delta.text;
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
      } catch (err) {
        console.error('[chat] Stream error:', err);
        controller.enqueue(encoder.encode('Sorry, an error occurred. Please try again.'));
      } finally {
        try {
          generation
            .update({
              output: answerText,
              usageDetails: { input: usage.input ?? 0, output: usage.output ?? 0, cache_read_input_tokens: usage.cacheRead ?? 0 },
            })
            .end();
          root.update({ output: { answer: answerText, sources: retrieved.map((r) => r.slug) } }).end();
          await flushLangfuse(); // stream is still open ⇒ serverless fn still alive; Next 14 has no after()
        } catch (err) {
          console.warn('[langfuse] trace finalize failed:', err);
        }
        controller.close();
      }
    },
  });

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
  };
  if (retrieved.length > 0) headers['X-Sources'] = retrieved.map((r) => r.slug).join(',');
  return new Response(stream, { headers });
}
```

API note: v5 span objects returned by `startObservation` expose `.startObservation(name, attrs, opts)` for explicit children, `.update(attrs)` (chainable) and `.end()`. If the installed version only creates children from *active* context (compile error on `root.startObservation`), fall back to `startObservation('retrieval', {...}, { parentSpanContext: root.otelSpan.spanContext() })` — check `node_modules/@langfuse/tracing/dist/index.d.ts` for the exact child-creation surface and keep the trace→span/generation nesting.

- [ ] **Step 2: Run the existing route suite**

Run: `npx vitest run src/app/api/chat/route.test.ts`
Expected: PASS unmodified — no keys in tests ⇒ non-recording spans; `flushLangfuse` resolves as no-op.

- [ ] **Step 3: Quality gate**

Run: `npm run lint && npm run typecheck && npm run test:run` → all green.

- [ ] **Step 4: Reconcile the spec's flush wording**

In `spec/eval-harness/spec.md`, section "2. Langfuse client + prod tracing", replace the line:

`- Serverless flush: events flushed via `after()` (Next.js) so responses are never delayed; tracing errors are caught and logged, never thrown into the chat path.`

with:

`- Serverless flush: Next 14 has no stable `after()` — events flush in the stream's `finally` (the function is still alive while the stream is open), so responses are never delayed; tracing errors are caught and logged, never thrown into the chat path.`

- [ ] **Step 5: Live verification (needs LANGFUSE_* keys in `.env.local`)**

Run: `npm run dev`, send one chat message in the UI, stop dev. Open Langfuse → Traces.
Expected: one `chat` trace with a `retrieval` span (slugs + similarities in output) and a `generation` observation (model, token usage, full answer text). If keys are not available yet, defer this check to Task 12's DoD sweep — do not block the commit.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/chat/route.ts spec/eval-harness/spec.md
git commit -m "feat(eval): trace chat route with retrieval + generation spans"
```

---

### Task 4: Eval dataset types + merge logic

**Files:**
- Create: `src/lib/eval/dataset.ts`, `src/lib/eval/dataset.test.ts`

**Interfaces:**
- Produces (used by Tasks 5–11):
  - `EVAL_DATASET_NAME = 'rag-golden'`
  - `type EvalKind = 'single' | 'multi' | 'offtopic'`
  - `interface EvalItem { id: string; question: string; expectedSlugs: string[]; kind: EvalKind; curated: boolean }`
  - `questionId(question: string): string` — stable djb2-base36 hash of the normalized question
  - `mergeCandidates(existing: EvalItem[], candidates: EvalItem[]): EvalItem[]` — existing items untouched (hand-edits preserved), new candidates appended

- [ ] **Step 1: Write the failing test**

Create `src/lib/eval/dataset.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { questionId, mergeCandidates, type EvalItem } from './dataset';

const item = (q: string, over: Partial<EvalItem> = {}): EvalItem => ({
  id: questionId(q), question: q, expectedSlugs: ['post-a'], kind: 'single', curated: false, ...over,
});

describe('questionId', () => {
  it('is stable and insensitive to case/whitespace', () => {
    expect(questionId('What is MCP?')).toBe(questionId('  what is mcp?  '));
  });
  it('differs for different questions', () => {
    expect(questionId('What is MCP?')).not.toBe(questionId('What is RAG?'));
  });
});

describe('mergeCandidates', () => {
  it('appends only unseen candidates', () => {
    const existing = [item('q1')];
    const merged = mergeCandidates(existing, [item('q1'), item('q2')]);
    expect(merged.map((i) => i.question)).toEqual(['q1', 'q2']);
  });
  it('never mutates existing items (curated flags and labels preserved)', () => {
    const curated = item('q1', { curated: true, expectedSlugs: ['hand-fixed'], kind: 'multi' });
    const merged = mergeCandidates([curated], [item('q1')]);
    expect(merged[0]).toEqual(curated);
    expect(merged).toHaveLength(1);
  });
  it('empty existing → all candidates', () => {
    expect(mergeCandidates([], [item('q1'), item('q2')])).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/eval/dataset.test.ts` → Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/lib/eval/dataset.ts`**

```ts
/**
 * Golden eval dataset types + pure merge logic (spec/eval-harness §3).
 * Seeding/pushing scripts stay thin; everything testable lives here.
 */
export const EVAL_DATASET_NAME = 'rag-golden';

export type EvalKind = 'single' | 'multi' | 'offtopic';

export interface EvalItem {
  /** Stable hash of the normalized question — upsert key locally and in Langfuse. */
  id: string;
  question: string;
  /** Expected retrieval slugs; empty for offtopic items. */
  expectedSlugs: string[];
  kind: EvalKind;
  /** Seeded candidates start false; only curated items are pushed to Langfuse. */
  curated: boolean;
}

/** djb2 over the normalized question, base36 (same scheme as digest.contentHash). */
export function questionId(question: string): string {
  const input = question.replace(/\s+/g, ' ').trim().toLowerCase();
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** Existing items win (hand-edits preserved); unseen candidates are appended. */
export function mergeCandidates(existing: EvalItem[], candidates: EvalItem[]): EvalItem[] {
  const seen = new Set(existing.map((i) => i.id));
  return [...existing, ...candidates.filter((c) => !seen.has(c.id))];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/eval/dataset.test.ts` → Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/eval/dataset.ts src/lib/eval/dataset.test.ts
git commit -m "feat(eval): dataset item types + hand-edit-preserving merge"
```

---

### Task 5: Seed script + curated dataset + push script

**Files:**
- Create: `scripts/eval/seedDataset.ts`, `scripts/eval/pushDataset.ts`, `eval/dataset.json`
- Modify: `package.json` (scripts), `.gitignore` (add `eval/last-run.json`)

**Interfaces:**
- Consumes: `getClaudeArticles` (`src/lib/scraper.ts:437`), `getArticleDigests` (`src/lib/digest.ts:109`), Task 4's `EvalItem`/`questionId`/`mergeCandidates`/`EVAL_DATASET_NAME`, `articleSlug` (`src/lib/parseAnswer.ts:96`)
- Produces: `eval/dataset.json` — a JSON array of `EvalItem`; Langfuse dataset `rag-golden` with items `{ input: { question }, expectedOutput: { slugs }, metadata: { kind } }` and item `id = EvalItem.id`.

- [ ] **Step 1: Write `scripts/eval/seedDataset.ts`**

```ts
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

  const existing: EvalItem[] = existsSync(DATASET_PATH)
    ? JSON.parse(readFileSync(DATASET_PATH, 'utf8'))
    : [];
  const merged = mergeCandidates(existing, candidates);

  mkdirSync('eval', { recursive: true });
  writeFileSync(DATASET_PATH, JSON.stringify(merged, null, 2) + '\n');
  console.log(
    `[eval:seed] ${merged.length} items total (${merged.length - existing.length} new candidates, ` +
    `${merged.filter((i) => i.curated).length} curated)`,
  );
}

main().catch((err) => { console.error('[eval:seed] failed:', err); process.exit(1); });
```

- [ ] **Step 2: Write `scripts/eval/pushDataset.ts`**

```ts
/**
 * Push curated items to the Langfuse dataset (spec/eval-harness §3).
 * Upserts by item id; only curated items go up. Run: npm run eval:push
 */
import { readFileSync } from 'node:fs';
import { LangfuseClient } from '@langfuse/client';
import { EVAL_DATASET_NAME, type EvalItem } from '@/lib/eval/dataset';

async function main() {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    console.error('[eval:push] LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY required');
    process.exit(1);
  }
  const items: EvalItem[] = JSON.parse(readFileSync('eval/dataset.json', 'utf8'));
  const curated = items.filter((i) => i.curated);
  if (curated.length === 0) {
    console.error('[eval:push] no curated items — edit eval/dataset.json first');
    process.exit(1);
  }

  const langfuse = new LangfuseClient();
  try {
    await langfuse.api.datasets.create({ name: EVAL_DATASET_NAME, description: 'RAG golden set (spec/eval-harness)' });
    console.log(`[eval:push] created dataset ${EVAL_DATASET_NAME}`);
  } catch {
    // already exists — fine, we upsert items below
  }

  for (const item of curated) {
    await langfuse.dataset.createItem({
      datasetName: EVAL_DATASET_NAME,
      id: item.id, // stable id ⇒ re-push upserts instead of duplicating
      input: { question: item.question },
      expectedOutput: { slugs: item.expectedSlugs },
      metadata: { kind: item.kind },
    });
  }
  console.log(`[eval:push] upserted ${curated.length} curated items to ${EVAL_DATASET_NAME}`);
}

main().catch((err) => { console.error('[eval:push] failed:', err); process.exit(1); });
```

- [ ] **Step 3: Wire package.json scripts + tsx path support**

`tsx` doesn't resolve `@/*` by itself — add `tsconfig-paths` style resolution via tsx's built-in tsconfig support (tsx reads `compilerOptions.paths` natively since v4). Add to `package.json` scripts:

```json
"eval:seed": "tsx --env-file-if-exists=.env.local scripts/eval/seedDataset.ts",
"eval:push": "tsx --env-file-if-exists=.env.local scripts/eval/pushDataset.ts"
```

Add `eval/last-run.json` to `.gitignore` (Task 9 writes it; only `dataset.json` and `baseline.json` are committed).

Sanity check tsx alias resolution now: `npx tsx -e "import('./src/lib/eval/dataset.ts').then(m => console.log(m.EVAL_DATASET_NAME))"` → prints `rag-golden`. If `@/` imports fail at Step 4, install `tsconfig-paths` and change scripts to `tsx --env-file-if-exists=.env.local -r tsconfig-paths/register ...` — do whichever works, but scripts must keep `@/` imports (consistency with src/).

- [ ] **Step 4: Seed for real**

Run: `npm run eval:seed`
Expected: `eval/dataset.json` created with ~40–70 candidate items (24 articles × 2–3 questions), all `"curated": false`, each labeled with its source slug. Requires `ANTHROPIC_API_KEY` (digest misses) and optionally `DATABASE_URL` in `.env.local`.

- [ ] **Step 5: Curate the dataset (the human-quality pass)**

Edit `eval/dataset.json` to produce **20–30 items with `"curated": true`**:
1. Pick the ~15–20 best single-source candidates: self-contained questions whose answer clearly lives in exactly that article. Fix any wrong `expectedSlugs`.
2. Add **≥3 `multi` items** by hand — questions spanning ≥2 articles, e.g. comparing two product launches; set `expectedSlugs` to both slugs, `kind: "multi"`, `curated: true`. Compute each `id` with: `npx tsx -e "import('./src/lib/eval/dataset.ts').then(m => console.log(m.questionId(process.argv[1])))" "your question here"`.
3. Add **≥3 `offtopic` items** by hand — questions the KB cannot answer ("What's a good pasta recipe?", "Who won the 2022 World Cup?", "How do I file taxes in Germany?"); `expectedSlugs: []`, `kind: "offtopic"`, `curated: true`.
4. Delete nothing — uncurated candidates stay for future rounds.

Expected after this step: `grep -c '"curated": true' eval/dataset.json` ≥ 20, including ≥3 multi and ≥3 offtopic.

- [ ] **Step 6: Push to Langfuse**

Run: `npm run eval:push`
Expected: `[eval:push] upserted N curated items to rag-golden`; items visible in the Langfuse UI under Datasets → rag-golden with kind metadata. Re-running does not duplicate (stable ids).

- [ ] **Step 7: Quality gate + commit**

Run: `npm run lint && npm run typecheck && npm run test:run` → all green.

```bash
git add scripts/eval/seedDataset.ts scripts/eval/pushDataset.ts eval/dataset.json package.json .gitignore
git commit -m "feat(eval): golden dataset — seed from digests, curate, push to Langfuse"
```

---

### Task 6: Retrieval metrics

**Files:**
- Create: `src/lib/eval/retrievalMetrics.ts`, `src/lib/eval/retrievalMetrics.test.ts`

**Interfaces:**
- Consumes: `EvalKind` (Task 4)
- Produces: `scoreRetrieval(expectedSlugs: string[], retrievedSlugs: string[], kind: EvalKind): Record<string, number>` — keys `retrieval.recall` / `retrieval.precision` / `retrieval.mrr` for single/multi, `retrieval.offtopic_pass` for offtopic. All values in [0, 1].

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { scoreRetrieval } from './retrievalMetrics';

describe('scoreRetrieval — single/multi', () => {
  it('perfect hit at rank 1', () => {
    expect(scoreRetrieval(['a'], ['a', 'x', 'y'], 'single')).toEqual({
      'retrieval.recall': 1, 'retrieval.precision': 1 / 3, 'retrieval.mrr': 1,
    });
  });
  it('hit at rank 3 → mrr 1/3', () => {
    expect(scoreRetrieval(['a'], ['x', 'y', 'a'], 'single')['retrieval.mrr']).toBeCloseTo(1 / 3);
  });
  it('multi: one of two expected found', () => {
    const s = scoreRetrieval(['a', 'b'], ['a', 'x', 'y'], 'multi');
    expect(s['retrieval.recall']).toBeCloseTo(0.5);
    expect(s['retrieval.precision']).toBeCloseTo(1 / 3);
    expect(s['retrieval.mrr']).toBe(1);
  });
  it('total miss → all zeros', () => {
    expect(scoreRetrieval(['a'], ['x', 'y'], 'single')).toEqual({
      'retrieval.recall': 0, 'retrieval.precision': 0, 'retrieval.mrr': 0,
    });
  });
  it('empty retrieval on an expected question → zeros, no NaN', () => {
    expect(scoreRetrieval(['a'], [], 'single')).toEqual({
      'retrieval.recall': 0, 'retrieval.precision': 0, 'retrieval.mrr': 0,
    });
  });
  it('slug-order independence of recall/precision', () => {
    const a = scoreRetrieval(['a', 'b'], ['b', 'a'], 'multi');
    expect(a['retrieval.recall']).toBe(1);
    expect(a['retrieval.precision']).toBe(1);
  });
});

describe('scoreRetrieval — offtopic inversion', () => {
  it('passes when nothing retrieved', () => {
    expect(scoreRetrieval([], [], 'offtopic')).toEqual({ 'retrieval.offtopic_pass': 1 });
  });
  it('fails when anything retrieved', () => {
    expect(scoreRetrieval([], ['a'], 'offtopic')).toEqual({ 'retrieval.offtopic_pass': 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/eval/retrievalMetrics.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
/** Deterministic retrieval scoring (spec/eval-harness §4, metric group 1). */
import type { EvalKind } from './dataset';

export function scoreRetrieval(
  expectedSlugs: string[],
  retrievedSlugs: string[],
  kind: EvalKind,
): Record<string, number> {
  if (kind === 'offtopic') {
    return { 'retrieval.offtopic_pass': retrievedSlugs.length === 0 ? 1 : 0 };
  }

  const expected = new Set(expectedSlugs);
  const hits = retrievedSlugs.filter((s) => expected.has(s));

  const recall = expected.size === 0 ? 0 : hits.length / expected.size;
  const precision = retrievedSlugs.length === 0 ? 0 : hits.length / retrievedSlugs.length;
  const firstHit = retrievedSlugs.findIndex((s) => expected.has(s));
  const mrr = firstHit === -1 ? 0 : 1 / (firstHit + 1);

  return { 'retrieval.recall': recall, 'retrieval.precision': precision, 'retrieval.mrr': mrr };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/eval/retrievalMetrics.test.ts` → PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/eval/retrievalMetrics.ts src/lib/eval/retrievalMetrics.test.ts
git commit -m "feat(eval): retrieval metrics — recall/precision/MRR + offtopic inversion"
```

---

### Task 7: Citation integrity metrics

**Files:**
- Create: `src/lib/eval/citationMetrics.ts`, `src/lib/eval/citationMetrics.test.ts`

**Interfaces:**
- Consumes: `glueCitations`, `CITATION_SENTINEL_RE` (`src/lib/parseAnswer.ts:193-205`)
- Produces: `scoreCitations(answer: string, retrievedCount: number): Record<string, number>` — keys `citations.in_range` (1/0), `citations.coverage` (0–1, omitted when `retrievedCount === 0`), `citations.glue_roundtrip` (1/0).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { scoreCitations } from './citationMetrics';

describe('scoreCitations — in_range', () => {
  it('all markers within source count → 1', () => {
    expect(scoreCitations('Claim [1]. Other [2].', 2)['citations.in_range']).toBe(1);
  });
  it('marker above source count → 0', () => {
    expect(scoreCitations('Claim [3].', 2)['citations.in_range']).toBe(0);
  });
  it('marker [0] is out of range → 0', () => {
    expect(scoreCitations('Claim [0].', 2)['citations.in_range']).toBe(0);
  });
  it('no retrieval: any marker fails, none passes', () => {
    expect(scoreCitations('Claim [1].', 0)['citations.in_range']).toBe(0);
    expect(scoreCitations('Plain answer.', 0)['citations.in_range']).toBe(1);
  });
  it('no markers with sources available → in_range 1 (valid, just uncited)', () => {
    expect(scoreCitations('Plain answer.', 2)['citations.in_range']).toBe(1);
  });
});

describe('scoreCitations — coverage', () => {
  it('both sources cited → 1; one of two → 0.5', () => {
    expect(scoreCitations('A [1] and B [2].', 2)['citations.coverage']).toBe(1);
    expect(scoreCitations('A [1] only.', 2)['citations.coverage']).toBe(0.5);
  });
  it('duplicate markers count once', () => {
    expect(scoreCitations('A [1], again [1].', 2)['citations.coverage']).toBe(0.5);
  });
  it('omitted when nothing was retrieved', () => {
    expect('citations.coverage' in scoreCitations('Plain.', 0)).toBe(false);
  });
});

describe('scoreCitations — glue round-trip (read-aloud alignment invariant)', () => {
  it('every marker survives gluing as a sentinel', () => {
    expect(scoreCitations('Claim [1]. Adjacent [1][2].', 2)['citations.glue_roundtrip']).toBe(1);
  });
  it('no markers → trivially 1', () => {
    expect(scoreCitations('Plain.', 2)['citations.glue_roundtrip']).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/eval/citationMetrics.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Deterministic citation-integrity scoring (spec/eval-harness §4, group 2).
 * Reuses the REAL display-path transforms from parseAnswer.ts so the eval
 * guards the same glue/strip invariant the read-aloud alignment depends on.
 */
import { glueCitations, CITATION_SENTINEL_RE } from '@/lib/parseAnswer';

const MARKER_RE = /\[(\d{1,2})\]/g;

export function scoreCitations(answer: string, retrievedCount: number): Record<string, number> {
  const markers = [...answer.matchAll(MARKER_RE)].map((m) => Number(m[1]));

  const inRange =
    retrievedCount === 0
      ? markers.length === 0
      : markers.every((n) => n >= 1 && n <= retrievedCount);

  const glued = glueCitations(answer);
  const sentinelCount = [...glued.matchAll(new RegExp(CITATION_SENTINEL_RE.source, 'g'))].length;
  const glueRoundtrip = sentinelCount === markers.length;

  const scores: Record<string, number> = {
    'citations.in_range': inRange ? 1 : 0,
    'citations.glue_roundtrip': glueRoundtrip ? 1 : 0,
  };
  if (retrievedCount > 0) {
    scores['citations.coverage'] = new Set(markers.filter((n) => n >= 1 && n <= retrievedCount)).size / retrievedCount;
  }
  return scores;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/eval/citationMetrics.test.ts` → PASS (9 tests).
Note: the "Adjacent [1][2]" case exercises `glueCitations`' adjacent-marker loop — if it fails, the bug is in the metric, not parseAnswer (parseAnswer has its own suite).

- [ ] **Step 5: Commit**

```bash
git add src/lib/eval/citationMetrics.ts src/lib/eval/citationMetrics.test.ts
git commit -m "feat(eval): citation integrity metrics reusing parseAnswer transforms"
```

---

### Task 8: LLM judge

**Files:**
- Create: `src/lib/eval/judge.ts`, `src/lib/eval/judge.test.ts`

**Interfaces:**
- Consumes: `@anthropic-ai/sdk` (caller passes the client — keeps the module import-safe without keys)
- Produces:
  - `EVAL_JUDGE_MODEL: string`
  - `interface JudgeVerdict { scores: Record<string, number>; rationales: Record<string, string> }` — score keys `judge.groundedness`, `judge.citation_faithfulness`, `judge.relevance`, `judge.pedagogy`, values 1–5
  - `buildJudgePrompt(question: string, sourcesBlock: string, answer: string): string`
  - `parseJudgeJson(text: string): JudgeVerdict | null`
  - `judgeAnswer(client: Anthropic, args: { question: string; sourcesBlock: string; answer: string }): Promise<JudgeVerdict | null>` — one retry on unparseable output, null after that (failed item, never throws)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { buildJudgePrompt, parseJudgeJson, judgeAnswer } from './judge';

const VALID = JSON.stringify({
  groundedness: { score: 4, rationale: 'mostly grounded' },
  citation_faithfulness: { score: 5, rationale: 'citations accurate' },
  relevance: { score: 5, rationale: 'on topic' },
  pedagogy: { score: 3, rationale: 'a bit dense' },
});

function fakeClient(replies: string[]): Anthropic {
  const create = vi.fn();
  for (const r of replies) create.mockResolvedValueOnce({ content: [{ type: 'text', text: r }] });
  return { messages: { create } } as unknown as Anthropic;
}

describe('buildJudgePrompt', () => {
  it('contains the question, sources, and answer verbatim', () => {
    const p = buildJudgePrompt('Q_MARK', 'SRC_MARK', 'ANS_MARK');
    expect(p).toContain('Q_MARK');
    expect(p).toContain('SRC_MARK');
    expect(p).toContain('ANS_MARK');
    expect(p).toContain('groundedness');
    expect(p).toContain('ONLY');
  });
});

describe('parseJudgeJson', () => {
  it('parses a valid verdict into namespaced scores', () => {
    const v = parseJudgeJson(VALID)!;
    expect(v.scores['judge.groundedness']).toBe(4);
    expect(v.scores['judge.pedagogy']).toBe(3);
    expect(v.rationales['judge.groundedness']).toBe('mostly grounded');
  });
  it('tolerates a ```json fence around the object', () => {
    expect(parseJudgeJson('```json\n' + VALID + '\n```')).not.toBeNull();
  });
  it('rejects out-of-range scores and missing keys', () => {
    expect(parseJudgeJson(VALID.replace('"score": 4', '"score": 9'))).toBeNull();
    expect(parseJudgeJson('{"groundedness": {"score": 4, "rationale": "x"}}')).toBeNull();
    expect(parseJudgeJson('not json at all')).toBeNull();
  });
});

describe('judgeAnswer', () => {
  const args = { question: 'q', sourcesBlock: 's', answer: 'a' };
  beforeEach(() => vi.restoreAllMocks());

  it('returns verdict on first valid reply', async () => {
    const v = await judgeAnswer(fakeClient([VALID]), args);
    expect(v?.scores['judge.relevance']).toBe(5);
  });
  it('retries once on malformed output, then succeeds', async () => {
    const client = fakeClient(['garbage', VALID]);
    const v = await judgeAnswer(client, args);
    expect(v).not.toBeNull();
    expect((client.messages.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });
  it('returns null after two malformed replies (failed item, no throw)', async () => {
    const v = await judgeAnswer(fakeClient(['garbage', 'more garbage']), args);
    expect(v).toBeNull();
  });
  it('returns null when the API call itself throws', async () => {
    const client = { messages: { create: vi.fn().mockRejectedValue(new Error('boom')) } } as unknown as Anthropic;
    expect(await judgeAnswer(client, { question: 'q', sourcesBlock: 's', answer: 'a' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/eval/judge.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement `src/lib/eval/judge.ts`**

```ts
/**
 * In-repo LLM judge (spec/eval-harness §4, group 3): 4 rubric dimensions,
 * 1–5 each, strict JSON out, one retry, null on failure (never throws).
 * The rubric is version-controlled here on purpose — PR-reviewable.
 */
import type Anthropic from '@anthropic-ai/sdk';

export const EVAL_JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? 'claude-sonnet-4-6';
const JUDGE_MAX_TOKENS = 800;

const DIMENSIONS = ['groundedness', 'citation_faithfulness', 'relevance', 'pedagogy'] as const;

export interface JudgeVerdict {
  /** Keys: judge.groundedness, judge.citation_faithfulness, judge.relevance, judge.pedagogy — values 1–5. */
  scores: Record<string, number>;
  rationales: Record<string, string>;
}

export function buildJudgePrompt(question: string, sourcesBlock: string, answer: string): string {
  return `You are a strict evaluation judge for an AI news tutor. The tutor answered a question using ONLY the source excerpts below (numbered [Source n]); inline [n] markers in the answer cite those sources.

Score the ANSWER on four dimensions, each an integer 1 (very poor) to 5 (excellent):
- groundedness: are the answer's claims supported by the provided excerpts, not outside knowledge? Unsupported claims lower the score.
- citation_faithfulness: does each [n] marker cite a source that actually supports the sentence it follows? Wrong or decorative citations lower the score. If the answer has no markers, judge whether that is appropriate (e.g. nothing was retrieved).
- relevance: does the answer address the question that was asked?
- pedagogy: is it clear, well structured, and pitched at a tutor-appropriate depth?

Return ONLY a JSON object — no markdown, no code fence, no preamble — exactly this shape:
{"groundedness":{"score":N,"rationale":"one sentence"},"citation_faithfulness":{"score":N,"rationale":"one sentence"},"relevance":{"score":N,"rationale":"one sentence"},"pedagogy":{"score":N,"rationale":"one sentence"}}

QUESTION:
${question}

SOURCE EXCERPTS:
${sourcesBlock || '(nothing was retrieved for this question)'}

ANSWER:
${answer}`;
}

/** Pull the JSON object out of the reply, tolerating a ```json fence (same pattern as digest.ts). */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

export function parseJudgeJson(text: string): JudgeVerdict | null {
  try {
    const parsed: unknown = JSON.parse(extractJson(text));
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, { score?: unknown; rationale?: unknown }>;
    const scores: Record<string, number> = {};
    const rationales: Record<string, string> = {};
    for (const dim of DIMENSIONS) {
      const entry = obj[dim];
      const score = entry?.score;
      if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) return null;
      scores[`judge.${dim}`] = score;
      rationales[`judge.${dim}`] = typeof entry.rationale === 'string' ? entry.rationale : '';
    }
    return { scores, rationales };
  } catch {
    return null;
  }
}

export async function judgeAnswer(
  client: Anthropic,
  args: { question: string; sourcesBlock: string; answer: string },
): Promise<JudgeVerdict | null> {
  const prompt = buildJudgePrompt(args.question, args.sourcesBlock, args.answer);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await client.messages.create({
        model: EVAL_JUDGE_MODEL,
        max_tokens: JUDGE_MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(' ');
      const verdict = parseJudgeJson(text);
      if (verdict) return verdict;
    } catch (err) {
      console.error('[eval:judge] call failed:', err);
      return null;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/eval/judge.test.ts` → PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/eval/judge.ts src/lib/eval/judge.test.ts
git commit -m "feat(eval): 4-dimension LLM judge with strict JSON + one retry"
```

---

### Task 9: Baseline diff + gate logic

**Files:**
- Create: `src/lib/eval/baseline.ts`, `src/lib/eval/baseline.test.ts`

**Interfaces:**
- Produces (used by run.ts / accept.ts):
  - `interface BaselineFile { runName: string; acceptedAt: string; metrics: Record<string, { value: number; tolerance: number }> }`
  - `interface DiffRow { metric: string; baseline: number | null; current: number; delta: number | null; verdict: 'ok' | 'FAIL' | 'new' }`
  - `defaultTolerance(metric: string): number` — `judge.*` → 0.3, everything else → 0.02
  - `diffAgainstBaseline(baseline: BaselineFile | null, current: Record<string, number>): { rows: DiffRow[]; failed: boolean }`
  - `toBaseline(runName: string, acceptedAt: string, current: Record<string, number>): BaselineFile`
  - `formatDiffTable(rows: DiffRow[]): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { diffAgainstBaseline, toBaseline, defaultTolerance, formatDiffTable, type BaselineFile } from './baseline';

const base: BaselineFile = {
  runName: 'eval-abc123-1',
  acceptedAt: 'abc123',
  metrics: {
    'retrieval.recall': { value: 0.9, tolerance: 0.02 },
    'judge.groundedness': { value: 4.2, tolerance: 0.3 },
  },
};

describe('defaultTolerance', () => {
  it('judge metrics get 0.3, deterministic get 0.02', () => {
    expect(defaultTolerance('judge.pedagogy')).toBe(0.3);
    expect(defaultTolerance('retrieval.mrr')).toBe(0.02);
    expect(defaultTolerance('citations.in_range')).toBe(0.02);
  });
});

describe('diffAgainstBaseline', () => {
  it('within tolerance → ok, no failure', () => {
    const { rows, failed } = diffAgainstBaseline(base, { 'retrieval.recall': 0.89, 'judge.groundedness': 4.0 });
    expect(failed).toBe(false);
    expect(rows.every((r) => r.verdict === 'ok')).toBe(true);
  });
  it('exactly at tolerance boundary → ok', () => {
    expect(diffAgainstBaseline(base, { 'retrieval.recall': 0.88, 'judge.groundedness': 3.9 }).failed).toBe(false);
  });
  it('just below tolerance → FAIL with exit-worthy flag', () => {
    const { rows, failed } = diffAgainstBaseline(base, { 'retrieval.recall': 0.87, 'judge.groundedness': 4.2 });
    expect(failed).toBe(true);
    expect(rows.find((r) => r.metric === 'retrieval.recall')?.verdict).toBe('FAIL');
  });
  it('improvement → ok', () => {
    expect(diffAgainstBaseline(base, { 'retrieval.recall': 1, 'judge.groundedness': 5 }).failed).toBe(false);
  });
  it('metric absent from baseline → verdict "new", never fails', () => {
    const { rows, failed } = diffAgainstBaseline(base, {
      'retrieval.recall': 0.9, 'judge.groundedness': 4.2, 'citations.coverage': 0.5,
    });
    expect(failed).toBe(false);
    expect(rows.find((r) => r.metric === 'citations.coverage')?.verdict).toBe('new');
  });
  it('no baseline file → all rows "new", never fails', () => {
    const { rows, failed } = diffAgainstBaseline(null, { 'retrieval.recall': 0.1 });
    expect(failed).toBe(false);
    expect(rows[0].verdict).toBe('new');
  });
});

describe('toBaseline / formatDiffTable', () => {
  it('stamps default tolerances per metric family', () => {
    const b = toBaseline('run-1', 'sha1', { 'judge.relevance': 4.5, 'retrieval.mrr': 0.8 });
    expect(b.metrics['judge.relevance'].tolerance).toBe(0.3);
    expect(b.metrics['retrieval.mrr'].tolerance).toBe(0.02);
  });
  it('renders one aligned row per metric with verdicts', () => {
    const { rows } = diffAgainstBaseline(base, { 'retrieval.recall': 0.8, 'judge.groundedness': 4.2 });
    const table = formatDiffTable(rows);
    expect(table).toContain('retrieval.recall');
    expect(table).toContain('FAIL');
    expect(table).toContain('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/eval/baseline.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement `src/lib/eval/baseline.ts`**

```ts
/**
 * Baseline regression gate (spec/eval-harness §5): committed aggregates with
 * per-metric tolerances; regression = current < baseline − tolerance.
 * All metrics are higher-is-better by construction.
 */
export interface BaselineFile {
  runName: string;
  /** git SHA at accept time. */
  acceptedAt: string;
  metrics: Record<string, { value: number; tolerance: number }>;
}

export interface DiffRow {
  metric: string;
  baseline: number | null;
  current: number;
  delta: number | null;
  verdict: 'ok' | 'FAIL' | 'new';
}

/** Judge scores are LLM-noisy (1–5 scale) → 0.3; deterministic 0–1 metrics → 0.02. */
export function defaultTolerance(metric: string): number {
  return metric.startsWith('judge.') ? 0.3 : 0.02;
}

export function diffAgainstBaseline(
  baseline: BaselineFile | null,
  current: Record<string, number>,
): { rows: DiffRow[]; failed: boolean } {
  const rows: DiffRow[] = [];
  let failed = false;

  for (const [metric, value] of Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) {
    const base = baseline?.metrics[metric];
    if (!base) {
      rows.push({ metric, baseline: null, current: value, delta: null, verdict: 'new' });
      continue;
    }
    const delta = value - base.value;
    const isFail = value < base.value - base.tolerance - 1e-9; // epsilon: boundary counts as ok
    if (isFail) failed = true;
    rows.push({ metric, baseline: base.value, current: value, delta, verdict: isFail ? 'FAIL' : 'ok' });
  }

  return { rows, failed };
}

export function toBaseline(
  runName: string,
  acceptedAt: string,
  current: Record<string, number>,
): BaselineFile {
  const metrics: BaselineFile['metrics'] = {};
  for (const [metric, value] of Object.entries(current)) {
    metrics[metric] = { value, tolerance: defaultTolerance(metric) };
  }
  return { runName, acceptedAt, metrics };
}

export function formatDiffTable(rows: DiffRow[]): string {
  const fmt = (n: number | null) => (n === null ? '—' : n.toFixed(3));
  const header = ['metric'.padEnd(28), 'baseline'.padEnd(10), 'current'.padEnd(10), 'Δ'.padEnd(9), 'verdict'].join(' ');
  const lines = rows.map((r) =>
    [r.metric.padEnd(28), fmt(r.baseline).padEnd(10), fmt(r.current).padEnd(10), fmt(r.delta).padEnd(9), r.verdict].join(' '),
  );
  return [header, ...lines].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/eval/baseline.test.ts` → PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/eval/baseline.ts src/lib/eval/baseline.test.ts
git commit -m "feat(eval): baseline diff gate with per-family tolerances"
```

---

### Task 10: The eval runner

**Files:**
- Create: `scripts/eval/run.ts`
- Modify: `package.json` (script `eval`)

**Interfaces:**
- Consumes: everything — `prepareAnswerContext`/`buildRetrievedBlock`/`CHAT_MODEL`/`CHAT_MAX_TOKENS` (Task 1), `EVAL_DATASET_NAME` (Task 4), `scoreRetrieval` (Task 6), `scoreCitations` (Task 7), `judgeAnswer` (Task 8), `diffAgainstBaseline`/`formatDiffTable` (Task 9), `dataset.runExperiment` (`@langfuse/client`), `NodeSDK` + `LangfuseSpanProcessor`.
- Produces: `eval/last-run.json` — `{ runName, sha, timestamp, itemCount, failedCount, aggregates: Record<string, number> }` (consumed by Task 11's accept script). Exit code 0 (ok / no baseline) or 1 (regression or >20% failed items).

- [ ] **Step 1: Write `scripts/eval/run.ts`**

```ts
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

  // kind lookup by question (metadata isn't passed to evaluators)
  const kindByQuestion = new Map<string, EvalKind>(
    dataset.items.map((i) => [
      (i.input as { question: string }).question,
      ((i.metadata as { kind?: EvalKind } | null)?.kind ?? 'single') as EvalKind,
    ]),
  );

  let failedCount = 0;
  const perItemScores: Record<string, number>[] = [];

  const result = await dataset.runExperiment({
    name: 'rag-quality',
    runName,
    description: `spec/eval-harness offline run @ ${sha}`,
    maxConcurrency: 3, // gentle on Voyage + Anthropic + pooler (reads only)
    metadata: { chatModel: CHAT_MODEL, sha },
    task: async (item): Promise<TaskOutput> => {
      const question = (item.input as { question: string }).question;
      const expected = (item.expectedOutput as { slugs: string[] } | null)?.slugs ?? [];
      const kind = kindByQuestion.get(question) ?? 'single';
      try {
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
  for (const [metric, { total, n }] of sums) aggregates[metric] = total / n;

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
  if (failed) {
    console.error('\n[eval] REGRESSION vs baseline ' + baseline.runName + ' — fix or explicitly re-bless with npm run eval:accept');
    process.exit(1);
  }
  console.log('\n[eval] ok — no regression vs ' + baseline.runName);
  process.exit(0);
}

main().catch((err) => { console.error('[eval] fatal:', err); process.exit(1); });
```

API note (same guard as Task 3): if `runExperiment`'s evaluator signature rejects an array return, register four thin evaluators that each pluck one metric family from `output.scores`. Check `node_modules/@langfuse/client/dist/index.d.ts` for `ExperimentTask` / evaluator types before fighting the compiler.

- [ ] **Step 2: Add the npm script**

```json
"eval": "tsx --env-file-if-exists=.env.local scripts/eval/run.ts"
```

- [ ] **Step 3: Quality gate (offline)**

Run: `npm run lint && npm run typecheck && npm run test:run` → all green (runner has no unit tests; its logic lives in the tested `src/lib/eval/` modules).

- [ ] **Step 4: First live run**

Run: `npm run eval`
Expected:
- console shows item count + run name, then the experiment format output
- Langfuse UI → Datasets → rag-golden → Runs shows the run with per-item traces, deterministic scores, and judge scores with rationale comments
- stdout ends with the metric table, all rows `new`, and `no baseline yet — run npm run eval:accept`
- exit code 0; `eval/last-run.json` written

- [ ] **Step 5: Commit**

```bash
git add scripts/eval/run.ts package.json
git commit -m "feat(eval): experiment runner — pipeline, metrics, judge, Langfuse scores"
```

---

### Task 11: `eval:accept` + regression-gate proof

**Files:**
- Create: `scripts/eval/accept.ts`, `eval/baseline.json` (generated + committed)
- Modify: `package.json` (script)

**Interfaces:**
- Consumes: `eval/last-run.json` (Task 10), `toBaseline` (Task 9)
- Produces: committed `eval/baseline.json`.

- [ ] **Step 1: Write `scripts/eval/accept.ts`**

```ts
/**
 * Bless the latest eval run as the regression baseline (spec/eval-harness §5).
 * Deliberate, reviewable: the resulting eval/baseline.json diff goes in a PR.
 * Run: npm run eval:accept
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { toBaseline } from '@/lib/eval/baseline';

const LAST_RUN_PATH = 'eval/last-run.json';
const BASELINE_PATH = 'eval/baseline.json';

if (!existsSync(LAST_RUN_PATH)) {
  console.error('[eval:accept] no eval/last-run.json — run `npm run eval` first');
  process.exit(1);
}
const last = JSON.parse(readFileSync(LAST_RUN_PATH, 'utf8')) as {
  runName: string; sha: string; aggregates: Record<string, number>;
};
writeFileSync(BASELINE_PATH, JSON.stringify(toBaseline(last.runName, last.sha, last.aggregates), null, 2) + '\n');
console.log(`[eval:accept] baseline ← ${last.runName} (${Object.keys(last.aggregates).length} metrics). Review + commit eval/baseline.json.`);
```

- [ ] **Step 2: Add the npm script**

```json
"eval:accept": "tsx scripts/eval/accept.ts"
```

- [ ] **Step 3: Accept the first baseline**

Run: `npm run eval:accept` → `eval/baseline.json` written with values + tolerances.
Run: `npm run eval` again → Expected: diff table with `ok` verdicts (judge noise inside 0.3), exit 0.

- [ ] **Step 4: Prove the gate catches a real regression (spec DoD)**

1. In `src/lib/retrieval.ts`, temporarily change `SIM_FLOOR = 0.35` → `0.9`.
2. Run `npm run eval` → Expected: `retrieval.recall` / `retrieval.mrr` rows show `FAIL`, readable diff table, **exit code 1** (`echo $?`).
3. Revert `SIM_FLOOR` to `0.35`. Run `npm run eval` → exit 0.

- [ ] **Step 5: Quality gate + commit**

Run: `npm run lint && npm run typecheck && npm run test:run` → all green.

```bash
git add scripts/eval/accept.ts eval/baseline.json package.json
git commit -m "feat(eval): baseline accept flow + first blessed baseline"
```

---

### Task 12: Managed evaluator setup doc + project docs

**Files:**
- Create: `spec/eval-harness/langfuse-setup.md`
- Modify: `README.md`, `CLAUDE.md`, `spec/eval-harness/spec.md` (status line)

- [ ] **Step 1: Write `spec/eval-harness/langfuse-setup.md`**

Document the UI-side setup (no code), with these exact sections — fill in real screenshots/values while performing them:

```markdown
# Langfuse setup — managed evaluator on prod traces

One-time UI configuration (spec/eval-harness §6). SDK/keys setup lives in .env.example.

## 1. Project + keys
- cloud.langfuse.com → New project `ai-tutor` (EU region).
- Project settings → API keys → create pk/sk pair → `.env.local` + Vercel env vars
  (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL=https://cloud.langfuse.com`).

## 2. LLM connection (for managed evaluators)
- Project settings → LLM connections → Add → provider **Anthropic**, paste ANTHROPIC_API_KEY.

## 3. Groundedness evaluator on sampled prod traces
- Evaluators → New evaluator → template **Groundedness** (RAG category).
- Target: **traces**, filter `name = chat`, sampling **10–20%** (start 10%; raise once volume is known).
- Variable mapping: query → trace input.question · generation → trace output.answer ·
  context → observation `retrieval` output.slugs (or the generation input, whichever the template accepts).
- Model: the Anthropic connection from step 2 (claude-sonnet-4-6).
- Save; verify a score appears on a fresh prod trace within a few minutes.

## 4. Where things live in the UI
- Traces: every prod chat turn (`chat` → `retrieval` span + `generation`).
- Datasets → rag-golden: golden items + runs (one per `npm run eval`), scores + judge rationales.
- Scores: managed-evaluator groundedness on sampled prod traces.
```

Perform the setup while writing it; adjust the variable-mapping line to whatever the template actually offers (UI wording drifts) and note any deviation in the doc.

- [ ] **Step 2: README.md**

Add an **Evals & observability** section after the RAG section: what the harness measures (3 metric groups), the four commands (`eval:seed`, `eval:push`, `eval`, `eval:accept`), the baseline-gate workflow (run before merging RAG-touching changes; `eval:accept` to re-bless deliberately), Langfuse env vars (optional, no-op without), and a link to `spec/eval-harness/spec.md`.

- [ ] **Step 3: CLAUDE.md**

- Stack line: add `Langfuse (tracing + evals; optional, off without LANGFUSE_* keys)`.
- Quality gate section: add one line — `npm run eval` (live-API eval vs Langfuse golden dataset) is **separate** from the gate; run it before merging changes that touch retrieval, prompts, or citations.

- [ ] **Step 4: Spec status**

In `spec/eval-harness/spec.md` change `**Status:** Spec approved, awaiting implementation plan` → `**Status:** Implemented (see plan.md)`.

- [ ] **Step 5: Final DoD sweep (spec Definition of Done table)**

Verify each row and fix anything missing:
- [ ] `npm run lint && npm run typecheck && npm run test:run` green
- [ ] `route.test.ts` unmodified and passing
- [ ] live chat turn → Langfuse trace with retrieval + generation spans + token usage (deferred check from Task 3 if keys arrived late)
- [ ] dataset ≥20 curated (≥3 multi, ≥3 offtopic) visible in Langfuse
- [ ] `npm run eval` run visible with per-item traces + scores + rationales
- [ ] SIM_FLOOR=0.9 experiment fails with readable table, revert passes (done in Task 11)
- [ ] `eval/baseline.json` committed
- [ ] managed evaluator scoring sampled prod traces
- [ ] README + CLAUDE.md updated

- [ ] **Step 6: Commit**

```bash
git add spec/eval-harness/langfuse-setup.md README.md CLAUDE.md spec/eval-harness/spec.md
git commit -m "docs(eval): managed evaluator setup + README/CLAUDE.md eval workflow"
```

---

## Post-plan notes for the executor

- **Live-API tasks:** Tasks 5 (seed/push), 10–11 (runs), and 12 (UI setup) need real keys in `.env.local` and spend tokens (cents per run). Everything else is offline.
- **Sequencing is strict:** 1 → 2 → 3 unlock prod tracing; 4 → 5 the dataset; 6–9 are independent of 5 (pure modules — parallelizable); 10 needs all of them; 11 needs 10; 12 last.
- **SDK drift guard:** two steps (Task 3 Step 1, Task 10 Step 1) include explicit fallbacks if the installed `@langfuse/*` 5.x minor differs from the researched API — check the package's `.d.ts` before improvising.
