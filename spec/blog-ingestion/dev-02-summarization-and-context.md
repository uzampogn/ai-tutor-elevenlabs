# Dev Spec 02 — Per-Article Summarization + Bounded Chat Context

> Implements PRD `./blog-ingestion-full-index.md` → **P0-3, P0-5**.
> Depends on: **Dev Spec 01** (requires `Article.body`). Unblocks: nothing (Dev Spec 03 is parallel).
> Touch surface: `src/lib/summarize.ts` (new), `src/lib/scraper.ts`, `src/app/api/chat/route.ts`, new `src/lib/summarize.test.ts`.

## Objective

Condense each article's full `body` into a compact **summary** at ingest time, cache summaries so unchanged content is never re-summarized, and build the chat grounding context from **summaries** (not full bodies) so cost/latency stay flat as the article count grows (~24 today, more on a busy week).

## Changes

### 1. Data model — add `summary`

```ts
export interface Article {
  title: string;
  url: string;
  pubDate: string;
  description: string;
  body: string;       // from Dev Spec 01
  summary: string;    // NEW: compact grounding text (<= SUMMARY_CHAR_CAP)
}
```

### 2. New module `src/lib/summarize.ts`

```ts
// Model is configurable; default to the cheap/fast tier. VERIFY the exact id via the
// `claude-api` skill before pinning — do not guess. Override with env SUMMARY_MODEL.
const SUMMARY_MODEL = process.env.SUMMARY_MODEL ?? 'claude-haiku-4-5';
const SUMMARY_MAX_TOKENS = 220;
const SUMMARY_CHAR_CAP = 700;

interface SummarizableArticle { title: string; url: string; body: string; pubDate: string; }

/** Summarize one article. Never throws — on failure returns a truncated-body fallback. */
export async function summarizeArticle(a: SummarizableArticle): Promise<string>;

/** Map over articles using a slug-keyed content cache (see §3). Returns summaries aligned to input order. */
export async function summarizeAll(articles: SummarizableArticle[]): Promise<string[]>;
```

- **Client:** reuse `@anthropic-ai/sdk` (already a dependency, used in `chat/route.ts`). Instantiate one client at module scope with `process.env.ANTHROPIC_API_KEY`.
- **Prompt:** system = "You write tight 2–4 sentence summaries of a Claude blog post for an AI-news tutor. Capture what shipped/changed and why it matters to a business reader. Plain prose, no markdown, no preamble." user = `${title}\n\n${body.slice(0, BODY_INPUT_CAP /* ~12k chars */)}`.
- **Output:** trim, strip any stray markdown, cap at `SUMMARY_CHAR_CAP`.
- **Failure handling:** any error (timeout, API, missing body) → `return fallbackExcerpt(a.body)` (first `SUMMARY_CHAR_CAP` chars) and `console.error('[summarize] ...')`. Must not throw and must not drop the article.

### 3. Summary cache (skip unchanged on refresh) — P0-3 core

Module-level cache **separate from** the article cache so it survives a body re-fetch:

```ts
const summaryCache = new Map<string, { hash: string; summary: string }>();
function contentHash(title: string, body: string): string; // cheap stable hash (e.g. FNV-1a / djb2 over title+body)
```
- In `summarizeAll`, for each article compute `slug` (from url) + `hash`. If `summaryCache.get(slug)?.hash === hash` → reuse cached summary (**0 API calls**). Else call `summarizeArticle`, store `{hash, summary}`.
- Concurrency: summarize misses with bounded parallelism (e.g. `p`-limit of 5 via a small `Promise.all` over chunks) to avoid a 24-wide burst.

### 4. Wire into ingest (`scraper.ts`)

- After bodies are fetched and articles sorted, call `summarizeAll(articles)` and attach `summary` to each before caching the article list. Because this runs inside `getClaudeArticles` (behind the 1h cache / Dev Spec 03's refresh), it is **never per-user** and a warm cache costs 0 summary calls.
- On the resilience path (index fetch fails → return stale cache), do **not** re-summarize.

### 5. Bounded chat context (`buildArticleContext` + chat route) — P0-5

- `buildArticleContext(articles)` now renders `a.summary` (fallback to `a.description` if a summary is somehow empty) instead of the old `description`/body.
- Add a hard ceiling: accumulate blocks until a `CONTEXT_CHAR_CEILING` (define, e.g. 24 × 700 + headers ≈ 20k chars ≈ ~5k tokens) is reached; never exceed it. Newest-first order means the freshest posts are always included.
- `src/app/api/chat/route.ts:59`: change copy "KNOWLEDGE BASE — the Claude blog's 10 most recent articles:" → "KNOWLEDGE BASE — recent Claude blog posts:".

## Edge cases

- Empty/`''` body (degraded article from Spec 01) → summary falls back to `''`/excerpt; article still listed.
- API key missing in env → `summarizeArticle` fails fast to fallback (don't crash ingest).
- Same article re-fetched with edited body (hash changes) → re-summarized (correctly).
- 0 articles → `buildArticleContext` still returns the existing "No articles currently available" message.

## Testing strategy

**Stack:** Vitest. **Mock the Anthropic SDK** — `vi.mock('@anthropic-ai/sdk')` returning a canned summary. **No live API calls in CI.**

**`src/lib/summarize.test.ts` (new):**

| Case | Assert |
|------|--------|
| Happy path | `summarizeArticle` returns trimmed canned text ≤ `SUMMARY_CHAR_CAP` |
| Markdown strip | model returns `**bold**`/`# h` → output is plain prose |
| Cache hit | `summarizeAll` twice on identical articles → SDK called only on first pass (assert mock call count) |
| Cache miss on edit | change one body → exactly one new SDK call on the second pass |
| Failure fallback | SDK rejects → returns body excerpt, no throw, `console.error` called, article retained |
| Bounded concurrency | 24 misses → no more than the configured in-flight limit (spy/timing or a counting wrapper) |

**`scraper.test.ts` updates:** with the SDK mocked, assert every returned article has a non-empty `summary`; a warm second `getClaudeArticles()` makes **0** new summary calls.

**`buildArticleContext` tests:** built from `summary` not `body`; assembled context length ≤ `CONTEXT_CHAR_CEILING` for a 24-article fixture; blocks remain newest-first.

## Definition of Done

| Check | Command |
|-------|---------|
| Vitest green incl. new `summarize.test.ts` (no network) | `npm run test:run` |
| Types clean (`Article.summary`, new module) | `npm run typecheck` |
| Build succeeds | `npm run build` |
| Manual: ask "what shipped recently?" → answer spans the full set, well-structured, not truncated | manual `npm run dev` |
