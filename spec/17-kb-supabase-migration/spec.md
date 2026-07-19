# KB Store Migration — Neon → Supabase Postgres

**Status:** Proposed (2026-07-04), from a brainstorming session. Pending review.
**Origin:** The KB store shipped (`spec/kb-postgres-store/`, PR #33) but is **dormant in production** — `DATABASE_URL` was never provisioned, so `db.ts` no-ops and every cold start live-scrapes (~30s). This spec (a) moves the backend from Neon to Supabase and (b) actually wires it up so the KB + cron work as originally intended.
**Why Supabase (not just "set `DATABASE_URL` on Neon"):** roadmap. The intermediate backlog (`spec/00_feature_backlog.md`) needs **pgvector** (#2 RAG/embeddings) and **Auth + Row-Level Security** (#7 learner profile). Supabase gives both on one managed Postgres with strong DX, so we adopt it now as the strategic base rather than migrate later.
**Touch surface:** `src/lib/db.ts`, `src/lib/db.test.ts`, `package.json`, `.env.example`, `README.md`. Plus Vercel/Supabase config (no code): provision DB, set `DATABASE_URL` + `CRON_SECRET`, redeploy.

---

## Objective

1. **Switch the durable KB backend from Neon to Supabase Postgres** with **no behavior change** — same `Article` shape, same `status` contract, same DB-first + self-heal read policy, same cron writer.
2. **Complete the deployment** so the feature is live: articles persist, cold starts read precomputed rows (<2s instead of ~30s), and the daily cron refreshes the store.
3. **Leave the base pgvector- and Auth-ready** for backlog #2/#7 — without building either yet.

This is a **backend/driver + provisioning** change. It touches storage plumbing only; no change to answer content, the system prompt, read-along, prompt caching, scraping, or summarization logic.

## Why the switch is small

Both are Postgres. Every statement in `db.ts` is portable ANSI SQL (`CREATE TABLE IF NOT EXISTS`, `SELECT … ORDER BY`, `INSERT … ON CONFLICT`, `DELETE … <> ALL($1)`). The only Neon-specific thing is the **driver**: `@neondatabase/serverless` speaks Neon's HTTP proxy protocol and cannot connect to Supabase. Swapping it to **`postgres.js`** (also a `sql\`…\`` tagged-template client) keeps all seven query functions essentially byte-for-byte. `scraper.ts`, `summarize.ts`, and `refresh/route.ts` consume `db` through its function API (`import * as db from './db'`) and are **untouched**.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Backend** | **Supabase Postgres** (Supabase Vercel integration or manual connection string) | Roadmap: first-class **pgvector** (#2) + **Auth/RLS** (#7) on one managed DB. |
| **Driver** | **`postgres.js`** (`postgres` npm) | Tagged-template API mirrors Neon's `sql\`…\``, so `db.ts` diff is ~5 lines. Standard Postgres wire; no PostgREST rewrite. |
| **Connection** | **Supavisor pooler, transaction mode** — host `…pooler.supabase.com`, port **6543**, `?pgbouncer=true`, client opt **`prepare: false`** | Serverless-safe. Direct 5432 is IPv6-only on Supabase (unreachable from Vercel functions without the IPv4 add-on); the pooler is the supported serverless path. Transaction mode forbids prepared statements → `prepare: false`. |
| **Env var name** | **Accept `DATABASE_URL` or `POSTGRES_URL`** | `db.ts` reads `DATABASE_URL \|\| POSTGRES_URL`. The Supabase Vercel integration auto-provisions `POSTGRES_URL` (pooled), so it works with no manual aliasing; `DATABASE_URL` still overrides. |
| **Schema** | **Unchanged**, still created idempotently by `ensureSchema()`; `db/schema.sql` stays the canonical reference | DDL is portable and runs fine over the transaction pooler. |
| **Cron cadence** | **Unchanged** (`0 6 * * *`, daily — Hobby cap) | Out of scope. Hourly still needs Vercel Pro; revisit separately. |
| **Data migration** | **None** | The KB is fully derivable from the blog; the first read self-heals (scrape → summarize → persist). No dump/restore from Neon. |

## Non-goals (YAGNI)

- **No `@supabase/supabase-js` / PostgREST rewrite.** We use Supabase purely as Postgres via `postgres.js`. Keeps runtime DDL and the tested SQL.
- **No pgvector columns or embeddings yet.** This spec only makes Supabase the base; #2 owns the vector schema.
- **No Auth / RLS yet.** #7 owns that. (Note: with RLS off and the service connection string, current access is unchanged.)
- **No ORM / migration framework**, no cron-cadence change, no answer/prompt/read-along change, no admin UI.

## Hard constraints (must not break)

- **`Article` shape unchanged** — `getClaudeArticles()` still resolves `Article[]` newest-first; `/api/scrape` and grounding untouched.
- **`getIngestionStatus()` contract unchanged** — same `{ count, lastSuccessfulFetch, ageMs, stale, lastError }`.
- **No-op-without-`DATABASE_URL` preserved** — unset `DATABASE_URL` ⇒ every `db` export no-ops ⇒ pure live-scrape (today's degraded-but-working behavior). The `db.test.ts` "no-op" case must stay green.
- **Cron auth preserved** — `Bearer $CRON_SECRET` check in `refresh/route.ts` unchanged; fails closed (401).
- **Quality gate (all pass):** `npm run lint`, `npm run typecheck`, `npm run test:run`. Node 24+.

---

## Design

### `src/lib/db.ts` — driver swap (the only code change)

```ts
// before
import { neon } from '@neondatabase/serverless';
const url = process.env.DATABASE_URL;
const sql = url ? neon(url) : null;

// after
import postgres from 'postgres';
const url = process.env.DATABASE_URL;
// Transaction-pooler safe: no prepared statements. Small pool; reused across warm invocations.
const sql = url ? postgres(url, { prepare: false, max: 1, idle_timeout: 20 }) : null;
```

Everything else in `db.ts` stays as-is. The one statement to re-verify under `postgres.js` param binding:

- `deleteMissing` — `DELETE FROM articles WHERE slug <> ALL(${keepSlugs})`. `postgres.js` serializes a JS array to a Postgres array; confirm `<> ALL(${keepSlugs})` binds correctly, else use `!= ALL(${keepSlugs})` or `sql.array(keepSlugs)`. Covered by a test.

Result-shape compatibility (already true, just confirming): `postgres.js` returns row objects keyed by the DB column names (`pub_date`, `hero_image`, `last_successful_fetch`), which `rowToArticle`/`readMeta` already read; empty results are a zero-length array, so the existing `.length === 0` guards hold.

### `src/lib/db.test.ts` — mock the new driver

Swap the mocked module from `@neondatabase/serverless` to `postgres`. `postgres.js`'s **default export** is the factory (`postgres(url) → sql`), same shape as the current `neon` mock (`neonMock: vi.fn(() => sqlMock)`):

```ts
vi.mock('postgres', () => ({ default: neonFactoryMock }));
```

The tagged-template stub and `lastSql()` helper are unchanged (`postgres.js` also calls `sql(strings, ...values)`). Add an assertion that the factory is called with `{ prepare: false }`.

### `package.json`

Remove `@neondatabase/serverless`, add `postgres` (`^3.x`). One dependency in, one out; `package-lock.json` regenerates.

### Unchanged by design

`src/lib/scraper.ts`, `src/lib/summarize.ts`, `src/app/api/scrape/refresh/route.ts`, `vercel.json`, `db/schema.sql` — verified they reference `db` only through its function API or don't touch it. No edits.

### Docs

- `.env.example` — reword the `DATABASE_URL` block: "Supabase Postgres **transaction-pooler** connection string (port 6543, `?pgbouncer=true`). Set by the Supabase Vercel integration or by hand. Required in prod; optional locally."
- `README.md` — the 4 Neon references (Storage row `:75`, env var `:99`/`:108`, endpoint note `:133`, "Auto-refresh & freshness" `:138`): Neon → Supabase; keep the DB-first / self-heal / cron narrative.

---

## Setup / provisioning (the "make it actually work" half)

Split by who can do it.

**You (dashboard — needs your Supabase/Vercel accounts):**
1. Create a Supabase project (free tier is fine). Region close to the Vercel deployment region.
2. Copy the **transaction pooler** connection string: Project → Settings → Database → Connection string → **Transaction** (port 6543). Add your DB password.
3. Wire it to Vercel — either install the **Supabase Vercel integration** (auto-sets `POSTGRES_URL`/`DATABASE_URL`; if it uses a different var name, add a `DATABASE_URL` alias), or set `DATABASE_URL` manually (Production + Preview).
4. Confirm **`CRON_SECRET`** is set in Vercel (the daily cron writer authenticates with it — without it `/api/scrape/refresh` 401s and never refreshes).
5. **Redeploy** (env changes only apply to new deployments).

**Me (code + verification):**
1. Driver swap + test update in a **git worktree** (per repo convention); pass the quality gate.
2. If you paste the pooler connection string (or a throwaway local one), run `db/schema.sql` / let `ensureSchema()` create tables, and smoke-test `getArticles`/`upsertArticles` against real Supabase locally.
3. After your redeploy: verify `/api/scrape` cold latency drops to <2s and `lastSuccessfulFetch` **holds steady** across cold reads with `ageMs` growing (the persistence tell — vs today's re-stamp-to-now).

**Seeding:** none required. First post-deploy request self-heals (scrape → summarize → `upsertArticles`), or hit `/api/scrape/refresh` with the cron secret once to populate immediately.

## Rollback

Fully reversible, no data loss (KB is derivable):
- **Code:** revert the `db.ts` / `package.json` / test commit.
- **Config:** point `DATABASE_URL` back at Neon (if kept) or unset it (app degrades to live-scrape, as today).

---

## Edge cases

- **Prepared-statement error** (`prepared statement "s0" already exists`) → transaction pooler + `prepare: true`. Guarded by `prepare: false`; asserted in tests.
- **Direct-connection (5432) chosen by mistake** → IPv6-only, times out from Vercel. Spec mandates the pooler (6543); documented in `.env.example`.
- **`DATABASE_URL` unset** → `db.ts` no-ops; live-scrape everywhere (today's behavior). App still works.
- **Pooler connection cap** → `max: 1` per instance + `idle_timeout` keeps concurrent-instance connections modest; upsert is idempotent so retries are safe.
- **DDL over transaction pooler** → single-statement `CREATE TABLE IF NOT EXISTS` calls are fine; if ever problematic, run `db/schema.sql` once in the Supabase SQL editor and `ensureSchema()` becomes a no-op safety net.
- **Array bind in `deleteMissing`** → verified by test; fallback `sql.array()` if needed.

---

## Testing strategy

**Stack:** Vitest; DB mocked at the module boundary. No live DB in CI.

**`db.test.ts` (edit existing):**

| Case | Assert |
|---|---|
| driver target | mocks `postgres` (default export); factory called once with `{ prepare: false }` |
| no-op without `DATABASE_URL` | every export no-ops (`[]` / empty map / resolve), factory **not** called |
| `getArticles` | maps rows → `Article[]`, `pub_date DESC NULLS LAST` (unchanged) |
| `getKnownSummaries` | excludes empty-`hash` rows (unchanged) |
| `upsertArticles` | emits `ON CONFLICT (slug) DO UPDATE` (unchanged) |
| `deleteMissing` | binds the keep-list array correctly; no-ops on empty list (unchanged) |
| `writeMeta` merge | error-only patch preserves fetch time (unchanged) |

**Unchanged suites must stay green:** `scraper.db.test.ts`, `scraper.test.ts`, `summarize.test.ts`, `refresh/route` tests — they mock `@/lib/db`, so the driver swap is invisible to them (a good sign the boundary is right).

**Manual (post-provision):**
1. `curl -H "Authorization: Bearer $CRON_SECRET" …/api/scrape/refresh` → 200; rows visible in the Supabase table editor.
2. Cold-load the app → sidebar populates from DB, **no** summary calls in logs.
3. Two `/api/scrape` reads spaced > read-cache TTL → both <2s, `lastSuccessfulFetch` stable, `ageMs` grows (persistence confirmed).

---

## Definition of Done

| Check | Criterion |
|---|---|
| Lint / types / tests | `npm run lint`, `npm run typecheck`, `npm run test:run` all green |
| Driver swapped | `db.ts` uses `postgres.js` with `prepare:false`; `@neondatabase/serverless` removed from `package.json` |
| No-op guard intact | unset-`DATABASE_URL` test passes |
| Docs updated | `.env.example` + README describe Supabase pooler; no stale Neon references |
| Provisioned | Supabase project live; `DATABASE_URL` (pooler) + `CRON_SECRET` set in Vercel; redeployed |
| Persistence verified | prod `/api/scrape` cold <2s; `lastSuccessfulFetch` stable across cold reads (`ageMs` grows) |
| Cron writes | a cron/manual refresh populates the Supabase table |
