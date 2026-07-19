# Chat response latency — server-side fixes (B + C)

**Status:** Approved direction (2026-06-18), from the STT→response latency investigation.
**Scope:** Two server-side changes to `/api/chat` and its grounding layer. **No client / STT changes** — the 2.5s STT silence timer is deliberately kept as-is.
**Origin:** Latency investigation found three stacked delays between "user stops speaking" and "first token of the answer". Fix A (shorten the 2.5s STT silence timer) is **out of scope by decision**. This spec covers the two server-side fixes:

- **B — Ingestion out of the hot path:** `/api/chat` must never block on scraping the blog or summarizing articles.
- **C — Prompt caching:** the large, stable system prompt must be cached at the model so time-to-first-token (TTFT) drops on every turn after the first.

---

## Problem

### B — `/api/chat` runs the full ingestion pipeline on cold instances

`src/app/api/chat/route.ts` calls `getClaudeArticles()` on every request (`route.ts:10`). The article cache (`scraper.ts:65` `cachedArticles`) and the summary cache (`summarize.ts:48` `summaryCache`) are **module-level in-memory** — not shared across serverless function instances, and empty on every cold start. `/api/chat` and `/api/scrape` are separate functions with separate memory, so the page-load scrape never warms the chat function.

On a cold `/api/chat` instance the request blocks on: fetch the blog index → fetch every article body → `summarizeAll()`, which re-issues a Haiku (`claude-haiku-4-5`) call for **all ~24 articles** (5 concurrent). The article-HTML `fetch`es are served from Next's cross-instance fetch Data Cache (`next: { revalidate: 3600 }`), so the dominant cost is re-summarization. That adds several seconds to the first chat request after any cold start — directly on the user's turn.

The cron refresh route's own docstring already states the intent — *"its cost/latency lands on the cron, never on a user request"* (`refresh/route.ts:9-11`) — but that intent is **not actually achieved**, because module memory is per-instance.

### C — The system prompt is large, stable, and re-processed uncached every turn

`route.ts:13-60` builds a ~6k-token system prompt: the tutor instructions plus up to ~5k tokens of article context (`CONTEXT_CHAR_CEILING = 20_000` in `scraper.ts:16`). It is sent as a plain string with **no `cache_control`**, so the model re-processes the entire prefix on every turn. The prefix is byte-stable across turns within a conversation and across users within a refresh window, so it is an ideal caching candidate that is currently paid for in full TTFT every message.

---

## Goals

1. **B:** `/api/chat` reads a precomputed grounding context from a cross-instance cache and **never scrapes or summarizes on the request path** (not even on a cold start).
2. **B:** Refresh stays the refresh route's job — the cron invalidates the shared grounding cache; recompute happens off the user's turn (background revalidation).
3. **C:** The system prompt is cached at the model via `cache_control`, so every turn after the first reads the cached prefix (lower TTFT, lower cost).
4. **Both:** No change to the *content* of answers, the system-prompt text, the parser/read-along invariants, or the cron auth. No new npm dependencies and no new hosted storage product.

## Non-goals (YAGNI)

- **No STT change.** The 2.5s silence timer in `useSpeechRecognition.ts` is intentionally unchanged (decision: keep the current voice UX).
- **No new infrastructure.** No Vercel KV / Blob / Edge Config, no Redis, no new env vars. B uses Next.js's built-in Data Cache (`unstable_cache`), which is available on Hobby and requires no provisioning.
- **No model change.** Stay on `claude-sonnet-4-6` for the chat (right latency tier) and `claude-haiku-4-5` for summaries.
- **No streaming-protocol change** to the response.
- **No durable summary cache** in this pass (summaries remain per-instance; see Out-of-scope).
- **No 1-hour cache TTL or cache pre-warming** in this pass (see Out-of-scope).

---

## Hard constraints (must not break)

- **Grounding bytes unchanged.** The string `/api/chat` injects must be exactly what `buildArticleContext(await getClaudeArticles())` produces today. Same content → answers are unchanged → the prompt-cache prefix is byte-stable. B is a *transport/caching* change, not a content change.
- **System-prompt text unchanged.** C wraps the existing `systemPrompt` string in a content block; it does **not** edit the prompt. All `parseAnswer` / read-along invariants (per `spec/tailored-tutor-prompt/spec.md`) are untouched.
- **`getIngestionStatus()` semantics preserved.** `/api/scrape` and `/api/scrape/refresh` keep returning the same `status` shape; B does not alter freshness reporting.
- **Cron auth preserved.** The `CRON_SECRET` bearer check in `refresh/route.ts` is unchanged; refresh still fails closed.
- **Versions / deps:** Next **14.2.5** (so `unstable_cache` from `next/cache`, not `'use cache'`), `@anthropic-ai/sdk` **0.40.1**, no new dependencies.
- **Sonnet 4.6 minimum cacheable prefix is 2048 tokens.** The ~6k-token system block clears it; a shorter prompt would silently not cache.
- **Quality gate (all must pass):** `npm run typecheck`, `npm run test:run`, `npm run lint`.

---

## Design

### Part B — Cross-instance grounding cache (Next.js Data Cache)

Introduce one cached accessor in `src/lib/scraper.ts`:

```
buildGroundingContext()           // uncached: getClaudeArticles() → buildArticleContext()
        │
        ▼  wrapped by unstable_cache(fn, ['grounding-context'], { revalidate, tags: ['grounding'] })
getGroundingContext()             // cross-instance Data Cache; what /api/chat reads
```

- `getGroundingContext()` is backed by Vercel's **Data Cache**, which (unlike module memory) is shared across every function instance and survives cold starts. A cold `/api/chat` instance gets a **cache hit** and returns the assembled context without scraping or summarizing.
- `revalidate: 86_400` (daily) is a time-based backstop. `tags: ['grounding']` lets the cron invalidate on demand.
- **Stale-while-revalidate:** after the tag is invalidated (or the 24h backstop elapses), the next read returns the **stale** value immediately and triggers a **background** recompute. So even at the refresh boundary, the chat request never blocks on ingestion — at worst one request serves day-old context while the refresh runs after the response.
- `/api/chat` calls `await getGroundingContext()` instead of `getClaudeArticles()` + `buildArticleContext()`. It no longer imports `getClaudeArticles`.
- `/api/scrape/refresh` (the daily cron) keeps its forced scrape and adds `revalidateTag('grounding')`, so the shared grounding cache refreshes off the user's turn. `getClaudeArticles({ force: true })` and `getIngestionStatus()` are unchanged.

`/api/scrape` (the page-load article list) is **unchanged** — it still calls `getClaudeArticles()` for the sidebar; that is not on the STT→response path.

**Background-recompute cost note:** a background revalidation that lands on a cold instance will re-summarize (per-instance `summaryCache` is empty). This is bounded (once per revalidation, not per request) and never blocks a user. Making summaries durable cross-instance is a deliberate Out-of-scope follow-up.

### Part C — Prompt caching on the system block

In `src/app/api/chat/route.ts`, change the `messages.stream` call's `system` from a string to a single cached content block:

```ts
system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
```

- The volatile part of the request (the user's question and history) lives in `messages`, which renders **after** `system`. So the system prefix (instructions + grounding context) is byte-stable across turns and is cached.
- **Primary win:** every follow-up turn in a conversation (turns are seconds apart, within the 5-minute ephemeral TTL) reads the cached system block → lower TTFT and ~0.1× input cost on that prefix.
- **Bonus win:** because B makes the grounding context byte-identical across requests/users within a refresh window, the system prefix is shared across users whose requests cluster within the TTL.
- Add a **dev-only** usage log (gated by `NODE_ENV !== 'production'`) of `cache_read_input_tokens` / `cache_creation_input_tokens` from the `message_start` event, so cache behavior is verifiable locally and in preview.

### B + C synergy

B is what makes C effective: a stable, cross-instance grounding string keeps the cached system prefix byte-identical, so the model cache actually hits instead of being rewritten each turn.

---

## Validation

- **Existing suites stay green:** `scraper.test.ts`, `summarize.test.ts`, `scrape/route.test.ts`, `scrape/refresh/route.test.ts`, plus all component/parser tests. Run `npm run test:run`.
- **New tests:**
  - `refresh/route.test.ts` — on the authorized path, `revalidateTag('grounding')` is called after the forced scrape; on 401 paths it is not.
  - `chat/route.test.ts` (new) — the route awaits `getGroundingContext()` and injects its result; it does **not** call `getClaudeArticles`; and (C) `system` is sent as a `[{ type:'text', cache_control:{ type:'ephemeral' } }]` block whose text contains the grounding.
- **Quality gate:** `npm run typecheck`, `npm run test:run`, `npm run lint` all pass.
- **Manual / runtime (dev or preview):**
  1. Send a voice or text question, then a follow-up. In logs, the **second** turn shows `cache_read_input_tokens > 0` (system prefix served from cache).
  2. Cold-start behavior: the first chat request after a deploy returns promptly using cached/stale grounding; it does not block on ~24 Haiku summary calls. (Confirm no per-request summarization in logs.)
  3. Hit `/api/scrape/refresh` with the correct bearer → 200 + status JSON; a subsequent chat request reflects refreshed grounding (possibly one request later, by SWR).

---

## Files touched

- `src/lib/scraper.ts` — add `buildGroundingContext()`, `getGroundingContext` (wrapped in `unstable_cache`), and the exported `GROUNDING_TAG` constant. Existing functions unchanged.
- `src/app/api/chat/route.ts` — read `getGroundingContext()` (B); wrap `system` in a `cache_control` block + dev usage log (C).
- `src/app/api/scrape/refresh/route.ts` — `revalidateTag(GROUNDING_TAG)` after the forced scrape (B).
- `src/app/api/chat/route.test.ts` — **new**, covers B wiring + C system-block shape.
- `src/app/api/scrape/refresh/route.test.ts` — extend with the `revalidateTag` assertion.

## Out-of-scope follow-ups (noted, not built here)

- **Durable summary cache:** wrap `summarizeArticle` in `unstable_cache` keyed by `slug + contentHash` so background revalidation costs ~0 Haiku calls cross-instance.
- **1-hour cache TTL** (`cache_control: { type: 'ephemeral', ttl: '1h' }`) for sparser, bursty traffic so consecutive sessions share the cached prefix — verify SDK 0.40.1 / beta-header support first; weigh the 2× write cost (break-even ≈ 3 reads).
- **Cache pre-warming** (`max_tokens: 0`) timed to expected traffic windows.
- **Conversation-history caching:** a second `cache_control` breakpoint on the last message to cache the growing history prefix in long chats.
- **Fix A (STT silence timer):** shortening the 2.5s window — deferred by decision.
