# Persistent KB Store (Neon Postgres) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make articles + per-article summaries durable in Neon Postgres so cold starts read precomputed rows instead of re-scraping and re-summarizing, and so unchanged articles are never re-summarized across instances.

**Architecture:** Postgres is the single durable source of truth, written by the hourly Vercel Cron via the existing `/api/scrape/refresh`. `getClaudeArticles()` becomes **DB-first** with a **live self-heal** fallback (scrape+summarize inline + write back) for gaps. A new `src/lib/db.ts` owns all SQL; `summarize.ts` gains a durable dedup map; `getIngestionStatus()` is fed by a module snapshot refreshed from `kb_meta`.

**Tech Stack:** Next.js 14 (App Router) · TypeScript 5 · `@neondatabase/serverless` (HTTP driver) · Neon Postgres (Vercel Marketplace) · Vitest.

**Spec:** `spec/kb-postgres-store/spec.md`. Prior art it builds on: `spec/blog-ingestion/dev-03-auto-refresh.md`, `spec/chat-latency/spec.md`.

## Global Constraints

Every task's requirements implicitly include these (verbatim from the spec):

- **`Article` shape unchanged.** `getClaudeArticles()` still resolves to `Article[]` newest-first; `/api/scrape` and `buildArticleContext` consumers untouched.
- **Grounding bytes stable when content is unchanged.** `buildArticleContext` is not modified; for unchanged content the assembled string is byte-identical.
- **`getIngestionStatus()` shape preserved and synchronous.** Same `IngestionStatus` object; routes are not changed.
- **Cron auth preserved.** `Bearer $CRON_SECRET` check in `refresh/route.ts` unchanged; fails closed (401).
- **Quality gate (all must pass):** `npm run lint`, `npm run typecheck`, `npm run test:run`. Node 24+ (`nvm use`).
- **Dependencies:** add **only** `@neondatabase/serverless`. No ORM / migration framework.
- **Hourly cron requires Vercel Pro** (Hobby caps crons at once/day).
- **Path alias:** `@/*` → `./src/*`. Tests use Vitest globals + explicit imports, `vi.resetModules()` + dynamic `import()` for fresh module state, `vi.stubGlobal('fetch', …)` for scrape, `vi.mock('@/lib/…')` for module boundaries.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `db/schema.sql` | Canonical DDL (reference + manual setup) | Create |
| `src/lib/db.ts` | All Postgres access; safe no-op when `DATABASE_URL` unset | Create |
| `src/lib/db.test.ts` | Unit tests for `db.ts` (neon client mocked) | Create |
| `src/lib/summarize.ts` | `summarizeAll(articles, known?)` → `SummaryResult[]`; durable dedup | Modify |
| `src/lib/summarize.test.ts` | Update assertions to the `{summary,hash}` shape; add known-map cases | Modify |
| `src/lib/scraper.ts` | `getClaudeArticles` DB-first + self-heal + single-flight; snapshot-fed `getIngestionStatus` | Modify |
| `src/lib/scraper.db.test.ts` | DB-aware tests (DB-hit, self-heal, single-flight, status-from-meta, last-good-on-failure) | Create |
| `src/lib/scraper.test.ts` | Remove the module-memory "June 10→15" regression test (superseded by the DB-backed one) | Modify |
| `vercel.json` | Cron `0 6 * * *` → `0 * * * *` | Modify |
| `package.json` | Add `@neondatabase/serverless` | Modify |
| `.env.example` | Add `DATABASE_URL` | Modify |
| `README.md` | Built-with + How-it's-wired + env table + cron cadence | Modify |

**Note (no change):** `src/app/api/scrape/refresh/route.ts` already calls `getClaudeArticles({ force: true })` → `revalidateTag(GROUNDING_TAG)` → `Response.json(getIngestionStatus())`. The new persist logic lives inside `getClaudeArticles`, so the route and its test (`refresh/route.test.ts`) are unchanged. Likewise `/api/scrape/route.ts`, `/api/chat/route.ts`, and `getGroundingContext` need no edits — they read through `getClaudeArticles()`, now DB-backed.

---

## Task 1: Provision dependency, schema file, and config

**Files:**
- Modify: `package.json` (dependencies)
- Create: `db/schema.sql`
- Modify: `.env.example`
- Modify: `vercel.json`

**Interfaces:**
- Produces: the `@neondatabase/serverless` dependency that Task 2's `db.ts` imports; the `DATABASE_URL` env var contract.

- [ ] **Step 1: Install the driver**

Run: `npm install @neondatabase/serverless`
Expected: `package.json` `dependencies` gains `"@neondatabase/serverless": "^x.y.z"`; `package-lock.json` updated; install exits 0.

- [ ] **Step 2: Create the canonical schema file**

Create `db/schema.sql`:

```sql
-- Canonical DDL for the persistent KB store (spec/kb-postgres-store).
-- Created idempotently at runtime by src/lib/db.ts:ensureSchema(); this file
-- is the human-readable reference and can be run by hand in the Neon console.

CREATE TABLE IF NOT EXISTS articles (
  slug        TEXT PRIMARY KEY,
  hash        TEXT NOT NULL DEFAULT '',   -- djb2(title+body); '' = no cached summary (force re-summarize)
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  pub_date    TIMESTAMPTZ,                -- nullable; dateless posts sort last
  description TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  summary     TEXT NOT NULL DEFAULT '',
  hero_image  TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_meta (
  id                    INT PRIMARY KEY DEFAULT 1,
  last_successful_fetch TIMESTAMPTZ,
  last_error            TEXT,
  CONSTRAINT kb_meta_singleton CHECK (id = 1)
);
```

- [ ] **Step 3: Document the env var**

Add to `.env.example` (below the existing keys):

```env
# Neon Postgres connection string (set automatically by the Vercel Neon integration).
# Required in production; optional locally — without it the app live-scrapes every request.
DATABASE_URL=postgres://...
```

- [ ] **Step 4: Switch the cron to hourly**

Edit `vercel.json` — change the schedule (requires Vercel Pro):

```json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "installCommand": "npm install",
  "crons": [{ "path": "/api/scrape/refresh", "schedule": "0 * * * *" }]
}
```

- [ ] **Step 5: Verify the toolchain still builds**

Run: `npm run typecheck`
Expected: PASS (no source changed yet; confirms the dependency install didn't break types).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json db/schema.sql .env.example vercel.json
git commit -m "chore(kb): add neon driver, schema.sql, DATABASE_URL, hourly cron"
```

---

## Task 2: `src/lib/db.ts` — Postgres access layer

**Files:**
- Create: `src/lib/db.ts`
- Test: `src/lib/db.test.ts`

**Interfaces:**
- Consumes: `@neondatabase/serverless` `neon()`; `Article` **type** from `./scraper` (type-only import — no runtime cycle).
- Produces (used by Task 3/4):
  - `slugFromUrl(url: string): string`
  - `ensureSchema(): Promise<void>`
  - `getArticles(): Promise<Article[]>`
  - `getKnownSummaries(): Promise<Map<string, { hash: string; summary: string }>>`
  - `upsertArticles(rows: ArticleRow[]): Promise<void>` where `ArticleRow = Article & { hash: string }`
  - `deleteMissing(keepSlugs: string[]): Promise<void>`
  - `readMeta(): Promise<KbMeta>` where `KbMeta = { lastSuccessfulFetch: number | null; lastError: string | null }`
  - `writeMeta(patch: { lastSuccessfulFetch?: number | null; lastError?: string | null }): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/db.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// A tagged-template stub: records each call's SQL fragments and returns a canned result.
const { sqlMock, neonMock } = vi.hoisted(() => {
  const sqlMock = vi.fn();
  return { sqlMock, neonMock: vi.fn(() => sqlMock) };
});
vi.mock('@neondatabase/serverless', () => ({ neon: neonMock }));

const ORIGINAL_URL = process.env.DATABASE_URL;

async function freshDb() {
  vi.resetModules();
  return import('./db');
}
/** Latest SQL text passed to the stub (template strings joined with '?'). */
function lastSql(): string {
  const call = sqlMock.mock.calls.at(-1)!;
  return (call[0] as string[]).join('?');
}

beforeEach(() => {
  sqlMock.mockReset().mockResolvedValue([]);
  neonMock.mockClear();
  process.env.DATABASE_URL = 'postgres://test';
});

describe('db.ts — no-op without DATABASE_URL', () => {
  it('returns safe empties and never constructs a client', async () => {
    delete process.env.DATABASE_URL;
    const db = await freshDb();
    expect(await db.getArticles()).toEqual([]);
    expect(await db.getKnownSummaries()).toEqual(new Map());
    await expect(db.upsertArticles([])).resolves.toBeUndefined();
    await expect(db.deleteMissing(['x'])).resolves.toBeUndefined();
    expect(await db.readMeta()).toEqual({ lastSuccessfulFetch: null, lastError: null });
    expect(neonMock).not.toHaveBeenCalled();
    if (ORIGINAL_URL !== undefined) process.env.DATABASE_URL = ORIGINAL_URL;
  });
});

describe('db.ts — queries', () => {
  it('slugFromUrl extracts the /blog/<slug> segment', async () => {
    const db = await freshDb();
    expect(db.slugFromUrl('https://claude.com/blog/claude-opus-4-8?x=1')).toBe('claude-opus-4-8');
  });

  it('getArticles maps rows to the Article shape, ISO pubDate', async () => {
    sqlMock.mockResolvedValueOnce([]); // ensureSchema: articles
    sqlMock.mockResolvedValueOnce([]); // ensureSchema: kb_meta
    sqlMock.mockResolvedValueOnce([
      { slug: 'a', hash: 'h', title: 'A', url: 'https://claude.com/blog/a',
        pub_date: '2026-06-10T09:00:00.000Z', description: 'd', body: 'b',
        summary: 's', hero_image: '' },
    ]);
    const db = await freshDb();
    const out = await db.getArticles();
    expect(out).toEqual([
      { title: 'A', url: 'https://claude.com/blog/a', pubDate: '2026-06-10T09:00:00.000Z',
        description: 'd', body: 'b', summary: 's', heroImage: '' },
    ]);
  });

  it('getKnownSummaries excludes empty-hash rows', async () => {
    sqlMock.mockResolvedValueOnce([]); // schema
    sqlMock.mockResolvedValueOnce([]); // schema
    sqlMock.mockResolvedValueOnce([{ slug: 'a', hash: 'h1', summary: 's1' }]); // WHERE hash <> ''
    const db = await freshDb();
    const map = await db.getKnownSummaries();
    expect(map.get('a')).toEqual({ hash: 'h1', summary: 's1' });
    expect(lastSql()).toContain("hash <> ''");
  });

  it('upsertArticles issues an ON CONFLICT upsert per row', async () => {
    const db = await freshDb();
    await db.upsertArticles([
      { title: 'A', url: 'https://claude.com/blog/a', pubDate: '', description: '',
        body: '', summary: 's', heroImage: '', hash: 'h' },
    ]);
    expect(lastSql()).toContain('ON CONFLICT (slug) DO UPDATE');
  });

  it('deleteMissing no-ops on an empty keep list (never wipes)', async () => {
    const db = await freshDb();
    sqlMock.mockClear();
    await db.deleteMissing([]);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('writeMeta merges: an error-only patch preserves the existing fetch time', async () => {
    sqlMock.mockResolvedValueOnce([]); // schema articles
    sqlMock.mockResolvedValueOnce([]); // schema kb_meta
    sqlMock.mockResolvedValueOnce([    // readMeta (inside writeMeta)
      { last_successful_fetch: '2026-06-10T00:00:00.000Z', last_error: null },
    ]);
    const db = await freshDb();
    await db.writeMeta({ lastError: 'boom' });
    const call = sqlMock.mock.calls.at(-1)!;
    // values appended after the template strings: [id=1, tsIso, lastError]
    expect(call).toContain('boom');
    expect(call).toContain('2026-06-10T00:00:00.000Z'); // fetch time preserved
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:run -- src/lib/db.test.ts`
Expected: FAIL — `Cannot find module './db'`.

- [ ] **Step 3: Implement `src/lib/db.ts`**

```ts
import { neon } from '@neondatabase/serverless';
import type { Article } from './scraper';

export interface ArticleRow extends Article {
  hash: string;
}
export interface KbMeta {
  lastSuccessfulFetch: number | null; // epoch ms
  lastError: string | null;
}

const url = process.env.DATABASE_URL;
// HTTP driver: `sql` is a tagged-template query fn. Null when unconfigured → every export no-ops.
const sql = url ? neon(url) : null;

/** Canonical slug derivation (PK). Mirrors the blog URL shape. */
export function slugFromUrl(u: string): string {
  const m = u.match(/\/blog\/([^/?#]+)/);
  return m ? m[1] : u;
}

let schemaReady: Promise<void> | null = null;
export async function ensureSchema(): Promise<void> {
  if (!sql) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS articles (
        slug TEXT PRIMARY KEY, hash TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
        url TEXT NOT NULL, pub_date TIMESTAMPTZ, description TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
        hero_image TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS kb_meta (
        id INT PRIMARY KEY DEFAULT 1, last_successful_fetch TIMESTAMPTZ, last_error TEXT,
        CONSTRAINT kb_meta_singleton CHECK (id = 1)
      )`;
    })();
  }
  return schemaReady;
}

type Row = Record<string, unknown>;
function rowToArticle(r: Row): Article {
  const pd = r.pub_date as string | Date | null;
  return {
    title: String(r.title ?? ''),
    url: String(r.url ?? ''),
    pubDate: pd ? new Date(pd).toISOString() : '',
    description: String(r.description ?? ''),
    body: String(r.body ?? ''),
    summary: String(r.summary ?? ''),
    heroImage: String(r.hero_image ?? ''),
  };
}

export async function getArticles(): Promise<Article[]> {
  if (!sql) return [];
  await ensureSchema();
  const rows = (await sql`
    SELECT slug, hash, title, url, pub_date, description, body, summary, hero_image
    FROM articles ORDER BY pub_date DESC NULLS LAST`) as Row[];
  return rows.map(rowToArticle);
}

export async function getKnownSummaries(): Promise<Map<string, { hash: string; summary: string }>> {
  const map = new Map<string, { hash: string; summary: string }>();
  if (!sql) return map;
  await ensureSchema();
  const rows = (await sql`SELECT slug, hash, summary FROM articles WHERE hash <> ''`) as Row[];
  for (const r of rows) map.set(String(r.slug), { hash: String(r.hash), summary: String(r.summary) });
  return map;
}

export async function upsertArticles(rows: ArticleRow[]): Promise<void> {
  if (!sql || rows.length === 0) return;
  await ensureSchema();
  for (const a of rows) {
    await sql`
      INSERT INTO articles (slug, hash, title, url, pub_date, description, body, summary, hero_image, updated_at)
      VALUES (${slugFromUrl(a.url)}, ${a.hash}, ${a.title}, ${a.url}, ${a.pubDate || null},
              ${a.description}, ${a.body}, ${a.summary}, ${a.heroImage}, now())
      ON CONFLICT (slug) DO UPDATE SET
        hash = EXCLUDED.hash, title = EXCLUDED.title, url = EXCLUDED.url,
        pub_date = EXCLUDED.pub_date, description = EXCLUDED.description, body = EXCLUDED.body,
        summary = EXCLUDED.summary, hero_image = EXCLUDED.hero_image, updated_at = now()`;
  }
}

export async function deleteMissing(keepSlugs: string[]): Promise<void> {
  if (!sql || keepSlugs.length === 0) return; // empty list → never wipe the table
  await ensureSchema();
  await sql`DELETE FROM articles WHERE slug <> ALL(${keepSlugs})`;
}

export async function readMeta(): Promise<KbMeta> {
  if (!sql) return { lastSuccessfulFetch: null, lastError: null };
  await ensureSchema();
  const rows = (await sql`SELECT last_successful_fetch, last_error FROM kb_meta WHERE id = 1`) as Row[];
  if (rows.length === 0) return { lastSuccessfulFetch: null, lastError: null };
  const r = rows[0];
  return {
    lastSuccessfulFetch: r.last_successful_fetch ? new Date(r.last_successful_fetch as string).getTime() : null,
    lastError: (r.last_error as string | null) ?? null,
  };
}

export async function writeMeta(patch: { lastSuccessfulFetch?: number | null; lastError?: string | null }): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  const current = await readMeta();
  const nextFetch = patch.lastSuccessfulFetch !== undefined ? patch.lastSuccessfulFetch : current.lastSuccessfulFetch;
  const nextError = patch.lastError !== undefined ? patch.lastError : current.lastError;
  const tsIso = nextFetch != null ? new Date(nextFetch).toISOString() : null;
  await sql`
    INSERT INTO kb_meta (id, last_successful_fetch, last_error)
    VALUES (1, ${tsIso}, ${nextError})
    ON CONFLICT (id) DO UPDATE SET
      last_successful_fetch = EXCLUDED.last_successful_fetch, last_error = EXCLUDED.last_error`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:run -- src/lib/db.test.ts`
Expected: PASS (all `db.ts` cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts src/lib/db.test.ts
git commit -m "feat(kb): Postgres access layer (db.ts) with no-op fallback"
```

---

## Task 3: `summarize.ts` — durable dedup map + result shape

**Files:**
- Modify: `src/lib/summarize.ts`
- Test: `src/lib/summarize.test.ts`

**Interfaces:**
- Produces: `summarizeAll(articles, known?: Map<string, { hash; summary }>): Promise<SummaryResult[]>` where `SummaryResult = { summary: string; hash: string }` (`hash === ''` marks a fallback excerpt — not safe to cache).
- Consumed by: Task 4 `scraper.ts` (reads `.summary` and `.hash` per article).

- [ ] **Step 1: Update existing assertions + add known-map tests (failing)**

In `src/lib/summarize.test.ts`, update the caching/ordering assertions to the new shape and add a durable-dedup case. Replace the bodies of the three tests under `describe('summarizeAll — caching')` / ordering with:

```ts
  it('reuses cached summaries on a second identical pass (0 new API calls)', async () => {
    createMock.mockResolvedValue(cannedText('canned summary'));
    const { summarizeAll } = await freshSummarize();
    const articles = [
      article({ url: 'https://claude.com/blog/a', body: 'body a' }),
      article({ url: 'https://claude.com/blog/b', body: 'body b' }),
      article({ url: 'https://claude.com/blog/c', body: 'body c' }),
    ];
    const first = await summarizeAll(articles);
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(first.every((r) => r.summary === 'canned summary')).toBe(true);
    expect(first.every((r) => r.hash !== '')).toBe(true); // real summaries carry a hash
    const second = await summarizeAll(articles);
    expect(createMock).toHaveBeenCalledTimes(3); // all L1 cache hits
    expect(second).toEqual(first);
  });

  it('summarizes aligned to input order', async () => {
    createMock.mockImplementation(async (reqArg: { messages: { content: string }[] }) =>
      cannedText(`summary of: ${reqArg.messages[0].content.split('\n')[0]}`)
    );
    const { summarizeAll } = await freshSummarize();
    const articles = [
      article({ title: 'First', url: 'https://claude.com/blog/a', body: 'body a' }),
      article({ title: 'Second', url: 'https://claude.com/blog/b', body: 'body b' }),
    ];
    const out = await summarizeAll(articles);
    expect(out[0].summary).toContain('First');
    expect(out[1].summary).toContain('Second');
  });
```

Add two new tests (durable dedup + fallback) inside the same describe:

```ts
  it('reuses a durable summary from the known map (0 API calls) when the hash matches', async () => {
    const { summarizeAll, contentHash } = await freshSummarize();
    const a = article({ url: 'https://claude.com/blog/a', body: 'body a' });
    const known = new Map([['a', { hash: contentHash(a.title, a.body), summary: 'durable summary' }]]);
    const out = await summarizeAll([a], known);
    expect(createMock).not.toHaveBeenCalled();
    expect(out[0]).toEqual({ summary: 'durable summary', hash: contentHash(a.title, a.body) });
  });

  it('marks an API-error fallback with hash === "" so it is not cached', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    createMock.mockRejectedValue(new Error('API down'));
    const { summarizeAll } = await freshSummarize();
    const a = article({ url: 'https://claude.com/blog/a', body: 'A body to excerpt.' });
    const out = await summarizeAll([a]);
    expect(out[0].summary).toBe('A body to excerpt.');
    expect(out[0].hash).toBe('');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:run -- src/lib/summarize.test.ts`
Expected: FAIL — `out[0].summary` undefined (still returns strings); `contentHash` not exported.

- [ ] **Step 3: Implement the change in `src/lib/summarize.ts`**

Export `contentHash` (change `function contentHash` → `export function contentHash`). Then replace `summarizeAll` with:

```ts
export interface SummaryResult {
  summary: string;
  hash: string; // '' = fallback excerpt (do not cache)
}

export async function summarizeAll(
  articles: SummarizableArticle[],
  known?: Map<string, { hash: string; summary: string }>,
): Promise<SummaryResult[]> {
  const results = new Array<SummaryResult>(articles.length);
  const misses: { index: number; slug: string; hash: string; article: SummarizableArticle }[] = [];

  articles.forEach((article, index) => {
    const slug = slugFromUrl(article.url);
    const hash = contentHash(article.title, article.body ?? '');
    const local = summaryCache.get(slug);
    const durable = known?.get(slug);
    if (local && local.hash === hash) {
      results[index] = { summary: local.summary, hash };
    } else if (durable && durable.hash === hash) {
      summaryCache.set(slug, { hash, summary: durable.summary }); // promote to L1
      results[index] = { summary: durable.summary, hash };
    } else {
      misses.push({ index, slug, hash, article });
    }
  });

  for (let i = 0; i < misses.length; i += CONCURRENCY) {
    const chunk = misses.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async ({ index, slug, hash, article }) => {
        const summary = await summarizeArticle(article);
        // A returned value equal to the body excerpt means summarization fell back
        // (no client / API error / empty body). Do not cache it — retry next run.
        const isFallback = summary === fallbackExcerpt(article.body);
        if (isFallback) {
          results[index] = { summary, hash: '' };
        } else {
          summaryCache.set(slug, { hash, summary });
          results[index] = { summary, hash };
        }
      })
    );
  }

  return results;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:run -- src/lib/summarize.test.ts`
Expected: PASS — including the new durable-dedup and fallback cases; the bounded-concurrency and "re-summarizes exactly one" tests still pass (they assert call counts only).

- [ ] **Step 5: Commit**

```bash
git add src/lib/summarize.ts src/lib/summarize.test.ts
git commit -m "feat(kb): durable summary dedup via known-hash map; {summary,hash} result"
```

---

## Task 4: `scraper.ts` — DB-first reads + live self-heal

**Files:**
- Modify: `src/lib/scraper.ts`
- Create: `src/lib/scraper.db.test.ts`
- Modify: `src/lib/scraper.test.ts` (remove the superseded module-memory regression test)

**Interfaces:**
- Consumes: `db.getArticles`, `db.getKnownSummaries`, `db.upsertArticles`, `db.deleteMissing`, `db.readMeta`, `db.writeMeta`, `db.slugFromUrl` (Task 2); `summarizeAll(articles, known) → SummaryResult[]` (Task 3).
- Produces: `getClaudeArticles({ force? }): Promise<Article[]>` (unchanged signature); `getIngestionStatus(): IngestionStatus` (unchanged, sync).

- [ ] **Step 1: Write the failing DB-aware tests**

Create `src/lib/scraper.db.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Anthropic SDK (no live calls) and the DB layer (control source of truth).
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn(() => ({ messages: { create: createMock } })) }));

const db = vi.hoisted(() => ({
  getArticles: vi.fn(), getKnownSummaries: vi.fn(), upsertArticles: vi.fn(),
  deleteMissing: vi.fn(), readMeta: vi.fn(), writeMeta: vi.fn(),
  slugFromUrl: (u: string) => (u.match(/\/blog\/([^/?#]+)/)?.[1] ?? u),
}));
vi.mock('@/lib/db', () => db);

const ORIGIN = 'https://claude.com';
const articleRow = (slug: string) => ({
  title: `T ${slug}`, url: `${ORIGIN}/blog/${slug}`, pubDate: '2026-06-10T09:00:00.000Z',
  description: 'd', body: 'b', summary: 's', heroImage: '',
});

function htmlResponse(body: string, ok = true, status = 200): Response {
  return { ok, status, text: () => Promise.resolve(body) } as unknown as Response;
}
function indexHtml() {
  return `<!doctype html><html><body><main>
    <article><a href="/blog/post-a">Post A</a><time datetime="2026-06-10T09:00:00.000Z">x</time></article>
  </main></body></html>`;
}
function articleHtml() {
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'BlogPosting', headline: 'Post A', datePublished: '2026-06-10T09:00:00.000Z', description: 'JSON-LD desc.' }] };
  return `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head>
    <body><main><p>Body paragraph.</p></main></body></html>`;
}
function makeFetchMock() {
  return vi.fn((input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === `${ORIGIN}/blog`) return Promise.resolve(htmlResponse(indexHtml()));
    return Promise.resolve(htmlResponse(articleHtml()));
  });
}
async function freshScraper() { vi.resetModules(); return import('./scraper'); }

beforeEach(() => {
  vi.restoreAllMocks();
  createMock.mockReset().mockResolvedValue({ content: [{ type: 'text', text: 'Canned.' }] });
  db.getArticles.mockReset().mockResolvedValue([]);
  db.getKnownSummaries.mockReset().mockResolvedValue(new Map());
  db.upsertArticles.mockReset().mockResolvedValue(undefined);
  db.deleteMissing.mockReset().mockResolvedValue(undefined);
  db.readMeta.mockReset().mockResolvedValue({ lastSuccessfulFetch: null, lastError: null });
  db.writeMeta.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('getClaudeArticles — DB-first', () => {
  it('serves fresh DB rows without scraping or summarizing', async () => {
    db.getArticles.mockResolvedValue([articleRow('post-a')]);
    db.readMeta.mockResolvedValue({ lastSuccessfulFetch: Date.now(), lastError: null });
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles } = await freshScraper();
    const out = await getClaudeArticles();
    expect(out).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('self-heals on an empty DB: scrapes, summarizes, persists, returns rows', async () => {
    db.getArticles.mockResolvedValue([]); // empty → self-heal
    vi.stubGlobal('fetch', makeFetchMock());
    const { getClaudeArticles } = await freshScraper();
    const out = await getClaudeArticles();
    expect(out.length).toBeGreaterThan(0);
    expect(createMock).toHaveBeenCalled();
    expect(db.upsertArticles).toHaveBeenCalled();
    expect(db.writeMeta).toHaveBeenCalledWith(expect.objectContaining({ lastError: null }));
  });

  it('self-heals when the DB is stale (older than the threshold)', async () => {
    db.getArticles.mockResolvedValue([articleRow('post-a')]);
    db.readMeta.mockResolvedValue({ lastSuccessfulFetch: Date.now() - 4 * 60 * 60 * 1000, lastError: null });
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles } = await freshScraper();
    await getClaudeArticles();
    expect(fetchMock).toHaveBeenCalled(); // 4h > 3h threshold → scraped
  });

  it('collapses two concurrent cold reads into a single scrape (single-flight)', async () => {
    db.getArticles.mockResolvedValue([]);
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles } = await freshScraper();
    await Promise.all([getClaudeArticles(), getClaudeArticles()]);
    const indexCalls = fetchMock.mock.calls.filter(([u]) => String(u) === `${ORIGIN}/blog`);
    expect(indexCalls).toHaveLength(1);
  });

  it('on scrape failure serves last-good DB rows, records the error, and keeps the clock', async () => {
    db.getArticles.mockResolvedValue([articleRow('post-a')]); // last-good lives in the DB now
    db.readMeta.mockResolvedValue({ lastSuccessfulFetch: 0, lastError: null }); // 0 = never → forces self-heal
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))));
    const { getClaudeArticles, getIngestionStatus } = await freshScraper();
    const out = await getClaudeArticles();
    expect(out).toHaveLength(1); // served from DB, not []
    expect(db.writeMeta).toHaveBeenCalledWith(expect.objectContaining({ lastError: expect.any(String) }));
    expect(getIngestionStatus().lastError).toBeTruthy();
  });

  it('getIngestionStatus reflects kb_meta after a DB-hit read', async () => {
    const ts = Date.parse('2026-06-18T00:00:00.000Z');
    db.getArticles.mockResolvedValue([articleRow('post-a')]);
    db.readMeta.mockResolvedValue({ lastSuccessfulFetch: ts, lastError: null });
    vi.stubGlobal('fetch', makeFetchMock());
    const { getClaudeArticles, getIngestionStatus } = await freshScraper();
    await getClaudeArticles();
    const s = getIngestionStatus();
    expect(s.count).toBe(1);
    expect(s.lastSuccessfulFetch).toBe('2026-06-18T00:00:00.000Z');
    expect(s.lastError).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:run -- src/lib/scraper.db.test.ts`
Expected: FAIL — current `getClaudeArticles` ignores the DB (scrapes regardless; no `db.*` calls).

- [ ] **Step 3: Rewrite the cache/status core in `src/lib/scraper.ts`**

Add the import (value import; `db.ts` imports `Article` type-only, so no runtime cycle):

```ts
import * as db from './db';
```

Replace the module cache + freshness block (`let cachedArticles … const STALE_THRESHOLD_MS = …`) with:

```ts
// --- Read-through cache + freshness snapshot (DB is the source of truth) ---
const READ_CACHE_TTL_MS = 60 * 1000;            // short in-mem cache over Postgres reads
const STALE_THRESHOLD_MS = 3 * 60 * 60 * 1000;  // age beyond which a read self-heals (a few missed hourly runs)

let readCache: Article[] | null = null;
let readCacheTime = 0;
let inflight: Promise<Article[]> | null = null;

// Synchronous status snapshot, refreshed from kb_meta on every getClaudeArticles call.
let snapCount = 0;
let snapLastSuccess = 0; // epoch ms, 0 = never
let snapError: string | null = null;
```

Replace `getIngestionStatus()` body with the snapshot version (identical `IngestionStatus` shape):

```ts
export function getIngestionStatus(): IngestionStatus {
  const ageMs = snapLastSuccess ? Date.now() - snapLastSuccess : null;
  return {
    count: snapCount,
    lastSuccessfulFetch: snapLastSuccess ? new Date(snapLastSuccess).toISOString() : null,
    ageMs,
    stale: ageMs === null || ageMs > STALE_THRESHOLD_MS,
    lastError: snapError,
  };
}
```

- [ ] **Step 4: Replace `getClaudeArticles` with the DB-first + self-heal version**

```ts
export async function getClaudeArticles(opts: { force?: boolean } = {}): Promise<Article[]> {
  if (!opts.force) {
    if (readCache && Date.now() - readCacheTime < READ_CACHE_TTL_MS) return readCache;
    const [rows, meta] = await Promise.all([db.getArticles(), db.readMeta()]);
    snapCount = rows.length;
    snapLastSuccess = meta.lastSuccessfulFetch ?? 0;
    snapError = meta.lastError;
    const fresh = meta.lastSuccessfulFetch != null && Date.now() - meta.lastSuccessfulFetch <= STALE_THRESHOLD_MS;
    if (rows.length > 0 && fresh) {
      readCache = rows;
      readCacheTime = Date.now();
      return rows;
    }
    // empty or stale → fall through to a self-heal scrape
  }
  if (!inflight) {
    inflight = scrapeAndPersist().finally(() => { inflight = null; });
  }
  return inflight;
}

/** Scrape + summarize misses + persist. On failure, serve last-good DB rows. */
async function scrapeAndPersist(): Promise<Article[]> {
  try {
    const res = await fetch(CLAUDE_BLOG, { headers: FETCH_HEADERS, next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`Blog index fetch failed: HTTP ${res.status}`);
    const html = await res.text();
    const cards = parseIndex(html);
    const fetched = await Promise.all(cards.map(fetchArticleBody));
    const articles = fetched.sort((a, b) => dateValue(b.pubDate) - dateValue(a.pubDate));

    const known = await db.getKnownSummaries();
    const results = await summarizeAll(articles, known);
    articles.forEach((a, i) => { a.summary = results[i].summary; });

    const rows = articles.map((a, i) => ({ ...a, hash: results[i].hash }));
    await db.upsertArticles(rows);
    if (rows.length > 0) await db.deleteMissing(rows.map((r) => db.slugFromUrl(r.url)));
    const now = Date.now();
    await db.writeMeta({ lastSuccessfulFetch: now, lastError: null });

    snapCount = articles.length;
    snapLastSuccess = now;
    snapError = null;
    readCache = articles;
    readCacheTime = now;
    return articles;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[scraper] scrape failed; serving last-good DB rows:', err);
    const meta = await db.readMeta();
    await db.writeMeta({ lastError: msg });
    const rows = await db.getArticles();
    snapCount = rows.length;
    snapLastSuccess = meta.lastSuccessfulFetch ?? 0; // do NOT advance the clock on failure
    snapError = msg;
    readCache = rows;
    readCacheTime = Date.now();
    return rows;
  }
}
```

Update the `summarizeAll` import usage note: `summarizeAll` now returns `SummaryResult[]`; the old `summaries.forEach` block in the previous `getClaudeArticles` is fully replaced above. Remove the now-unused `cacheTime`/`cachedArticles`/`CACHE_TTL_MS`/`lastSuccessfulFetch`/`lastError` identifiers if any remain.

- [ ] **Step 5: Remove the superseded regression test from `src/lib/scraper.test.ts`**

Delete the test `'June 10→15 regression: a later failed scrape serves last-good, flags stale, and does NOT reset the freshness clock'` (around `scraper.test.ts:651`). Its premise (module-memory last-good) no longer holds; the DB-backed equivalent is `'on scrape failure serves last-good DB rows…'` in `scraper.db.test.ts`. Leave every other test in the file unchanged — they exercise the pure scrape/parse path with the DB layer in its no-op state (`DATABASE_URL` unset in tests).

- [ ] **Step 6: Run the full suite**

Run: `npm run test:run`
Expected: PASS — `scraper.db.test.ts` green; `scraper.test.ts`, `summarize.test.ts`, `refresh/route.test.ts`, `scrape/route.test.ts`, `chat/route.test.ts`, and all component tests still green.

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/scraper.ts src/lib/scraper.db.test.ts src/lib/scraper.test.ts
git commit -m "feat(kb): DB-first getClaudeArticles with live self-heal + single-flight"
```

---

## Task 5: README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update "Built with"**

Add a row to the Built-with table: `| Storage | Neon Postgres (Vercel Marketplace) — durable KB of articles + summaries |`.

- [ ] **Step 2: Update env table + `.env.local` block**

Add a `DATABASE_URL` row to the env table (Required: prod; "Set automatically by the Vercel Neon integration; without it the app live-scrapes every request") and add `DATABASE_URL=postgres://...` to the `.env.local` example.

- [ ] **Step 3: Update "How it's wired" — Auto-refresh & freshness**

Replace the daily-cron paragraph to describe the new model: Postgres is the durable source of truth; the **hourly** Vercel Cron (`0 * * * *`, **requires Pro**) hits `/api/scrape/refresh` and is the writer; all routes read **DB-first** and survive cold starts without re-scraping or re-summarizing; on an empty/stale table or a missed run, a read **self-heals** by scraping + summarizing inline and writing back; unchanged articles are skipped via the durable content-hash. Update the route table note for `/api/scrape` (now DB-backed, not a per-instance in-memory cache).

- [ ] **Step 4: Verify no code regressions from doc edits**

Run: `npm run test:run`
Expected: PASS (docs-only change; sanity check).

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(kb): document Postgres KB store, hourly cron, DB-first reads"
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:

| Spec requirement | Task |
|---|---|
| Neon Postgres store + `db.ts` access layer | Task 2 |
| `articles` + `kb_meta` schema (+ `db/schema.sql`) | Task 1 (file) + Task 2 (runtime `ensureSchema`) |
| Hourly Vercel Cron (`0 * * * *`, Pro) | Task 1 |
| Durable summarize-skip via content hash | Task 3 |
| `hash = ''` fallback → retry next run | Task 3 (impl + test) |
| DB-first reads + live self-heal + single-flight | Task 4 |
| `deleteMissing` prune, guarded against empty scrape | Task 2 (no-op on empty) + Task 4 (called only when `rows.length > 0`) |
| Freshness from `kb_meta`, status shape preserved | Task 4 (snapshot) |
| Grounding/chat path unchanged | Verified no-edit (reads through `getClaudeArticles`) |
| Refresh route contract unchanged | Verified no-edit |
| `DATABASE_URL` config + README | Task 1 + Task 5 |

**2. Placeholder scan** — no "TBD/TODO/handle edge cases"; every code step shows complete code; every test step shows real assertions. ✓

**3. Type consistency** — `ArticleRow = Article & { hash }`, `SummaryResult = { summary; hash }`, `KbMeta = { lastSuccessfulFetch: number|null; lastError: string|null }`, and `IngestionStatus` (unchanged) are used identically across Tasks 2–4. `slugFromUrl`, `getKnownSummaries`, `upsertArticles`, `deleteMissing`, `readMeta`, `writeMeta` names match between `db.ts` (Task 2) and `scraper.ts` consumers (Task 4). ✓

**Deviations from the spec (intentional, flagged in planning):**
- `getIngestionStatus()` is kept **synchronous** via a module snapshot fed from `kb_meta` on each `getClaudeArticles` call (spec implied an async `readMeta()` read) — preserves the route contract and existing tests.
- `revalidateTag(GROUNDING_TAG)` stays **only in the refresh route**, not in the shared persist step — avoids revalidating the grounding tag from inside its own `unstable_cache` computation during a self-heal. Self-heal writes are picked up on the next revalidation.
