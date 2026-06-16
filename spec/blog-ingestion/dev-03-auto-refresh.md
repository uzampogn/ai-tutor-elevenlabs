# Dev Spec 03 — Automatic Refresh + Observable Staleness

> Implements PRD `./blog-ingestion-full-index.md` → **P0-4** (the June 10 → June 15 stale-date bug).
> Depends on: **Dev Spec 01** (shared `scraper.ts`). Parallelizable with Dev Spec 02.
> Touch surface: `src/lib/scraper.ts`, `src/app/api/scrape/route.ts`, new `src/app/api/scrape/refresh/route.ts`, `vercel.json`, `README.md`.

## Objective

Keep the knowledge base current without a manual redeploy, and make staleness **observable** instead of silent. Today ingestion is lazy-only (1h module cache) and on any fetch error returns the last cache with **no signal**, so a persistent claude.com error / bot rate-limit can pin the app to days-old data unnoticed (the observed June 10 vs June 15 gap). This adds a scheduled refresh + a freshness signal, and stops the silent-stale behavior.

## Decision (resolves PRD open question)

Use **Vercel Cron** hitting a protected refresh route. Most explicit, decoupled from organic traffic, and works regardless of instance warmth. (ISR `revalidate` alone was rejected: it still only refreshes on a request and doesn't give us a freshness signal.)

## Changes

### 1. `getClaudeArticles(opts?: { force?: boolean })` + freshness state (`scraper.ts`)

Add module-level observability state alongside the existing cache:

```ts
let lastSuccessfulFetch = 0; // epoch ms of last fully successful index+body scrape
let lastError: string | null = null;

export interface IngestionStatus {
  count: number;
  lastSuccessfulFetch: string | null; // ISO
  ageMs: number | null;               // now - lastSuccessfulFetch
  stale: boolean;                     // ageMs > STALE_THRESHOLD_MS
  lastError: string | null;
}
export function getIngestionStatus(): IngestionStatus;
```

- `getClaudeArticles({ force })`: when `force === true`, bypass the TTL check and re-scrape.
- On a **successful** scrape: set `cachedArticles`, `cacheTime = now`, `lastSuccessfulFetch = now`, `lastError = null`.
- On **failure** (index fetch throws/!ok): keep serving `cachedArticles ?? []`, set `lastError`, and **do not** advance `lastSuccessfulFetch` or fake `cacheTime` to "fresh" — so freshness reflects reality and the next call retries. Log at error level with the data's current age.
- `STALE_THRESHOLD_MS` = e.g. 6h (document); `stale` is derived, not a behavior gate.

### 2. Scheduled refresh route — `src/app/api/scrape/refresh/route.ts` (new)

```ts
export async function GET(req: Request) {
  // Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`.
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return new Response('Unauthorized', { status: 401 });
  await getClaudeArticles({ force: true }); // re-scrape + (Spec 02) re-summarize misses
  return Response.json(getIngestionStatus());
}
export const dynamic = 'force-dynamic';
```
- Must `force` so it refreshes even within the 1h TTL.
- Because ingest (incl. summarization in Spec 02) runs here, the cost/latency lands on the cron, never on a user request.

### 3. Cron registration — `vercel.json`

Add a `crons` entry (current file only has framework/build/install keys):

```json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "installCommand": "npm install",
  "crons": [{ "path": "/api/scrape/refresh", "schedule": "0 * * * *" }]
}
```
- Hourly (`0 * * * *`) is the starting cadence — comfortably meets the ≤24h freshness goal with headroom; tune later. Document `CRON_SECRET` as a required env var.

### 4. Surface freshness on `/api/scrape` (enables P1-1)

`src/app/api/scrape/route.ts`: return `{ articles, status: getIngestionStatus() }` (additive — keep `articles` at the top level so `AppShell.tsx:82` keeps working unchanged).

### 5. Docs

`README.md`: document the refresh cadence, `CRON_SECRET`, and that the KB is auto-refreshed hourly (replace any "10 most recent" / manual-refresh language).

## Edge cases

- Cron hits while a lazy scrape is mid-flight → idempotent; last writer wins, no corruption (single module, no shared mutation hazard beyond the existing pattern).
- `CRON_SECRET` unset in an env → refresh route 401s (fail closed); lazy path still works.
- claude.com down for hours → `/api/scrape` still returns last good `articles` **and** `status.stale === true` with a real `ageMs`; logs show the error.
- First-ever call before any success → `articles: []`, `status.lastSuccessfulFetch: null`, `stale: true`.

## Testing strategy

**Stack:** Vitest, fixture `global.fetch` stub + `vi.resetModules()`. Route handlers tested by importing and invoking with a mock `Request`.

**Unit (`scraper.test.ts` additions):**

| Case | Assert |
|------|--------|
| **June 10→15 regression** | 1st call OK (sets `lastSuccessfulFetch`); advance time past TTL; 2nd index fetch fails → returns the **last good** articles, `status.stale === true`, `status.lastError` set, and `lastSuccessfulFetch` **unchanged** (not reset to now) |
| `force` bypass | two successful calls with `{ force: true }` → fetch invoked **twice** (TTL ignored) |
| status freshness | after a success, `getIngestionStatus().ageMs` ≈ 0, `stale === false` |
| cold start | before any call, `getIngestionStatus()` → `lastSuccessfulFetch: null`, `stale: true` |

> Time control: drive TTL/age via `vi.useFakeTimers()` / `vi.setSystemTime()` rather than real waits.

**Integration (route tests):**

| Route | Case |
|-------|------|
| `refresh/route` | no/wrong `Authorization` → 401, **no** scrape; correct `Bearer CRON_SECRET` → calls `getClaudeArticles({force:true})`, returns status JSON |
| `scrape/route` | response has `articles` at top level (back-comat) **and** a `status` object |

**Manual:**
1. `curl -H "Authorization: Bearer $CRON_SECRET" .../api/scrape/refresh` → 200 + status; without header → 401.
2. After a publish, confirm the new post appears within a refresh cycle.

## Definition of Done

| Check | Command |
|-------|---------|
| Vitest green incl. stale-regression + route auth tests | `npm run test:run` |
| Types clean (`IngestionStatus`, route) | `npm run typecheck` |
| Build succeeds (cron route picked up) | `npm run build` |
| `vercel.json` has the `crons` entry; `CRON_SECRET` documented | review |
