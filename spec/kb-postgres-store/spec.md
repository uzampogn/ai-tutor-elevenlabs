# Persistent KB Store — Neon Postgres source of truth for articles + summaries

**Status:** Approved direction (2026-06-19), from a brainstorming session.
**Origin:** Picks up the two follow-ups `spec/chat-latency/spec.md` explicitly parked as out-of-scope — a **durable summary cache** and **new hosted storage**. Builds directly on `spec/blog-ingestion/dev-03-auto-refresh.md` (the cron + freshness model) and `spec/chat-latency/spec.md` (the cross-instance grounding cache).
**Touch surface:** new `src/lib/db.ts`, new `db/schema.sql`, `src/lib/scraper.ts`, `src/lib/summarize.ts`, `src/app/api/scrape/refresh/route.ts`, `vercel.json`, `package.json`, `.env.example`, `README.md`.

---

## Objective

Make the knowledge base — articles **and** their per-article summaries — **durable in Neon Postgres**, so that:

1. **Cold starts are fast.** Every read path reads precomputed rows from Postgres instead of re-scraping the blog and re-issuing ~24 Haiku summary calls on a fresh serverless instance.
2. **The same article is never summarized twice.** The summarize-skip key (content hash) lives in the database, so it survives cold starts and instance churn — today it lives in the per-instance `summaryCache` (`summarize.ts:48`) and is wiped on every cold start.

Postgres becomes the **single durable source of truth**. An **hourly Vercel Cron** is the writer; all read paths read **DB-first** with a **live self-heal** fallback for the gaps (first deploy, missed run, DB hiccup).

## Why this isn't already solved

`spec/chat-latency/spec.md` made the `/api/chat` grounding path cold-start-safe via Vercel's Data Cache (`getGroundingContext`, `unstable_cache`). But two gaps remain, both called out there as deliberate follow-ups:

- **The sidebar path is still cold.** `/api/scrape` → `getClaudeArticles()` reads the per-instance `cachedArticles` (`scraper.ts:68`), empty on every cold start → full re-scrape.
- **Summaries are not durable.** `summaryCache` is per-instance in-memory; a background grounding revalidation or any sidebar cold start re-summarizes all ~24 articles (`chat-latency/spec.md:79`, `:124` flag this exact cost).

A durable store fixes both at the source rather than adding a third ephemeral cache.

## Decisions (locked in brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| **Store** | **Neon Postgres** via the Vercel Marketplace integration (provisions `DATABASE_URL`) | Chosen over KV/Blob because the in-flight `spec/article-score-card/` work wants structured, queryable per-article rows. Relational fits both this cache and that. |
| **Trigger** | **Vercel Cron, hourly** (`0 * * * *`) | One platform, runs server-side, no extra secret in GitHub. **Requires Vercel Pro** — Hobby caps crons at once/day (see `README.md`), so this cadence assumes the project is on (or upgrades to) Pro. |
| **Read policy** | **DB-first + live self-heal** | Reads query Postgres; if the table is empty or stale, fall back to the existing live scrape+summarize and write the result back. Resilient (never a permanently empty KB), at the cost of keeping the expensive path reachable on a request *only* during a gap. |

## Non-goals (YAGNI)

- **No migration framework.** Schema is created by idempotent `CREATE TABLE IF NOT EXISTS` plus a committed `db/schema.sql` for reference/manual setup. No Prisma/Drizzle/Kysely.
- **No removal of the grounding Data Cache.** `getGroundingContext` (`unstable_cache` + `revalidateTag`) stays as a thin read-cache over the now-DB-backed `getClaudeArticles()`.
- **No change to answer content, the system prompt, `parseAnswer`/read-along invariants, prompt caching, or cron auth.** This is a storage/caching change only.
- **No score-card columns or analytics tables here.** This spec only makes the schema *hospitable* to that work; the score-card feature owns its own columns.
- **No admin UI, no per-user data, no KV/Blob.**

## Hard constraints (must not break)

- **`Article` shape unchanged.** `getClaudeArticles()` still resolves to `Article[]` (`scraper.ts:5`) newest-first; consumers (`/api/scrape`, `buildArticleContext`) are untouched.
- **Grounding bytes stable when content is unchanged.** `buildArticleContext` is not modified; grounding now sources rows from Postgres, but for unchanged content the assembled string — and thus the prompt-cache prefix from `chat-latency` — is byte-identical.
- **`getIngestionStatus()` shape preserved.** `/api/scrape` and `/api/scrape/refresh` keep returning the same `status` object; only its backing store moves from module memory to `kb_meta`.
- **Cron auth preserved.** The `Bearer $CRON_SECRET` check in `refresh/route.ts` is unchanged; refresh still fails closed (401).
- **Quality gate (all must pass):** `npm run lint`, `npm run typecheck`, `npm run test:run`. Node 24+.

---

## Design

### Data model

```sql
-- db/schema.sql (canonical DDL; also created idempotently at runtime)
CREATE TABLE IF NOT EXISTS articles (
  slug        TEXT PRIMARY KEY,
  hash        TEXT NOT NULL DEFAULT '',  -- djb2(title+body); summarize-skip key. '' = no cached summary (force re-summarize)
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  pub_date    TIMESTAMPTZ,               -- nullable; dateless posts sort last
  description TEXT NOT NULL DEFAULT '',   -- sidebar/drawer excerpt
  body        TEXT NOT NULL DEFAULT '',   -- kept: re-summarize without re-fetch + future reader
  summary     TEXT NOT NULL DEFAULT '',   -- grounding text
  hero_image  TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_meta (      -- cross-instance freshness clock (replaces module memory)
  id                    INT PRIMARY KEY DEFAULT 1,
  last_successful_fetch TIMESTAMPTZ,
  last_error            TEXT,
  CONSTRAINT kb_meta_singleton CHECK (id = 1)
);
```

- `hash` mirrors `summarize.ts:contentHash` (djb2 over `title + body`). A row whose stored `hash` equals the freshly-scraped article's hash needs **no** summary call.
- **Fallback summaries are not hash-cached.** When `summarizeArticle` falls back to a body excerpt (no client / API error), the row is written with `hash = ''`, so the next hourly run **retries** the summary instead of caching the degraded excerpt forever. Real summaries store the real hash and are reused.
- `body` is stored (cheap at ~24 rows) so a re-summarize doesn't require a re-fetch and the future article reader has the text.

### Data flow

```
        ┌─ Vercel Cron (hourly, Pro) ──────────────┐
        │   GET /api/scrape/refresh (Bearer secret) │   ← the writer
        └─────────────────────┬─────────────────────┘
                              ▼
        scrape index → fetch bodies → hash(title+body)
                              ▼
        getKnownSummaries() from DB → summarize ONLY new/changed
                              ▼
        upsertArticles() + reconcile deletes + writeMeta(now)
                              ▼
                  revalidateTag('grounding')

  /api/scrape ─┐                          ┌─ getArticles(): SELECT * ORDER BY pub_date DESC
  grounding   ─┼─ getClaudeArticles() ────┤   (cold-start safe, cross-instance)
  (chat)      ─┘   read-through (~60s)     └─ if EMPTY or STALE → self-heal:
                                               scrape+summarize inline, persist, return
```

In steady state (hourly cron) the DB is always fresh, so reads always hit Postgres and the scrape+summarize path **never runs on a user request**. Self-heal fires only in a gap.

### `src/lib/db.ts` (new) — all SQL in one tested place

- **Driver:** `@neondatabase/serverless` (HTTP-based; works in Vercel serverless functions, no connection pooling to manage). Connection string from `process.env.DATABASE_URL` (set by the Vercel Neon integration). A missing `DATABASE_URL` makes every export a safe no-op (returns `[]` / empty map / no-throw) so the app degrades to pure live-scrape rather than crashing at import — mirroring how `summarize.ts:39-45` guards a missing API key.
- **API:**
  - `ensureSchema(): Promise<void>` — idempotent `CREATE TABLE IF NOT EXISTS` for both tables; memoized per instance so it runs at most once.
  - `getArticles(): Promise<Article[]>` — `SELECT ... ORDER BY pub_date DESC NULLS LAST`, mapped to the `Article` shape.
  - `getKnownSummaries(): Promise<Map<string, { hash: string; summary: string }>>` — slug → cached summary (only rows with non-empty `hash`).
  - `upsertArticles(articles: ArticleRow[]): Promise<void>` — `INSERT ... ON CONFLICT (slug) DO UPDATE` (updates `updated_at`).
  - `deleteMissing(keepSlugs: string[]): Promise<void>` — prune rows whose slug isn't in the latest index. **Guarded:** caller only invokes it when the index scrape returned a non-empty set, so a failed/garbage scrape can't wipe the table.
  - `readMeta()` / `writeMeta({ lastSuccessfulFetch?, lastError? })` — the freshness clock (`INSERT ... ON CONFLICT (id) DO UPDATE`).

### `src/lib/scraper.ts` — `getClaudeArticles` becomes DB-first + self-heal

`getClaudeArticles({ force })` is rewritten around the DB; the scrape/parse/sort internals (`parseIndex`, `fetchArticleBody`, the sort) are unchanged.

1. **Read branch** (`!force`): return a short (~60s) in-memory read-through cache over `getArticles()`. If the rows are non-empty **and** fresh (`age ≤ STALE_THRESHOLD_MS`), return them — done, no scrape. If empty or stale, fall through to (2).
2. **Scrape branch** (`force`, or self-heal from (1)), wrapped in a **per-instance single-flight** promise so two concurrent cold requests don't both scrape:
   - scrape index + bodies + sort (existing logic);
   - `known = await getKnownSummaries()`; `summaries = await summarizeAll(articles, known)`;
   - `await persist(articles)` — the shared write step: `upsertArticles`, `deleteMissing(seenSlugs)` (only if `articles.length > 0`), `writeMeta({ lastSuccessfulFetch: now, lastError: null })`, `revalidateTag(GROUNDING_TAG)`, and prime the read-through cache;
   - return `articles`.
   - **On scrape failure:** `writeMeta({ lastError })` (do **not** advance the clock), then return `await getArticles()` (last good DB rows) — preserving today's "serve stale, surface the error, retry next call" behavior (`dev-03-auto-refresh.md:37`).
- `STALE_THRESHOLD_MS` drops from 26h (tuned for a daily cron) to **3h** — a few missed hourly runs tolerated before a read self-heals. Still derived/observability + the self-heal trigger; never blocks serving.
- `getIngestionStatus()` reads `kb_meta` (via a cached `readMeta()`), not module memory, so a cold instance reports real freshness instead of "never."

### `src/lib/summarize.ts` — durable dedup

- `summarizeAll(articles, known?: Map<string, { hash; summary }>)` gains an optional known-summaries map (seeded from the DB by the caller). A hash match against `known` reuses the stored summary (**0 API calls**), exactly as the in-memory `summaryCache` does today — but now durable across cold starts. The module-level `summaryCache` stays as an L1 in front of `known`.
- The caller (`getClaudeArticles`) writes each article's `hash` + resulting `summary` to Postgres via `persist`, applying the fallback rule above (`hash = ''` when the summary degraded to an excerpt).

### Read paths — unchanged in shape

- **`/api/scrape`** still calls `getClaudeArticles()` and returns `{ articles, status }` — now DB-backed and cold-start-safe.
- **Grounding / `/api/chat`** is untouched: `getGroundingContext` (`unstable_cache`) still wraps `buildGroundingContext` → `getClaudeArticles()`, which is now DB-backed. The cron's `revalidateTag(GROUNDING_TAG)` (and now self-heal's) refreshes it; the daily `revalidate` backstop stays.

### `src/app/api/scrape/refresh/route.ts` — unchanged contract

Same `Bearer $CRON_SECRET` check and `getClaudeArticles({ force: true })` call; `force` now drives the scrape→summarize-misses→persist→`revalidateTag` path. Still returns `getIngestionStatus()`. No signature change.

### Config & ops

- **`vercel.json`:** `crons` schedule `0 6 * * *` → `0 * * * *` (hourly; requires Pro).
- **`package.json`:** add `@neondatabase/serverless`.
- **`.env.example` + README:** add `DATABASE_URL` (auto-set by the Vercel Neon integration; required in prod, optional locally — without it the app live-scrapes every request).
- **Seeding:** the first post-deploy cron run (or a manual `curl` to `/api/scrape/refresh`, or the first organic request via self-heal) populates the table. No separate seed step required.

---

## Edge cases

- **First deploy, empty table** → first read self-heals (scrape+summarize+persist); the next cron keeps it warm.
- **`DATABASE_URL` unset** → `db.ts` no-ops; `getClaudeArticles` always takes the scrape branch (pure live behavior, as today). App still works.
- **DB read fails mid-request** → treated as empty → self-heal scrape serves the user; `writeMeta` is best-effort.
- **claude.com down for hours** → reads serve last-good DB rows; `getIngestionStatus().stale === true` with a real `ageMs` from `kb_meta`; `last_error` recorded.
- **Concurrent cold reads** → per-instance single-flight collapses to one scrape; cross-instance duplicates are harmless (`upsert` is idempotent, last writer wins).
- **Partial/garbage index scrape (0 articles)** → `deleteMissing` is skipped, so the table is never wiped by a bad scrape; existing rows keep serving.
- **Article removed from the blog** → next successful refresh prunes its row via `deleteMissing`, keeping the KB aligned with the live blog.
- **Transient summary API error** → row stored with `hash = ''` + excerpt; next hourly run retries the summary (bounded: at most the failed count per hour).

---

## Testing strategy

**Stack:** Vitest. DB is mocked at the module boundary (`vi.mock('@/lib/db')`) in scraper/route tests; `db.ts`'s own tests mock the `@neondatabase/serverless` tagged-template client. Time via `vi.useFakeTimers()`.

**`db.test.ts` (new):**

| Case | Assert |
|---|---|
| `ensureSchema` idempotent | runs the `CREATE TABLE IF NOT EXISTS` statements; memoized → second call issues no SQL |
| `getArticles` | maps rows → `Article[]`, ordered `pub_date DESC NULLS LAST` |
| `getKnownSummaries` | returns slug→{hash,summary}; **excludes** rows with empty `hash` |
| `upsertArticles` | emits `ON CONFLICT (slug) DO UPDATE`; sets `updated_at` |
| `deleteMissing` | deletes only slugs absent from `keepSlugs` |
| missing `DATABASE_URL` | every export no-ops (`[]` / empty map / resolve), never throws |

**`scraper.test.ts` (additions):**

| Case | Assert |
|---|---|
| DB hit | fresh non-empty DB → returns rows, **no** `fetch`, **no** summarize |
| empty → self-heal | empty DB → scrapes, summarizes, calls `persist` (upsert + writeMeta + revalidateTag), returns rows |
| stale → self-heal | DB age > 3h → self-heal scrape; fresh age → no scrape |
| scrape failure | scrape throws → returns last-good `getArticles()`, `writeMeta({lastError})`, clock **not** advanced |
| single-flight | two concurrent cold calls → one scrape |
| status from meta | `getIngestionStatus()` reflects `kb_meta` (cold instance reports real `ageMs`/`stale`) |

**`summarize.test.ts` (additions):**

| Case | Assert |
|---|---|
| known hash hit | `known` has matching hash → **0** API calls, reuses stored summary |
| new/changed | missing or mismatched hash → summarizes |
| fallback not cached | API error → excerpt returned; caller persists with `hash = ''` (verified in scraper persist test) |

**`refresh/route.test.ts` (additions):** authorized → `getClaudeArticles({force:true})` runs the persist path and `revalidateTag('grounding')` fires; 401 paths → no scrape, no DB write. (Extends the existing `revalidateTag` assertion from `chat-latency`.)

**Manual:**
1. `curl -H "Authorization: Bearer $CRON_SECRET" .../api/scrape/refresh` → 200 + status; confirm `articles` table populated in the Neon console.
2. Redeploy (cold start) and load the app → sidebar populates from DB with **no** summary calls in logs.
3. Trigger a second refresh with unchanged content → logs show 0 Haiku calls (all hash hits).

---

## Definition of Done

| Check | Command / criterion |
|---|---|
| Lint clean | `npm run lint` |
| Types clean (`db.ts` API, `Article` mapping) | `npm run typecheck` |
| Vitest green incl. new db/scraper/summarize/route tests | `npm run test:run` |
| Cron is hourly | `vercel.json` → `0 * * * *` |
| Schema committed + env documented | `db/schema.sql` present; `DATABASE_URL` in `.env.example` + README |
| README updated | "Built with" lists Neon Postgres; "How it's wired" describes the DB-backed KB + hourly cron + Pro requirement |
| Manual checks pass | the three steps above |
```