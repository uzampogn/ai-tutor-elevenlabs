# 22-persist-article-digests — implementation plan

```
model: claude-opus-5
effort: high
```

**Goal:** the article drawer's score-card digests are persisted in Postgres,
generated only at ingest, and `/api/digest` is a pure DB read — a cold instance
serves the drawer without a single LLM call.

**Architecture:** mirror the existing embedding layer 1:1 — `digest JSONB` +
`digest_hash` columns on `articles` (like `embedding` + `embedded_hash`), a
`digestStaleArticles()` ingest step in `src/lib/digest.ts` (like
`embedStaleArticles`), called from `scrapeAndPersist()`; the route reads
`db.getDigests()`.

**Tech stack:** Next.js 14 route handlers, postgres.js tagged templates
(serialized, `max: 1` pooler — see comment at `src/lib/db.ts:23`), Vitest.

**Spec:** `brain/02-backlog/22-persist-article-digests/spec.md` (read it first).

## File boundary

**Owns (only these paths may change):**

- `db/schema.sql`
- `src/lib/db.ts`, `src/lib/db.test.ts`
- `src/lib/digest.ts`, `src/lib/digest.test.ts`
- `src/lib/scraper.ts`, `src/lib/scraper.db.test.ts`
- `src/app/api/digest/route.ts`, `src/app/api/digest/route.test.ts` (new)

**Never touch:** `src/components/**`, `src/lib/types.ts`, `contracts/**`,
`brain/00-system/**`, `brain/02-backlog/BACKLOG.md`, `spec/**`, `eval/**`,
anything else. A cross-boundary need is a blocker — record it in your report and
stop that task.

## Seams under test

Tests exist **only** at these public interfaces — never internals, private
functions, or call counts beyond what a seam names:

1. `db.getDigestStates()`, `db.updateDigests()`, `db.getDigests()` — over the
   mocked `postgres` package (system boundary), `db.test.ts` style.
2. `digestStaleArticles(articles)` — skips unchanged content (0 API calls),
   persists only non-null digests, survives a thrown DB error. Anthropic SDK
   mocked (system boundary), `digest.test.ts` style.
3. `GET /api/digest` — returns the persisted map; fail-soft `{ digests: {} }`
   on DB error; makes no Anthropic call.
4. Ingest seam: a successful `scrapeAndPersist()` run hands the upserted rows
   to `digestStaleArticles` (extends `scraper.db.test.ts`, which by established
   convention mocks `@/lib/db` and sibling ingest modules — allowed **in that
   file only**).

Expected values in tests come from spec literals (the `VALID` digest fixture
already in `digest.test.ts`), never recomputed via the code under test.

## Global constraints

- Node 24+ (`nvm use` in repo root). Quality gate before push:
  `npm run lint && npm run typecheck && npm run test:run` — all green.
- TDD per step: write the failing test, see it fail, implement, see it pass,
  commit. One test → one implementation; don't write all tests up front.
- Commit small and often on your branch; never commit to `main`, never merge,
  never run `bd`.
- Keep `brain/03-build-reports/22-persist-article-digests/report.md` current:
  what's done, evidence (test output, curl output, screenshot paths), blockers.
- This item trips alert rule **A2** (schema): open the PR normally, note
  "schema change — parks for human review (A2)" in the PR description. No bead
  IDs anywhere in the PR.
- Do not run `next build` while `next dev` is live (shared `.next/`).

---

### Task 1: digest columns + db accessors

**Files:**
- Modify: `db/schema.sql` (append after the vector layer block)
- Modify: `src/lib/db.ts` (`ensureSchema()` at :49; new exports near
  `getEmbeddingStates`/`updateEmbeddings` at :105-124)
- Test: `src/lib/db.test.ts`

**Interfaces:**
- Consumes: existing `sql` tagged-template wrapper, `ensureSchema()`,
  `slugFromUrl()`.
- Produces (Tasks 2-4 rely on these exact signatures):
  ```ts
  export async function getDigestStates(): Promise<Map<string, string>>; // slug → digest_hash ('' = never digested)
  export async function updateDigests(rows: { slug: string; digest: ArticleDigest; digestHash: string }[]): Promise<void>;
  export async function getDigests(): Promise<Record<string, ArticleDigest>>; // url → digest, only rows with one
  ```

- [ ] **Step 1: Write the failing tests** — append to `src/lib/db.test.ts`,
  reusing its `sqlMock`/`lastSql()`/`freshDb()` helpers:

```ts
describe('digest persistence', () => {
  it('ensureSchema adds digest + digest_hash columns', async () => {
    const db = await freshDb();
    await db.ensureSchema();
    const ddl = sqlMock.mock.calls.map((c) => (c[0] as string[]).join('?')).join('\n');
    expect(ddl).toContain('ADD COLUMN IF NOT EXISTS digest JSONB');
    expect(ddl).toContain("ADD COLUMN IF NOT EXISTS digest_hash TEXT NOT NULL DEFAULT ''");
  });

  it('getDigestStates maps slug → digest_hash', async () => {
    const db = await freshDb();
    sqlMock.mockResolvedValue([{ slug: 'post-a', digest_hash: 'h1' }]);
    const states = await db.getDigestStates();
    expect(states.get('post-a')).toBe('h1');
    expect(lastSql()).toContain('SELECT slug, digest_hash FROM articles');
  });

  it('updateDigests writes digest json + hash per slug', async () => {
    const db = await freshDb();
    const digest = { tldr: 't', takeaways: ['a'], whyItMatters: 'w', tags: ['x'], questions: ['q?'] };
    await db.updateDigests([{ slug: 'post-a', digest, digestHash: 'h1' }]);
    expect(lastSql()).toContain('UPDATE articles SET digest =');
    expect(lastSql()).toContain('digest_hash =');
  });

  it('getDigests returns url-keyed map of non-null digests', async () => {
    const db = await freshDb();
    const digest = { tldr: 't', takeaways: ['a'], whyItMatters: 'w', tags: ['x'], questions: ['q?'] };
    sqlMock.mockResolvedValue([{ url: 'https://claude.com/blog/post-a', digest }]);
    expect(await db.getDigests()).toEqual({ 'https://claude.com/blog/post-a': digest });
    expect(lastSql()).toContain('WHERE digest IS NOT NULL');
  });

  it('digest accessors no-op safely without a DB url', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    const db = await freshDb();
    expect(await db.getDigestStates()).toEqual(new Map());
    expect(await db.getDigests()).toEqual({});
    await expect(db.updateDigests([])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx vitest run src/lib/db.test.ts`
Expected: FAIL — `getDigestStates is not a function` (and siblings).

- [ ] **Step 3: Implement.** In `src/lib/db.ts`:

Add the type import at the top (keep the existing `Article` import from
`./scraper`):

```ts
import type { ArticleDigest } from './types';
```

Inside `ensureSchema()`, after the `kb_meta ... embed_backlog` ALTER line, add:

```ts
      await sql`ALTER TABLE articles ADD COLUMN IF NOT EXISTS digest JSONB`;
      await sql`ALTER TABLE articles ADD COLUMN IF NOT EXISTS digest_hash TEXT NOT NULL DEFAULT ''`;
```

New exports (place after `updateEmbeddings`):

```ts
/** slug → digest_hash for every row ('' = never digested). */
export async function getDigestStates(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!sql) return map;
  await ensureSchema();
  const rows = (await sql`SELECT slug, digest_hash FROM articles`) as Row[];
  for (const r of rows) map.set(String(r.slug), String(r.digest_hash ?? ''));
  return map;
}

export async function updateDigests(
  rows: { slug: string; digest: ArticleDigest; digestHash: string }[],
): Promise<void> {
  if (!sql || rows.length === 0) return;
  await ensureSchema();
  for (const r of rows) {
    await sql`UPDATE articles SET digest = ${JSON.stringify(r.digest)}::jsonb,
      digest_hash = ${r.digestHash} WHERE slug = ${r.slug}`;
  }
}

/** url → persisted digest, for every article that has one. */
export async function getDigests(): Promise<Record<string, ArticleDigest>> {
  const out: Record<string, ArticleDigest> = {};
  if (!sql) return out;
  await ensureSchema();
  const rows = (await sql`SELECT url, digest FROM articles WHERE digest IS NOT NULL`) as Row[];
  for (const r of rows) out[String(r.url)] = r.digest as ArticleDigest;
  return out;
}
```

In `db/schema.sql`, append at the end:

```sql
-- Digest layer (brain/02-backlog/22-persist-article-digests). Score-card digest
-- generated at ingest; digest_hash = djb2(title+body) at digest time, '' = none
-- yet (next ingest generates). Mirrors the embedded_hash pattern above.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS digest JSONB;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS digest_hash TEXT NOT NULL DEFAULT '';
```

- [ ] **Step 4: Run and verify they pass**

Run: `npx vitest run src/lib/db.test.ts`
Expected: PASS (all, including the pre-existing suite).

- [ ] **Step 5: Commit**

```bash
git add db/schema.sql src/lib/db.ts src/lib/db.test.ts
git commit -m "feat(db): persist article digests (digest jsonb + digest_hash)"
```

---

### Task 2: `digestStaleArticles` ingest step

**Files:**
- Modify: `src/lib/digest.ts`
- Test: `src/lib/digest.test.ts`

**Interfaces:**
- Consumes: `db.getDigestStates()`, `db.updateDigests()` (Task 1),
  `digestArticle()` (existing, unchanged).
- Produces (Task 3 relies on this):
  ```ts
  export async function digestStaleArticles(articles: Article[]): Promise<{ digested: number; failed: number }>;
  ```
- Removes: `getArticleDigests()` and the module-level `digestCache` Map (their
  only consumer is the route, replaced in Task 4). `digest.ts` stops importing
  `./scraper` (the dependency reverses: scraper → digest).

- [ ] **Step 1: Write the failing tests.** In `src/lib/digest.test.ts`, add a
  hoisted db mock next to the existing Anthropic mock, and replace the whole
  `getArticleDigests` describe block with:

```ts
const dbMock = vi.hoisted(() => ({
  getDigestStates: vi.fn(),
  updateDigests: vi.fn(),
}));
vi.mock('./db', () => dbMock);
```

(in `beforeEach`, add:)

```ts
dbMock.getDigestStates.mockReset().mockResolvedValue(new Map());
dbMock.updateDigests.mockReset().mockResolvedValue(undefined);
```

```ts
describe('digestStaleArticles', () => {
  it('digests articles with no stored hash and persists them', async () => {
    createMock.mockResolvedValue(textRes(JSON.stringify(VALID)));
    const { digestStaleArticles } = await import('./digest');
    const res = await digestStaleArticles([ARTICLE]);
    expect(res).toEqual({ digested: 1, failed: 0 });
    expect(dbMock.updateDigests).toHaveBeenCalledWith([
      expect.objectContaining({ slug: 'post', digest: VALID }),
    ]);
  });

  it('skips unchanged content — 0 API calls', async () => {
    const { digestStaleArticles } = await import('./digest');
    // First run stores the hash updateDigests was called with.
    createMock.mockResolvedValue(textRes(JSON.stringify(VALID)));
    await digestStaleArticles([ARTICLE]);
    const storedHash = dbMock.updateDigests.mock.calls[0][0][0].digestHash as string;
    createMock.mockClear();
    dbMock.getDigestStates.mockResolvedValue(new Map([['post', storedHash]]));
    const res = await digestStaleArticles([ARTICLE]);
    expect(res).toEqual({ digested: 0, failed: 0 });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('counts a null digest as failed and does not persist it', async () => {
    createMock.mockResolvedValue(textRes('not json at all'));
    const { digestStaleArticles } = await import('./digest');
    const res = await digestStaleArticles([ARTICLE]);
    expect(res).toEqual({ digested: 0, failed: 1 });
    expect(dbMock.updateDigests).toHaveBeenCalledWith([]);
  });

  it('never throws — a DB error degrades to zero counts', async () => {
    dbMock.getDigestStates.mockRejectedValue(new Error('pooler down'));
    const { digestStaleArticles } = await import('./digest');
    await expect(digestStaleArticles([ARTICLE])).resolves.toEqual({ digested: 0, failed: 0 });
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx vitest run src/lib/digest.test.ts`
Expected: FAIL — `digestStaleArticles is not a function`.

- [ ] **Step 3: Implement.** In `src/lib/digest.ts`:

Replace the imports at the top with:

```ts
import Anthropic from '@anthropic-ai/sdk';
import * as db from './db';
import type { Article, ArticleDigest } from './types';
```

Delete the `digestCache` Map declaration (line ~38) and the entire
`getArticleDigests()` function. Keep `contentHash`, `slugFromUrl`,
`digestArticle` unchanged. Add:

```ts
/**
 * Ingest step: digest every article whose content hash differs from the stored
 * digest_hash, persisting non-null results immediately (failures leave the
 * stored hash unchanged, so the next ingest retries). Never throws — a digest
 * problem must not block ingest.
 */
export async function digestStaleArticles(
  articles: Article[],
): Promise<{ digested: number; failed: number }> {
  try {
    if (!client) return { digested: 0, failed: 0 };
    const states = await db.getDigestStates();
    const stale = articles.filter((a) => {
      if (!(a.body ?? '').trim()) return false; // nothing meaningful to digest
      return states.get(slugFromUrl(a.url)) !== contentHash(a.title, a.body ?? '');
    });
    let digested = 0;
    let failed = 0;
    for (let i = 0; i < stale.length; i += CONCURRENCY) {
      const chunk = stale.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (a) => ({ a, digest: await digestArticle(a) })),
      );
      const rows = results
        .filter((r): r is { a: Article; digest: ArticleDigest } => r.digest !== null)
        .map((r) => ({
          slug: slugFromUrl(r.a.url),
          digest: r.digest,
          digestHash: contentHash(r.a.title, r.a.body ?? ''),
        }));
      await db.updateDigests(rows);
      digested += rows.length;
      failed += results.length - rows.length;
    }
    return { digested, failed };
  } catch (err) {
    console.error('[digest] digestStaleArticles failed:', err);
    return { digested: 0, failed: 0 };
  }
}
```

- [ ] **Step 4: Run and verify they pass**

Run: `npx vitest run src/lib/digest.test.ts`
Expected: PASS. (`npm run typecheck` will fail until Task 4 removes the route's
`getArticleDigests` import — that's expected mid-stream; don't "fix" it by
resurrecting the function.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/digest.ts src/lib/digest.test.ts
git commit -m "feat(digest): ingest-time digestStaleArticles, drop in-memory cache"
```

---

### Task 3: wire the digest step into ingest

**Files:**
- Modify: `src/lib/scraper.ts` (inside `scrapeAndPersist()`, after the
  `embedStaleArticles` call at ~:505)
- Test: `src/lib/scraper.db.test.ts`

**Interfaces:**
- Consumes: `digestStaleArticles(rows)` (Task 2).
- Produces: nothing new — ingest side effect only.

- [ ] **Step 1: Write the failing test.** In `src/lib/scraper.db.test.ts`, add a
  hoisted mock next to the existing `embedArticles` mock:

```ts
const digestMod = vi.hoisted(() => ({ digestStaleArticles: vi.fn() }));
vi.mock('@/lib/digest', () => digestMod);
```

(in `beforeEach`, alongside the other resets:)

```ts
digestMod.digestStaleArticles.mockReset().mockResolvedValue({ digested: 0, failed: 0 });
```

New test (place beside the existing successful-scrape assertions; reuse the
suite's `makeFetchMock`/`freshScraper` helpers):

```ts
it('a successful scrape hands the upserted rows to digestStaleArticles', async () => {
  vi.stubGlobal('fetch', makeFetchMock());
  const scraper = await freshScraper();
  await scraper.getClaudeArticles({ force: true });
  expect(digestMod.digestStaleArticles).toHaveBeenCalledTimes(1);
  const rows = digestMod.digestStaleArticles.mock.calls[0][0];
  expect(rows).toEqual(db.upsertArticles.mock.calls[0][0]);
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run src/lib/scraper.db.test.ts`
Expected: FAIL — `digestStaleArticles` not called.

- [ ] **Step 3: Implement.** In `src/lib/scraper.ts`, add the import next to the
  `embedStaleArticles` import:

```ts
import { digestStaleArticles } from './digest';
```

In `scrapeAndPersist()`, directly after the `const embedRun = await
embedStaleArticles(rows);` line, add:

```ts
    // Digest new/changed articles for the drawer score card. Internally
    // guarded: no-ops without ANTHROPIC_API_KEY and never throws — a digest
    // failure must not block ingest (failures retry next run via digest_hash).
    const digestRun = await digestStaleArticles(rows);
    if (digestRun.digested || digestRun.failed) {
      console.log(`[scraper] digests: ${digestRun.digested} written, ${digestRun.failed} failed`);
    }
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run src/lib/scraper.db.test.ts`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scraper.ts src/lib/scraper.db.test.ts
git commit -m "feat(scraper): generate article digests during ingest"
```

---

### Task 4: `/api/digest` becomes a pure DB read

**Files:**
- Modify: `src/app/api/digest/route.ts` (full rewrite below)
- Test: Create `src/app/api/digest/route.test.ts`

**Interfaces:**
- Consumes: `db.getDigests()` (Task 1).
- Produces: `GET /api/digest` → `{ digests: Record<url, ArticleDigest> }`
  (shape unchanged for `AppShell.tsx:173`).

- [ ] **Step 1: Write the failing tests** — create
  `src/app/api/digest/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const dbMock = vi.hoisted(() => ({ getDigests: vi.fn() }));
vi.mock('@/lib/db', () => dbMock);

const VALID = {
  tldr: 'A one-liner.',
  takeaways: ['a', 'b', 'c'],
  whyItMatters: 'It matters.',
  tags: ['X', 'Y', 'Z'],
  questions: ['Q1?', 'Q2?'],
};

beforeEach(() => dbMock.getDigests.mockReset());
afterEach(() => vi.resetModules());

describe('GET /api/digest', () => {
  it('returns the persisted digest map', async () => {
    dbMock.getDigests.mockResolvedValue({ 'https://claude.com/blog/post': VALID });
    const { GET } = await import('./route');
    const res = await GET();
    expect(await res.json()).toEqual({ digests: { 'https://claude.com/blog/post': VALID } });
  });

  it('fails soft to an empty map on a DB error', async () => {
    dbMock.getDigests.mockRejectedValue(new Error('pooler down'));
    const { GET } = await import('./route');
    const res = await GET();
    expect(await res.json()).toEqual({ digests: {} });
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx vitest run src/app/api/digest/route.test.ts`
Expected: FAIL — route still calls `getArticleDigests` (deleted in Task 2), or
map mismatch.

- [ ] **Step 3: Implement** — replace `src/app/api/digest/route.ts` entirely
  with:

```ts
import { NextResponse } from 'next/server';
import { getDigests } from '@/lib/db';

// Run at runtime, NOT statically prerendered at build: the digest map lives in
// Postgres and must be read with the runtime connection string. Generation
// happens at ingest (lib/digest.ts:digestStaleArticles) — this route never
// calls an LLM, so it needs no maxDuration headroom.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const digests = await getDigests();
    return NextResponse.json({ digests });
  } catch (err) {
    console.error('[api/digest] failed:', err);
    // Fail soft: the drawer renders its description-only fallback when the map is empty.
    return NextResponse.json({ digests: {} });
  }
}
```

- [ ] **Step 4: Run and verify they pass**

Run: `npx vitest run src/app/api/digest/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/digest/route.ts src/app/api/digest/route.test.ts
git commit -m "feat(api): serve article digests from Postgres, no request-time generation"
```

---

### Task 5: quality gate + empirical verification

- [ ] **Step 1: Full gate**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green. Fix anything red before proceeding (typecheck now sees the
route import change from Task 4).

- [ ] **Step 2: Seed + verify against the real DB** (`.env.local` provides
  `POSTGRES_URL`, `ANTHROPIC_API_KEY`, `CRON_SECRET`):

```bash
npm run dev &   # wait for ready
# Trigger one ingest — generates + persists digests (real Sonnet calls, one-time seed):
curl -s -H "Authorization: Bearer $(grep '^CRON_SECRET' .env.local | cut -d= -f2)" \
  http://localhost:3000/api/scrape/refresh
# Pure-read check — second call must be DB-only and fast:
time curl -s http://localhost:3000/api/digest | head -c 400
```

Expected: the refresh response reports success; `/api/digest` returns a
populated `digests` map in well under 1s. Record both outputs in the report.

- [ ] **Step 3: Verify rows in Postgres**

```bash
psql "$(grep '^POSTGRES_URL' .env.local | head -1 | cut -d= -f2-)" \
  -c "SELECT count(*) AS total, count(digest) AS with_digest FROM articles;"
```

Expected: `with_digest` ≈ `total` (a few nulls are tolerable — those are
recorded failures that retry next ingest). Paste the output in the report. If
`psql` is unavailable, run the equivalent one-off with
`node -e` + the `postgres` package and record that instead.

- [ ] **Step 4: Eyeball the drawer (no-regression evidence, not a UI change)**

Open http://localhost:3000, open an article drawer, screenshot the populated
score card to `brain/03-build-reports/22-persist-article-digests/drawer.png`.

- [ ] **Step 5: Final commit + report**

Update `brain/03-build-reports/22-persist-article-digests/report.md` (done /
evidence / blockers), then:

```bash
git add brain/03-build-reports/22-persist-article-digests/
git commit -m "test: digest persistence verification evidence"
```

Stop hook note: do not run `bd` — beads is the orchestrator's.
