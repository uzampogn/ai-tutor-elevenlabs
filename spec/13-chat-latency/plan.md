# Chat Response Latency (B + C) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `/api/chat` from scraping/summarizing on the request path (B), and cache the large system prompt at the model (C), so the STT→response turn is fast and cheap — without touching the STT timer, the prompt text, or answer content.

**Architecture:** B adds a Vercel **Data Cache** layer (`unstable_cache`) in `src/lib/scraper.ts` — `getGroundingContext()` returns the assembled article context from a cross-instance cache, so even a cold `/api/chat` instance gets a hit instead of re-summarizing ~24 articles. The daily cron invalidates it via `revalidateTag('grounding')`; stale-while-revalidate keeps reads non-blocking. C wraps the existing `systemPrompt` string in a `cache_control: { type: 'ephemeral' }` content block so the stable prefix is cached at the model (lower TTFT every turn after the first), plus a dev-only cache-usage log.

**Tech Stack:** Next.js 14.2.5 (`unstable_cache` / `revalidateTag` from `next/cache`), `@anthropic-ai/sdk` 0.40.1 (`claude-sonnet-4-6`, streaming), TypeScript, Vitest. No new dependencies.

## Global Constraints

- **No STT / client change.** This plan touches only `src/lib/scraper.ts` and the `chat` / `scrape/refresh` API routes (+ their tests). The 2.5s STT silence timer stays as-is.
- **Grounding bytes unchanged.** `getGroundingContext()` must return exactly `buildArticleContext(await getClaudeArticles())` — same content, so answers and the cache prefix are byte-stable.
- **System-prompt text unchanged.** C wraps the existing string in a block; it does not edit the prompt. Parser / read-along invariants are untouched.
- **No new npm dependencies; no new hosted storage product; no new env vars.**
- **Versions:** Next **14.2.5** → use `unstable_cache` (not `'use cache'`); `@anthropic-ai/sdk` **0.40.1**.
- **Cache tag is the string `'grounding'`** (exported as `GROUNDING_TAG`); grounding revalidate window is **86400s** (daily).
- **Model stays `claude-sonnet-4-6`; summaries stay `claude-haiku-4-5`.** Streaming response protocol unchanged.
- **Quality gate (all must pass at the end):** `npm run typecheck`, `npm run test:run`, `npm run lint`.

---

### Task 1: Cross-instance grounding cache + cron revalidation (B, server side)

**Files:**
- Modify: `src/lib/scraper.ts` (add import at top; append new exports after `buildArticleContext`, EOF is line 484)
- Modify: `src/app/api/scrape/refresh/route.ts`
- Test: `src/app/api/scrape/refresh/route.test.ts` (extend)

**Interfaces:**
- Produces: `GROUNDING_TAG: 'grounding'` (const), `buildGroundingContext(): Promise<string>`, and `getGroundingContext: () => Promise<string>` (an `unstable_cache`-wrapped accessor) from `@/lib/scraper`. Task 2 consumes `getGroundingContext`; the refresh route consumes `GROUNDING_TAG`.

- [ ] **Step 1: Write the failing test** — extend the refresh route test with a `revalidateTag` mock.

Replace the entire contents of `src/app/api/scrape/refresh/route.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the scraper (route auth tested without scraping) and next/cache (assert revalidation).
const { getClaudeArticlesMock, getIngestionStatusMock, revalidateTagMock } = vi.hoisted(() => ({
  getClaudeArticlesMock: vi.fn(),
  getIngestionStatusMock: vi.fn(),
  revalidateTagMock: vi.fn(),
}));
vi.mock('@/lib/scraper', () => ({
  getClaudeArticles: getClaudeArticlesMock,
  getIngestionStatus: getIngestionStatusMock,
  GROUNDING_TAG: 'grounding',
}));
vi.mock('next/cache', () => ({
  revalidateTag: revalidateTagMock,
}));

import { GET } from './route';

const STATUS = {
  count: 24,
  lastSuccessfulFetch: '2026-06-16T00:00:00.000Z',
  ageMs: 0,
  stale: false,
  lastError: null,
};

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function req(authorization?: string): Request {
  return new Request('http://localhost/api/scrape/refresh', {
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  getClaudeArticlesMock.mockReset().mockResolvedValue([]);
  getIngestionStatusMock.mockReset().mockReturnValue(STATUS);
  revalidateTagMock.mockReset();
  process.env.CRON_SECRET = 'test-secret';
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe('GET /api/scrape/refresh', () => {
  it('401s without an Authorization header and does not scrape or revalidate', async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(getClaudeArticlesMock).not.toHaveBeenCalled();
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });

  it('401s with the wrong bearer token and does not scrape or revalidate', async () => {
    const res = await GET(req('Bearer wrong-token'));
    expect(res.status).toBe(401);
    expect(getClaudeArticlesMock).not.toHaveBeenCalled();
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });

  it('with the correct bearer, forces a re-scrape, revalidates the grounding cache, and returns status JSON', async () => {
    const res = await GET(req('Bearer test-secret'));
    expect(res.status).toBe(200);
    expect(getClaudeArticlesMock).toHaveBeenCalledWith({ force: true });
    expect(revalidateTagMock).toHaveBeenCalledWith('grounding');
    const body = await res.json();
    expect(body).toEqual(STATUS);
  });

  it('fails closed (401, no scrape, no revalidate) when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req('Bearer test-secret'));
    expect(res.status).toBe(401);
    expect(getClaudeArticlesMock).not.toHaveBeenCalled();
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/api/scrape/refresh/route.test.ts`
Expected: FAIL — the authorized-path test errors because `revalidateTag` is never called (and `GROUNDING_TAG` is not yet exported / imported by the route).

- [ ] **Step 3: Add the grounding-cache layer to `src/lib/scraper.ts`**

3a. Add the import at the top of the file, immediately after the existing `summarizeAll` import (line 2):

```ts
import { unstable_cache } from 'next/cache';
```

3b. Append to the **end** of the file (after `buildArticleContext`, after line 484):

```ts

// --- Cross-instance grounding cache (chat hot-path; see spec/chat-latency) ---
// /api/chat must never scrape or summarize on the request path. The module-level
// caches above are per-instance and empty on cold starts, so the assembled context
// is wrapped in Vercel's Data Cache (shared across function instances). Even a cold
// /api/chat instance then gets a cache hit instead of re-summarizing every article.

/** Cache tag for the assembled grounding context; the cron invalidates it via revalidateTag. */
export const GROUNDING_TAG = 'grounding';

// Daily time-based backstop. The /api/scrape/refresh cron is the primary refresh
// (it calls revalidateTag(GROUNDING_TAG)); this only bounds staleness if the cron is
// missed. Stale-while-revalidate means a read never blocks on the recompute.
const GROUNDING_REVALIDATE_SECONDS = 60 * 60 * 24;

/** Uncached assembly: scrape (cached fetches) + summaries + context build. Exported for testing. */
export async function buildGroundingContext(): Promise<string> {
  const articles = await getClaudeArticles();
  return buildArticleContext(articles);
}

/**
 * Cross-instance grounding context for the chat route. Backed by Vercel's Data Cache,
 * so every instance — including cold /api/chat starts — reads the assembled context
 * without re-scraping or re-summarizing. Refreshed daily (backstop) and on demand by
 * the cron via revalidateTag(GROUNDING_TAG).
 */
export const getGroundingContext = unstable_cache(
  buildGroundingContext,
  ['grounding-context'],
  { revalidate: GROUNDING_REVALIDATE_SECONDS, tags: [GROUNDING_TAG] },
);
```

- [ ] **Step 4: Wire the cron to invalidate the grounding cache** — rewrite `src/app/api/scrape/refresh/route.ts`:

```ts
import { revalidateTag } from 'next/cache';
import { getClaudeArticles, getIngestionStatus, GROUNDING_TAG } from '@/lib/scraper';

/**
 * Scheduled refresh endpoint (P0-4). Hit by Vercel Cron on a fixed cadence so the
 * knowledge base stays current without depending on organic traffic or a redeploy.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. We fail closed —
 * a missing/incorrect secret returns 401 and never triggers a scrape. The forced
 * re-scrape (and re-summarization of misses) runs here, so its cost/latency lands on
 * the cron, never on a user request. After scraping we invalidate the cross-instance
 * grounding cache (see spec/chat-latency) so /api/chat picks up fresh content on its
 * next read — refreshed off the user's turn, via stale-while-revalidate.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  await getClaudeArticles({ force: true });
  revalidateTag(GROUNDING_TAG);
  return Response.json(getIngestionStatus());
}

export const dynamic = 'force-dynamic';
```

- [ ] **Step 5: Run the refresh test to verify it passes**

Run: `npx vitest run src/app/api/scrape/refresh/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Confirm no module-load regression in the unmocked scraper suite**

Run: `npx vitest run src/lib/scraper.test.ts src/lib/summarize.test.ts`
Expected: PASS — adding the `unstable_cache(...)` wrapper at module top level must not break the existing scraper/summarize tests (the wrapped fn is created but never invoked there).

- [ ] **Step 7: Commit**

```bash
git add src/lib/scraper.ts src/app/api/scrape/refresh/route.ts src/app/api/scrape/refresh/route.test.ts
git commit -m "perf(chat): cross-instance grounding cache + cron revalidation"
```

---

### Task 2: `/api/chat` reads the cached grounding (B, hot path)

**Files:**
- Modify: `src/app/api/chat/route.ts:1-11`
- Test: `src/app/api/chat/route.test.ts` (create)

**Interfaces:**
- Consumes: `getGroundingContext` from `@/lib/scraper` (Task 1).
- Produces: a chat route that awaits `getGroundingContext()` for the `${articleContext}` injection and no longer imports or calls `getClaudeArticles` / `buildArticleContext`.

- [ ] **Step 1: Write the failing test** — create `src/app/api/chat/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { streamMock, getGroundingContextMock, getClaudeArticlesMock } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  getGroundingContextMock: vi.fn(),
  getClaudeArticlesMock: vi.fn(),
}));

// Mock the Anthropic SDK: default export is a class whose instances expose messages.stream.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: streamMock };
  },
}));
vi.mock('@/lib/scraper', () => ({
  getGroundingContext: getGroundingContextMock,
  getClaudeArticles: getClaudeArticlesMock,
}));

import { POST } from './route';

type Chunk = { type: string; delta?: { type: string; text: string } };

function fakeStream(chunks: Chunk[]) {
  return (async function* () {
    for (const c of chunks) yield c;
  })();
}

function post(messages: unknown[]) {
  const req = new Request('http://localhost/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages }),
  });
  return POST(req as unknown as NextRequest);
}

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

beforeEach(() => {
  streamMock.mockReset().mockReturnValue(
    fakeStream([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }]),
  );
  getGroundingContextMock.mockReset().mockResolvedValue('GROUNDING_MARKER');
  getClaudeArticlesMock.mockReset();
});

describe('POST /api/chat — grounding from the cached context', () => {
  it('injects getGroundingContext() and never scrapes on the request path', async () => {
    const res = await post([{ role: 'user', content: 'hi' }]);
    expect(res.status).toBe(200);
    expect(getGroundingContextMock).toHaveBeenCalledTimes(1);
    expect(getClaudeArticlesMock).not.toHaveBeenCalled();

    // Shape-agnostic so this assertion survives Task 3 (string today, block array after C).
    const sysArg = streamMock.mock.calls[0][0].system;
    const sysText = typeof sysArg === 'string' ? sysArg : sysArg[0].text;
    expect(sysText).toContain('GROUNDING_MARKER');
  });

  it('streams the model text deltas back to the client', async () => {
    streamMock.mockReturnValue(
      fakeStream([
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
      ]),
    );
    const res = await post([{ role: 'user', content: 'hi' }]);
    expect(await readAll(res)).toBe('Hello world');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/api/chat/route.test.ts`
Expected: FAIL — the current route imports/calls `getClaudeArticles` (the mock has no resolved value → `buildArticleContext(undefined)` throws / `getGroundingContext` is never called).

- [ ] **Step 3: Switch the chat route to the cached grounding** — edit `src/app/api/chat/route.ts` lines 1-11.

Change the import (line 3) from:

```ts
import { getClaudeArticles, buildArticleContext } from '@/lib/scraper';
```

to:

```ts
import { getGroundingContext } from '@/lib/scraper';
```

Then change the body start (lines 10-11) from:

```ts
  const articles = await getClaudeArticles();
  const articleContext = buildArticleContext(articles);
```

to:

```ts
  const articleContext = await getGroundingContext();
```

(Leave everything else — the `systemPrompt` template and the `${articleContext}` injection at `route.ts:60` — unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/api/chat/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/route.ts src/app/api/chat/route.test.ts
git commit -m "perf(chat): read grounding from cross-instance cache, drop in-request scrape"
```

---

### Task 3: Prompt caching on the system block + dev usage log (C)

**Files:**
- Modify: `src/app/api/chat/route.ts` (the `messages.stream` call + the stream loop)
- Test: `src/app/api/chat/route.test.ts` (add one test case)

**Interfaces:**
- Consumes: the route + test scaffolding from Task 2.
- Produces: `system` sent as `[{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]`, and a dev-only `message_start` usage log.

- [ ] **Step 1: Write the failing test** — append this `it(...)` inside the existing `describe('POST /api/chat ...')` block in `src/app/api/chat/route.test.ts`:

```ts
  it('sends the system prompt as an ephemeral cache_control block (prompt caching)', async () => {
    await post([{ role: 'user', content: 'hi' }]);
    const sysArg = streamMock.mock.calls[0][0].system;
    expect(Array.isArray(sysArg)).toBe(true);
    expect(sysArg[0]).toMatchObject({
      type: 'text',
      cache_control: { type: 'ephemeral' },
    });
    expect(sysArg[0].text).toContain('GROUNDING_MARKER');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/api/chat/route.test.ts -t "cache_control"`
Expected: FAIL — `Array.isArray(sysArg)` is `false` (system is still a plain string from Task 2).

- [ ] **Step 3: Wrap the system prompt in a cache_control block**

In `src/app/api/chat/route.ts`, change the `system` line inside the `client.messages.stream({ ... })` call (currently `route.ts:70`, `system: systemPrompt,`) to:

```ts
          system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
```

- [ ] **Step 4: Add the dev-only cache-usage log** in the stream loop.

Change the loop header (currently `route.ts:74`, `for await (const chunk of messageStream) {`) so its first statement logs cache usage in non-production. The loop becomes:

```ts
        for await (const chunk of messageStream) {
          if (chunk.type === 'message_start' && process.env.NODE_ENV !== 'production') {
            const u = chunk.message.usage;
            console.log('[chat] cache usage', {
              cache_read: u.cache_read_input_tokens,
              cache_creation: u.cache_creation_input_tokens,
              input: u.input_tokens,
            });
          }
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
```

- [ ] **Step 5: Run the chat route test to verify it passes**

Run: `npx vitest run src/app/api/chat/route.test.ts`
Expected: PASS (3 tests — the two from Task 2 still green because their system assertion is shape-agnostic).

- [ ] **Step 6: Run the full quality gate**

Run: `npm run test:run`
Expected: PASS — all suites green.

Run: `npm run typecheck`
Expected: no errors (system block typed as `TextBlockParam[]`; `chunk.message.usage` typed on `message_start`).

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Manual verification (cache hits are a runtime signal — confirm in dev)**

> Note: per workspace rule, do **not** run `next build` while `next dev` is live (shared `.next`). Use dev only.

Start dev (`npm run dev`), then:
1. Ask a question, then a follow-up in the same conversation. In the server logs, the **first** turn shows `cache_creation > 0` and the **second** shows `cache_read > 0` (system prefix served from cache).
2. After a cold start / fresh dev server, the first chat request returns promptly and the logs show **no** per-request summarization — grounding came from `getGroundingContext()`.
3. `curl` the refresh route with the correct bearer (`Authorization: Bearer $CRON_SECRET`) → 200 + status JSON; a subsequent chat request reflects refreshed grounding (possibly one request later via stale-while-revalidate).

- [ ] **Step 8: Commit**

```bash
git add src/app/api/chat/route.ts src/app/api/chat/route.test.ts
git commit -m "perf(chat): cache the system prompt at the model (cache_control) + dev usage log"
```

---

## Self-Review

**Spec coverage:**
- B — chat never scrapes/summarizes on the request path → Task 2 (route reads `getGroundingContext`, asserts `getClaudeArticles` not called) + Task 1 (the Data Cache layer). ✓
- B — refresh stays the cron's job; cron invalidates the shared cache → Task 1 (`revalidateTag(GROUNDING_TAG)`, asserted). ✓
- B — cross-instance + non-blocking (SWR) → Task 1 (`unstable_cache` with `revalidate` + `tags`). ✓
- C — system prompt cached at the model → Task 3 (`cache_control` block, asserted). ✓
- C — verifiable cache behavior → Task 3 (dev usage log + manual step 7.1). ✓
- Grounding bytes / prompt text unchanged → Task 1 (`buildGroundingContext = buildArticleContext(await getClaudeArticles())`), Task 3 (wraps the existing string, no edit). ✓
- `getIngestionStatus` / cron auth preserved → Task 1 (refresh route keeps the 401 paths + status JSON; tests assert 401 + no revalidate). ✓
- No new deps / infra / env vars → only `next/cache` (built-in) and the existing SDK are used. ✓
- Quality gate typecheck/test/lint → Task 3 Step 6. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code, every run step shows the command + expected result. ✓

**Type consistency:** `GROUNDING_TAG` is the string `'grounding'` in Task 1 (scraper export + refresh route + refresh test mock + Task 1 assertion). `getGroundingContext` defined in Task 1, consumed in Task 2 (route) and mocked in Task 2's test. The Task 2 system assertion is shape-agnostic, so it stays valid after Task 3 changes `system` from `string` to `TextBlockParam[]`. ✓
