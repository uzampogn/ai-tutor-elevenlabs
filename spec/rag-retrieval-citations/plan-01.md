# RAG Retrieval + Source Chips (Spec 01) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed KB articles with Voyage AI into pgvector, retrieve the top-k most relevant articles per question into the chat prompt, and drive `SourceChips` from retrieval instead of title matching.

**Architecture:** New `embeddings.ts` (Voyage REST wrapper) + `embedArticles.ts` (ingest-time embedding, hash-gated) + `retrieval.ts` (query-time top-k with similarity floor). `db.ts` gains a guarded vector schema and three vector functions. The chat route appends an uncached second system block with retrieved bodies and reports slugs via an `X-Sources` header, which the frontend maps to chips.

**Tech Stack:** Next.js 14, TypeScript 5, `postgres.js`, Supabase Postgres + pgvector, Voyage AI REST API, Vitest.

## Global Constraints

- Node 24+ (`nvm use` in the repo before anything).
- Quality gate after every task: `npm run lint && npm run typecheck && npm run test:run` — all green before commit.
- Branch `feat/rag-01-retrieval` off `main` **after** `feat/kb-supabase-migration` has merged. Work in a **git worktree** (superpowers:using-git-worktrees).
- **Prompt-cache invariant:** the existing grounding system block stays byte-identical, first in the `system` array, with `cache_control: { type: 'ephemeral' }`. The retrieved block is appended after it, never cached.
- **No-op invariant:** with `VOYAGE_API_KEY` unset and/or `DATABASE_URL`/`POSTGRES_URL` unset, runtime behavior is byte-identical to `main`. Existing tests must stay green untouched (except the two suites this plan explicitly extends).
- Constants (single definition site noted per task): `EMBEDDING_MODEL = voyage-3.5-lite`, `EMBEDDING_DIMS = 1024`, `EMBED_INPUT_CAP = 30_000`, `RETRIEVAL_K = 3`, `SIM_FLOOR = 0.35`, `BODY_EXCERPT_CAP = 8_000`, query-embed timeout `1_500` ms.
- Never run `next build` while `next dev` is live (shared `.next/`).

---

### Task 1: Vector schema + vector functions in `db.ts`

**Files:**
- Modify: `db/schema.sql`
- Modify: `src/lib/db.ts`
- Test: `src/lib/db.test.ts`

**Interfaces:**
- Consumes: existing `sql` client, `ensureSchema()`, `rowToArticle()`, `Article`.
- Produces (used by Tasks 3–4):
  - `toSqlVector(vec: number[]): string`
  - `getEmbeddingStates(): Promise<Map<string, string>>` — slug → `embedded_hash` (`''` when never embedded)
  - `updateEmbeddings(rows: { slug: string; embedding: number[]; embeddedHash: string }[]): Promise<void>`
  - `similarArticles(vec: number[], k: number): Promise<SimilarArticleRow[]>` where `interface SimilarArticleRow extends Article { slug: string; similarity: number }`

- [ ] **Step 1: Write the failing tests** — append to `src/lib/db.test.ts`:

```ts
describe('db.ts — vector layer', () => {
  it('toSqlVector renders a pgvector literal', async () => {
    const db = await freshDb();
    expect(db.toSqlVector([0.1, -2, 3])).toBe('[0.1,-2,3]');
  });

  it('vector fns no-op without DATABASE_URL', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    const db = await freshDb();
    expect(await db.getEmbeddingStates()).toEqual(new Map());
    await expect(db.updateEmbeddings([{ slug: 'a', embedding: [1], embeddedHash: 'm:h' }])).resolves.toBeUndefined();
    expect(await db.similarArticles([1], 3)).toEqual([]);
    expect(postgresMock).not.toHaveBeenCalled();
    if (ORIGINAL_URL !== undefined) process.env.DATABASE_URL = ORIGINAL_URL;
  });

  it('similarArticles orders by cosine distance and maps similarity', async () => {
    sqlMock.mockResolvedValueOnce([]); // ensureSchema: articles
    sqlMock.mockResolvedValueOnce([]); // ensureSchema: kb_meta
    sqlMock.mockResolvedValueOnce([]); // vector schema: CREATE EXTENSION
    sqlMock.mockResolvedValueOnce([]); // vector schema: ALTER embedding
    sqlMock.mockResolvedValueOnce([]); // vector schema: ALTER embedded_hash
    sqlMock.mockResolvedValueOnce([
      { slug: 'a', title: 'A', url: 'https://claude.com/blog/a', pub_date: null,
        description: '', body: 'b', summary: 's', hero_image: '', similarity: '0.82' },
    ]);
    const db = await freshDb();
    const out = await db.similarArticles([1, 2], 3);
    expect(out).toHaveLength(1);
    expect(out[0].slug).toBe('a');
    expect(out[0].similarity).toBeCloseTo(0.82);
    expect(lastSql()).toContain('<=>');
    expect(lastSql()).toContain('embedding IS NOT NULL');
  });

  it('updateEmbeddings issues one UPDATE per row with a ::vector cast', async () => {
    sqlMock.mockResolvedValue([]);
    const db = await freshDb();
    await db.updateEmbeddings([{ slug: 'a', embedding: [1, 2], embeddedHash: 'voyage-3.5-lite:h1' }]);
    expect(lastSql()).toContain('UPDATE articles SET embedding =');
    expect(lastSql()).toContain('::vector');
    const call = sqlMock.mock.calls.at(-1)!;
    expect(call).toContain('[1,2]');
    expect(call).toContain('voyage-3.5-lite:h1');
  });

  it('vector fns degrade to empty when the vector DDL fails (pgvector unavailable)', async () => {
    sqlMock.mockResolvedValueOnce([]); // ensureSchema: articles
    sqlMock.mockResolvedValueOnce([]); // ensureSchema: kb_meta
    sqlMock.mockRejectedValueOnce(new Error('permission denied for extension vector'));
    const db = await freshDb();
    expect(await db.similarArticles([1], 3)).toEqual([]); // no throw
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/db.test.ts`
Expected: FAIL — `toSqlVector is not a function` (and the other new cases).

- [ ] **Step 3: Implement in `src/lib/db.ts`** — add after `ensureSchema()`:

```ts
/** Render a number[] as a pgvector text literal; bind with `${...}::vector`. */
export function toSqlVector(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

// Vector layer (spec/rag-retrieval-citations). Guarded separately from the base
// schema: if pgvector is unavailable (extension not enabled / no permission),
// retrieval degrades to "off" without breaking the articles table. Dims must
// match EMBEDDING_DIMS in embeddings.ts (1024, voyage-3.5-lite).
// No vector index on purpose: ~24 rows — revisit at ~1k rows (backlog #1).
let vectorReady: Promise<boolean> | null = null;
async function ensureVectorSchema(): Promise<boolean> {
  if (!sql) return false;
  await ensureSchema();
  if (!vectorReady) {
    vectorReady = (async () => {
      try {
        await sql`CREATE EXTENSION IF NOT EXISTS vector`;
        await sql`ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedding vector(1024)`;
        await sql`ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedded_hash TEXT NOT NULL DEFAULT ''`;
        return true;
      } catch (err) {
        console.error('[db] pgvector unavailable; retrieval disabled:', err);
        return false;
      }
    })();
  }
  return vectorReady;
}

export interface SimilarArticleRow extends Article {
  slug: string;
  similarity: number;
}

/** slug → embedded_hash for every row ('' = never embedded). */
export async function getEmbeddingStates(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!sql) return map;
  if (!(await ensureVectorSchema())) return map;
  const rows = (await sql`SELECT slug, embedded_hash FROM articles`) as Row[];
  for (const r of rows) map.set(String(r.slug), String(r.embedded_hash ?? ''));
  return map;
}

export async function updateEmbeddings(
  rows: { slug: string; embedding: number[]; embeddedHash: string }[],
): Promise<void> {
  if (!sql || rows.length === 0) return;
  if (!(await ensureVectorSchema())) return;
  for (const r of rows) {
    await sql`UPDATE articles SET embedding = ${toSqlVector(r.embedding)}::vector,
      embedded_hash = ${r.embeddedHash} WHERE slug = ${r.slug}`;
  }
}

/** Top-k articles by cosine similarity to `vec` (unfiltered; caller applies the floor). */
export async function similarArticles(vec: number[], k: number): Promise<SimilarArticleRow[]> {
  if (!sql) return [];
  if (!(await ensureVectorSchema())) return [];
  const v = toSqlVector(vec);
  const rows = (await sql`
    SELECT slug, title, url, pub_date, description, body, summary, hero_image,
           1 - (embedding <=> ${v}::vector) AS similarity
    FROM articles WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${v}::vector
    LIMIT ${k}`) as Row[];
  return rows.map((r) => ({
    ...rowToArticle(r),
    slug: String(r.slug),
    similarity: Number(r.similarity),
  }));
}
```

- [ ] **Step 4: Update `db/schema.sql`** — append:

```sql
-- Vector layer (spec/rag-retrieval-citations, backlog #2). Created idempotently
-- by db.ts:ensureVectorSchema(); if CREATE EXTENSION is refused over the pooled
-- role, enable "vector" once in the Supabase dashboard (Database → Extensions).
-- Dims = 1024 (voyage-3.5-lite). No vector index on purpose: ~24 rows — a seq
-- scan wins. Revisit at ~1k rows (backlog #1 multi-source).
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedding vector(1024);
ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedded_hash TEXT NOT NULL DEFAULT ''; -- "<model>:<djb2>" at embed time
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run src/lib/db.test.ts`
Expected: PASS (all pre-existing cases too — the base `ensureSchema` path is untouched).

- [ ] **Step 6: Commit**

```bash
git add db/schema.sql src/lib/db.ts src/lib/db.test.ts
git commit -m "feat(rag): pgvector schema + vector query layer in db.ts"
```

---

### Task 2: Voyage embeddings client (`embeddings.ts`)

**Files:**
- Create: `src/lib/embeddings.ts`
- Test: `src/lib/embeddings.test.ts`

**Interfaces:**
- Produces (used by Tasks 3–4):
  - `EMBEDDING_MODEL: string` (env `EMBEDDING_MODEL`, default `'voyage-3.5-lite'`)
  - `EMBEDDING_DIMS = 1024`
  - `embeddingsEnabled(): boolean`
  - `embedTexts(texts: string[], inputType: 'document' | 'query', opts?: { signal?: AbortSignal }): Promise<number[][] | null>` — `null` = disabled/failed (caller degrades), `[]` for empty input.

- [ ] **Step 1: Write the failing tests** — create `src/lib/embeddings.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const KEY = 'test-voyage-key';

async function freshEmbeddings() {
  vi.resetModules();
  return import('./embeddings');
}

function voyageResponse(vectors: number[][]) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data: vectors.map((embedding, index) => ({ embedding, index })) }),
  } as unknown as Response;
}

beforeEach(() => {
  process.env.VOYAGE_API_KEY = KEY;
});
afterEach(() => {
  delete process.env.VOYAGE_API_KEY;
  vi.unstubAllGlobals();
});

describe('embedTexts', () => {
  it('no-ops (null, no fetch) without VOYAGE_API_KEY', async () => {
    delete process.env.VOYAGE_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { embedTexts, embeddingsEnabled } = await freshEmbeddings();
    expect(embeddingsEnabled()).toBe(false);
    expect(await embedTexts(['x'], 'document')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns [] for empty input without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { embedTexts } = await freshEmbeddings();
    expect(await embedTexts([], 'document')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts model, input and input_type with the bearer key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(voyageResponse([[1, 2]]));
    vi.stubGlobal('fetch', fetchMock);
    const { embedTexts } = await freshEmbeddings();
    const out = await embedTexts(['hello'], 'query');
    expect(out).toEqual([[1, 2]]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.voyageai.com/v1/embeddings');
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body)).toMatchObject({
      input: ['hello'], model: 'voyage-3.5-lite', input_type: 'query',
    });
  });

  it('returns null on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response));
    const { embedTexts } = await freshEmbeddings();
    expect(await embedTexts(['x'], 'document')).toBeNull();
  });

  it('returns null on a malformed response (count mismatch)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(voyageResponse([[1]])));
    const { embedTexts } = await freshEmbeddings();
    expect(await embedTexts(['a', 'b'], 'document')).toBeNull();
  });

  it('splits >128 inputs into sequential batches', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(voyageResponse(Array.from({ length: 128 }, () => [1])))
      .mockResolvedValueOnce(voyageResponse([[2], [2]]));
    vi.stubGlobal('fetch', fetchMock);
    const { embedTexts } = await freshEmbeddings();
    const out = await embedTexts(Array.from({ length: 130 }, (_, i) => `t${i}`), 'document');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(130);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/embeddings.test.ts`
Expected: FAIL — cannot resolve `./embeddings`.

- [ ] **Step 3: Implement `src/lib/embeddings.ts`:**

```ts
/**
 * Voyage AI embeddings client (spec/rag-retrieval-citations). Anthropic has no
 * embeddings API; Voyage is its recommended partner. Thin fetch wrapper — no SDK.
 * Mirrors the db.ts degradation pattern: no VOYAGE_API_KEY → every call no-ops
 * (returns null) and the app behaves exactly as before RAG existed.
 */

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
// Overridable for tuning without a redeploy. Changing the model re-embeds all
// articles on the next cron (embedded_hash is prefixed with the model name).
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'voyage-3.5-lite';
export const EMBEDDING_DIMS = 1024; // must match vector(1024) in db/schema.sql
const BATCH_CAP = 128; // Voyage per-request input cap
const DEFAULT_TIMEOUT_MS = 10_000; // ingest path; the chat path passes a tighter signal

export function embeddingsEnabled(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

/**
 * Embed texts. `input_type` matters for retrieval quality: 'document' at ingest,
 * 'query' for user questions. Returns null when disabled or on any failure —
 * callers must degrade, never throw.
 */
export async function embedTexts(
  texts: string[],
  inputType: 'document' | 'query',
  opts: { signal?: AbortSignal } = {},
): Promise<number[][] | null> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) return null;
  if (texts.length === 0) return [];

  const out: number[][] = [];
  try {
    for (let i = 0; i < texts.length; i += BATCH_CAP) {
      const batch = texts.slice(i, i + BATCH_CAP);
      const res = await fetch(VOYAGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ input: batch, model: EMBEDDING_MODEL, input_type: inputType }),
        signal: opts.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Voyage HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { embedding?: number[] }[] };
      const vecs = (json.data ?? []).map((d) => d.embedding);
      if (vecs.length !== batch.length || vecs.some((v) => !Array.isArray(v))) {
        throw new Error('Voyage: malformed embeddings response');
      }
      out.push(...(vecs as number[][]));
    }
    return out;
  } catch (err) {
    console.error('[embeddings] embed failed:', err);
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/embeddings.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/embeddings.ts src/lib/embeddings.test.ts
git commit -m "feat(rag): Voyage embeddings client with no-op degradation"
```

---

### Task 3: Ingest-time article embedding (`embedArticles.ts` + scraper hook)

**Files:**
- Create: `src/lib/embedArticles.ts`
- Modify: `src/lib/scraper.ts` (one call inside `scrapeAndPersist`)
- Test: `src/lib/embedArticles.test.ts`
- Test: `src/lib/scraper.db.test.ts` (one wiring case)

**Interfaces:**
- Consumes: `db.getEmbeddingStates/updateEmbeddings/slugFromUrl` (Task 1), `embedTexts/embeddingsEnabled/EMBEDDING_MODEL` (Task 2), `contentHash` from `./summarize`.
- Produces: `embedStaleArticles(articles: { title: string; url: string; body: string }[]): Promise<void>` — never throws. `embeddedHashFor(title: string, body: string): string` = `` `${EMBEDDING_MODEL}:${contentHash(title, body)}` ``.

Note: staleness is keyed on `contentHash(title, body)` computed here — NOT on the summary-result hash (which is `''` when summarization fell back; embedding must not depend on summary success).

- [ ] **Step 1: Write the failing tests** — create `src/lib/embedArticles.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { contentHash } from './summarize';

const db = vi.hoisted(() => ({
  getEmbeddingStates: vi.fn(),
  updateEmbeddings: vi.fn(),
  slugFromUrl: (u: string) => (u.match(/\/blog\/([^/?#]+)/)?.[1] ?? u),
}));
vi.mock('./db', () => db);

const embeddings = vi.hoisted(() => ({
  embedTexts: vi.fn(),
  embeddingsEnabled: vi.fn(),
  EMBEDDING_MODEL: 'voyage-3.5-lite',
  EMBEDDING_DIMS: 1024,
}));
vi.mock('./embeddings', () => embeddings);

import { embedStaleArticles, embeddedHashFor } from './embedArticles';

const art = (slug: string, body = 'body text') => ({
  title: `T ${slug}`, url: `https://claude.com/blog/${slug}`, body,
});

beforeEach(() => {
  db.getEmbeddingStates.mockReset().mockResolvedValue(new Map());
  db.updateEmbeddings.mockReset().mockResolvedValue(undefined);
  embeddings.embedTexts.mockReset().mockResolvedValue([[0.1, 0.2]]);
  embeddings.embeddingsEnabled.mockReset().mockReturnValue(true);
});

describe('embedStaleArticles', () => {
  it('no-ops when embeddings are disabled', async () => {
    embeddings.embeddingsEnabled.mockReturnValue(false);
    await embedStaleArticles([art('a')]);
    expect(db.getEmbeddingStates).not.toHaveBeenCalled();
    expect(embeddings.embedTexts).not.toHaveBeenCalled();
  });

  it('embeds only stale articles (steady state = 0 API calls)', async () => {
    const a = art('a');
    db.getEmbeddingStates.mockResolvedValue(
      new Map([['a', embeddedHashFor(a.title, a.body)]]),
    );
    await embedStaleArticles([a]);
    expect(embeddings.embedTexts).not.toHaveBeenCalled();
    expect(db.updateEmbeddings).not.toHaveBeenCalled();
  });

  it('embeds title + capped body and persists model-prefixed hashes', async () => {
    const a = art('a');
    embeddings.embedTexts.mockResolvedValue([[1, 2, 3]]);
    await embedStaleArticles([a]);
    const [inputs, inputType] = embeddings.embedTexts.mock.calls[0];
    expect(inputType).toBe('document');
    expect(inputs[0].startsWith(`T a\n\n`)).toBe(true);
    expect(db.updateEmbeddings).toHaveBeenCalledWith([
      { slug: 'a', embedding: [1, 2, 3],
        embeddedHash: `voyage-3.5-lite:${contentHash(a.title, a.body)}` },
    ]);
  });

  it('does nothing (and does not throw) when embedTexts fails', async () => {
    embeddings.embedTexts.mockResolvedValue(null);
    await expect(embedStaleArticles([art('a')])).resolves.toBeUndefined();
    expect(db.updateEmbeddings).not.toHaveBeenCalled();
  });

  it('swallows db errors (embedding must never block ingest)', async () => {
    db.getEmbeddingStates.mockRejectedValue(new Error('db down'));
    await expect(embedStaleArticles([art('a')])).resolves.toBeUndefined();
  });

  it('skips articles with empty bodies', async () => {
    await embedStaleArticles([art('a', '')]);
    expect(embeddings.embedTexts).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/embedArticles.test.ts`
Expected: FAIL — cannot resolve `./embedArticles`.

- [ ] **Step 3: Implement `src/lib/embedArticles.ts`:**

```ts
/**
 * Ingest-time embedding (spec/rag-retrieval-citations). Runs inside the cron's
 * scrapeAndPersist path AFTER articles are upserted; embeds only articles whose
 * content (or the embedding model) changed. Failures are logged and swallowed —
 * embedding must never block or fail article ingestion. NULL embeddings are
 * simply retried on the next cron.
 */
import * as db from './db';
import { embedTexts, embeddingsEnabled, EMBEDDING_MODEL } from './embeddings';
import { contentHash } from './summarize';

// Cap the embedded input (~7.5k tokens) — plenty of signal for whole-article
// similarity; full bodies can reach 60k chars.
export const EMBED_INPUT_CAP = 30_000;

/** Staleness key: model + content hash. Model swap ⇒ every article re-embeds. */
export function embeddedHashFor(title: string, body: string): string {
  return `${EMBEDDING_MODEL}:${contentHash(title, body)}`;
}

export async function embedStaleArticles(
  articles: { title: string; url: string; body: string }[],
): Promise<void> {
  try {
    if (!embeddingsEnabled() || articles.length === 0) return;
    const states = await db.getEmbeddingStates();
    const stale = articles.filter((a) => {
      if (!a.body.trim()) return false; // nothing meaningful to embed
      return states.get(db.slugFromUrl(a.url)) !== embeddedHashFor(a.title, a.body);
    });
    if (stale.length === 0) return;

    const inputs = stale.map((a) => `${a.title}\n\n${a.body.slice(0, EMBED_INPUT_CAP)}`);
    const vecs = await embedTexts(inputs, 'document');
    if (!vecs) return; // logged inside embedTexts; retried next cron

    await db.updateEmbeddings(
      stale.map((a, i) => ({
        slug: db.slugFromUrl(a.url),
        embedding: vecs[i],
        embeddedHash: embeddedHashFor(a.title, a.body),
      })),
    );
    console.log(`[embed] embedded ${stale.length} article(s)`);
  } catch (err) {
    console.error('[embed] embedStaleArticles failed (non-fatal):', err);
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/embedArticles.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire into the scraper (failing test first)** — in `src/lib/scraper.db.test.ts`, add to the hoisted mocks section (after the `vi.mock('@/lib/db', () => db);` line):

```ts
const embedArticles = vi.hoisted(() => ({ embedStaleArticles: vi.fn() }));
vi.mock('@/lib/embedArticles', () => embedArticles);
```

Add `embedArticles.embedStaleArticles.mockReset().mockResolvedValue(undefined);` to the existing `beforeEach`, and this case to the force-refresh describe block (the one covering `getClaudeArticles({ force: true })`):

```ts
it('embeds stale articles after persisting (force path)', async () => {
  vi.stubGlobal('fetch', makeFetchMock());
  const scraper = await freshScraper();
  await scraper.getClaudeArticles({ force: true });
  expect(embedArticles.embedStaleArticles).toHaveBeenCalledTimes(1);
  const arg = embedArticles.embedStaleArticles.mock.calls[0][0];
  expect(arg[0]).toMatchObject({ url: 'https://claude.com/blog/post-a' });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run src/lib/scraper.db.test.ts`
Expected: the new case FAILS (`embedStaleArticles` never called); all pre-existing cases PASS.

- [ ] **Step 7: Implement the hook** — in `src/lib/scraper.ts`:

Add the import (with the existing imports):

```ts
import { embedStaleArticles } from './embedArticles';
```

In `scrapeAndPersist()`, immediately after `await db.upsertArticles(rows);`, add:

```ts
    // Embed new/changed articles for RAG retrieval. Internally guarded: no-ops
    // without VOYAGE_API_KEY and swallows all errors — never blocks ingest.
    await embedStaleArticles(rows);
```

- [ ] **Step 8: Run the full suite**

Run: `npm run test:run`
Expected: PASS. (`scraper.test.ts` and `scraper.heroImage.test.ts` exercise scrape paths without a DB; `embedStaleArticles` no-ops there because `VOYAGE_API_KEY` is unset in tests — if any suite fails on an unexpected call, mock `@/lib/embedArticles` in that suite the same way as Step 5.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/embedArticles.ts src/lib/embedArticles.test.ts src/lib/scraper.ts src/lib/scraper.db.test.ts
git commit -m "feat(rag): embed stale articles during cron ingest"
```

---

### Task 4: Query-time retrieval (`retrieval.ts`)

**Files:**
- Create: `src/lib/retrieval.ts`
- Test: `src/lib/retrieval.test.ts`

**Interfaces:**
- Consumes: `db.similarArticles` (Task 1), `embedTexts` (Task 2).
- Produces (used by Task 5): `retrieveArticles(question: string, k?: number): Promise<db.SimilarArticleRow[]>`, `RETRIEVAL_K = 3`, `SIM_FLOOR = 0.35`.

- [ ] **Step 1: Write the failing tests** — create `src/lib/retrieval.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ similarArticles: vi.fn() }));
vi.mock('./db', () => db);
const embeddings = vi.hoisted(() => ({ embedTexts: vi.fn() }));
vi.mock('./embeddings', () => embeddings);

import { retrieveArticles, SIM_FLOOR, RETRIEVAL_K } from './retrieval';

const row = (slug: string, similarity: number) => ({
  slug, similarity, title: `T ${slug}`, url: `https://claude.com/blog/${slug}`,
  pubDate: '', description: '', body: 'b', summary: 's', heroImage: '',
});

beforeEach(() => {
  embeddings.embedTexts.mockReset().mockResolvedValue([[0.1, 0.2]]);
  db.similarArticles.mockReset().mockResolvedValue([]);
});

describe('retrieveArticles', () => {
  it('returns [] for an empty question without embedding', async () => {
    expect(await retrieveArticles('   ')).toEqual([]);
    expect(embeddings.embedTexts).not.toHaveBeenCalled();
  });

  it('embeds the question as a query and returns rows above the floor', async () => {
    db.similarArticles.mockResolvedValue([row('a', 0.8), row('b', SIM_FLOOR - 0.01)]);
    const out = await retrieveArticles('what is mcp?');
    expect(embeddings.embedTexts).toHaveBeenCalledWith(
      ['what is mcp?'], 'query', expect.objectContaining({ signal: expect.anything() }),
    );
    expect(db.similarArticles).toHaveBeenCalledWith([0.1, 0.2], RETRIEVAL_K);
    expect(out.map((r) => r.slug)).toEqual(['a']);
  });

  it('returns [] when embedding is disabled or fails (null)', async () => {
    embeddings.embedTexts.mockResolvedValue(null);
    expect(await retrieveArticles('q')).toEqual([]);
    expect(db.similarArticles).not.toHaveBeenCalled();
  });

  it('returns [] when the db query throws', async () => {
    db.similarArticles.mockRejectedValue(new Error('boom'));
    expect(await retrieveArticles('q')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/retrieval.test.ts`
Expected: FAIL — cannot resolve `./retrieval`.

- [ ] **Step 3: Implement `src/lib/retrieval.ts`:**

```ts
/**
 * Query-time retrieval (spec/rag-retrieval-citations): embed the user's latest
 * question and return the top-k most similar articles above a similarity floor.
 * Returns [] on ANY failure or when embeddings/db are unconfigured — the chat
 * route then behaves exactly as before RAG existed.
 */
import * as db from './db';
import { embedTexts } from './embeddings';

export const RETRIEVAL_K = 3;
// Cosine-similarity floor so off-topic questions ("hello!") retrieve nothing.
// Starting guess — tune against real questions before raising/lowering.
export const SIM_FLOOR = 0.35;
// The chat stream must not wait long for Voyage; on timeout we degrade.
const QUERY_EMBED_TIMEOUT_MS = 1_500;
// Sanity cap on the embedded question (Voyage input, not a UI limit).
const QUESTION_CAP = 2_000;

export type { SimilarArticleRow as RetrievedArticle } from './db';

export async function retrieveArticles(
  question: string,
  k = RETRIEVAL_K,
): Promise<db.SimilarArticleRow[]> {
  try {
    const q = (question ?? '').trim();
    if (!q) return [];
    const vecs = await embedTexts([q.slice(0, QUESTION_CAP)], 'query', {
      signal: AbortSignal.timeout(QUERY_EMBED_TIMEOUT_MS),
    });
    if (!vecs || vecs.length === 0) return [];
    const rows = await db.similarArticles(vecs[0], k);
    return rows.filter((r) => r.similarity >= SIM_FLOOR);
  } catch (err) {
    console.error('[retrieval] failed (degrading to no retrieval):', err);
    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/retrieval.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/retrieval.ts src/lib/retrieval.test.ts
git commit -m "feat(rag): query-time retrieval with similarity floor and timeout"
```

---

### Task 5: Chat route — retrieved block + `X-Sources` header

**Files:**
- Modify: `src/app/api/chat/route.ts`
- Test: `src/app/api/chat/route.test.ts`

**Interfaces:**
- Consumes: `retrieveArticles`, `RetrievedArticle` (Task 4).
- Produces (used by Task 6): response header `X-Sources` = comma-joined slugs in similarity order, present only when retrieval returned articles. System prompt becomes `[cachedGroundingBlock, retrievedBlock?]`.

- [ ] **Step 1: Write the failing tests** — in `src/app/api/chat/route.test.ts`:

Add to the hoisted mocks:

```ts
const { retrieveArticlesMock } = vi.hoisted(() => ({ retrieveArticlesMock: vi.fn() }));
vi.mock('@/lib/retrieval', () => ({ retrieveArticles: retrieveArticlesMock }));
```

Add `retrieveArticlesMock.mockReset().mockResolvedValue([]);` to the existing `beforeEach`, then append a new describe block:

```ts
describe('POST /api/chat — RAG retrieved block (spec/rag-retrieval-citations)', () => {
  const retrieved = (slug: string, body = 'FULL BODY') => ({
    slug, title: `Title ${slug}`, url: `https://claude.com/blog/${slug}`,
    pubDate: '', description: '', body, summary: 'sum', heroImage: '', similarity: 0.9,
  });

  it('no retrieval → single cached block and no X-Sources header (byte-identical to today)', async () => {
    const res = await post([{ role: 'user', content: 'hi' }]);
    const sysArg = streamMock.mock.calls[0][0].system;
    expect(sysArg).toHaveLength(1);
    expect(res.headers.get('X-Sources')).toBeNull();
  });

  it('retrieval hit → appends an uncached block with capped bodies; block 1 untouched', async () => {
    retrieveArticlesMock.mockResolvedValue([
      retrieved('post-a', 'A'.repeat(9_000)), retrieved('post-b'),
    ]);
    const res = await post([
      { role: 'assistant', content: 'earlier' },
      { role: 'user', content: 'tell me about MCP' },
    ]);
    expect(retrieveArticlesMock).toHaveBeenCalledWith('tell me about MCP');

    const sysArg = streamMock.mock.calls[0][0].system;
    expect(sysArg).toHaveLength(2);
    // Block 1: cached grounding block, byte-identical to the no-retrieval case.
    expect(sysArg[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } });
    expect(sysArg[0].text).toContain('GROUNDING_MARKER');
    // Block 2: uncached, titled sources with capped bodies.
    expect(sysArg[1].cache_control).toBeUndefined();
    expect(sysArg[1].text).toContain('[Source 1] Title post-a');
    expect(sysArg[1].text).toContain('[Source 2] Title post-b');
    expect(sysArg[1].text).toContain('URL: https://claude.com/blog/post-a');
    expect(sysArg[1].text).not.toContain('A'.repeat(8_001)); // BODY_EXCERPT_CAP

    expect(res.headers.get('X-Sources')).toBe('post-a,post-b');
  });

  it('embeds the LATEST user message, not the first', async () => {
    await post([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'second question' },
    ]);
    expect(retrieveArticlesMock).toHaveBeenCalledWith('second question');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/chat/route.test.ts`
Expected: new cases FAIL (single-block system today, no header); the 3 pre-existing cases PASS.

- [ ] **Step 3: Implement in `src/app/api/chat/route.ts`:**

Add imports:

```ts
import { retrieveArticles, type RetrievedArticle } from '@/lib/retrieval';
```

Add above `POST` (module scope):

```ts
// Per-article body excerpt in the retrieved block. 3 × 8k chars ≈ 6k tokens —
// comfortable headroom, and real depth vs the 700-char summaries in block 1.
const BODY_EXCERPT_CAP = 8_000;

function buildRetrievedBlock(retrieved: RetrievedArticle[]): string {
  const blocks = retrieved.map((r, i) => {
    const excerpt = r.body.slice(0, BODY_EXCERPT_CAP) || r.summary;
    return `### [Source ${i + 1}] ${r.title}\nURL: ${r.url}\n\n${excerpt}`;
  });
  return `RETRIEVED SOURCES — full articles most relevant to the user's latest question. Prefer these for depth and specifics; the knowledge base above holds only short summaries. When you cite one, write its article title EXACTLY as given.\n\n${blocks.join('\n\n---\n\n')}`;
}
```

Inside `POST`, after `const { messages } = await req.json();` add:

```ts
  const lastUser = Array.isArray(messages)
    ? [...messages].reverse().find((m) => m?.role === 'user')
    : undefined;
  const retrieved = await retrieveArticles(
    typeof lastUser?.content === 'string' ? lastUser.content : '',
  );
```

Replace the `system:` line of the `client.messages.stream({ ... })` call with:

```ts
          system: [
            { type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } },
            ...(retrieved.length > 0
              ? [{ type: 'text' as const, text: buildRetrievedBlock(retrieved) }]
              : []),
          ],
```

Replace the final `return new Response(stream, { headers: { ... } });` with:

```ts
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
  };
  if (retrieved.length > 0) headers['X-Sources'] = retrieved.map((r) => r.slug).join(',');
  return new Response(stream, { headers });
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/app/api/chat/route.test.ts`
Expected: PASS (all 6). The pre-existing "grounding" test's shape-agnostic `sysArg[0].text` read still works.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/route.ts src/app/api/chat/route.test.ts
git commit -m "feat(rag): retrieved-sources system block + X-Sources header in chat route"
```

---

### Task 6: Frontend — retrieval-driven `SourceChips`

**Files:**
- Modify: `src/lib/types.ts` (Message gains `sources?`)
- Modify: `src/lib/parseAnswer.ts` (`articleSlug`, `resolveSources`)
- Modify: `src/components/AppShell.tsx` (read header)
- Modify: `src/components/main/Thread.tsx` (pass-through)
- Modify: `src/components/AiRow.tsx` (use `resolveSources`)
- Test: `src/lib/parseAnswer.test.ts`, `src/components/AiRow.test.tsx`

**Interfaces:**
- Consumes: `X-Sources` header (Task 5).
- Produces (used by plan-02): `Message.sources?: string[]`; `AiRow` prop `sourceSlugs?: string[]`; `resolveSources(slugs: string[] | undefined, answer: string, articles: Article[]): Article[]`; `articleSlug(url: string): string`.

- [ ] **Step 1: Write the failing parser tests** — append to `src/lib/parseAnswer.test.ts`:

```ts
import { resolveSources, articleSlug } from './parseAnswer'; // merge into the existing import

describe('resolveSources', () => {
  const art = (slug: string): Article => ({
    title: `Title ${slug}`, url: `https://claude.com/blog/${slug}`, pubDate: '',
    description: '', body: '', summary: '', heroImage: '',
  });
  const articles = [art('a'), art('b'), art('c')];

  it('articleSlug extracts the /blog/ segment (client-safe copy of db.slugFromUrl)', () => {
    expect(articleSlug('https://claude.com/blog/post-a?x=1')).toBe('post-a');
  });

  it('maps slugs to articles preserving retrieval order', () => {
    const out = resolveSources(['c', 'a'], 'irrelevant', articles);
    expect(out.map((a) => a.title)).toEqual(['Title c', 'Title a']);
  });

  it('drops unknown slugs', () => {
    const out = resolveSources(['ghost', 'b'], '', articles);
    expect(out.map((a) => a.title)).toEqual(['Title b']);
  });

  it('falls back to matchSources when slugs are absent or none resolve', () => {
    const answer = 'As covered in Title b, ...';
    expect(resolveSources(undefined, answer, articles).map((a) => a.title)).toEqual(['Title b']);
    expect(resolveSources(['ghost'], answer, articles).map((a) => a.title)).toEqual(['Title b']);
  });
});
```

(If `Article` is not already imported in the test file, import it: `import type { Article } from './scraper';`)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/parseAnswer.test.ts`
Expected: FAIL — `resolveSources is not a function`.

- [ ] **Step 3: Implement in `src/lib/parseAnswer.ts`** — append:

```ts
/**
 * Client-safe slug extraction (mirrors db.slugFromUrl, which lives in a
 * server-only module and must not be imported by components).
 */
export function articleSlug(url: string): string {
  const m = url.match(/\/blog\/([^/?#]+)/);
  return m ? m[1] : url;
}

/**
 * Chips source-of-truth (spec/rag-retrieval-citations): when the chat response
 * carried retrieved slugs (X-Sources), map them to articles preserving the
 * retrieval (similarity) order; otherwise fall back to legacy title matching.
 */
export function resolveSources(
  slugs: string[] | undefined,
  answer: string,
  articles: Article[],
): Article[] {
  if (slugs && slugs.length > 0 && articles.length > 0) {
    const bySlug = new Map(articles.map((a) => [articleSlug(a.url), a]));
    const resolved = slugs
      .map((s) => bySlug.get(s))
      .filter((a): a is Article => a !== undefined);
    if (resolved.length > 0) return resolved;
  }
  return matchSources(answer, articles);
}
```

- [ ] **Step 4: Run parser tests to verify pass**

Run: `npx vitest run src/lib/parseAnswer.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing AiRow test** — append to `src/components/AiRow.test.tsx` (match the file's existing render helpers; the essential assertions):

```tsx
it('renders chips from sourceSlugs in retrieval order, ignoring title matching', () => {
  const articles = [
    { title: 'Alpha', url: 'https://claude.com/blog/alpha', pubDate: '', description: '', body: '', summary: '', heroImage: '' },
    { title: 'Beta', url: 'https://claude.com/blog/beta', pubDate: '', description: '', body: '', summary: '', heroImage: '' },
  ];
  render(
    <AiRow
      content="An answer that mentions Alpha by name."
      streaming={false}
      articles={articles}
      sourceSlugs={['beta', 'alpha']}
      speaking={false}
      onReadAloud={() => {}}
      onStopAudio={() => {}}
    />,
  );
  const chips = screen.getAllByRole('link');
  expect(chips.map((c) => c.textContent)).toEqual(['Beta', 'Alpha']);
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run src/components/AiRow.test.tsx`
Expected: new case FAILS (unknown prop is ignored; chips come from `matchSources` → `['Alpha']`).

- [ ] **Step 7: Implement the wiring** — four small edits:

`src/lib/types.ts` — extend `Message`:

```ts
/** A single turn in the conversation. */
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** Retrieved-source slugs (X-Sources header order) for assistant turns. */
  sources?: string[];
}
```

`src/components/AppShell.tsx` — in `sendMessage`, after `if (!res.body) throw new Error('No response body');` add:

```ts
        const sourceSlugs = res.headers.get('X-Sources')?.split(',').filter(Boolean);
```

and change the streaming update line inside the read loop to:

```ts
          setMessages([...history, { role: 'assistant', content: full, sources: sourceSlugs }]);
```

`src/components/main/Thread.tsx` — add the prop to the `AiRow` render:

```tsx
                sourceSlugs={msg.sources}
```

`src/components/AiRow.tsx` — add to `AiRowProps`:

```ts
  /** Retrieved-source slugs from the chat response (X-Sources), retrieval order. */
  sourceSlugs?: string[];
```

destructure `sourceSlugs` in the component signature, replace the import of `matchSources` with `resolveSources` (from `@/lib/parseAnswer`), and replace the sources line:

```ts
  const sources = resolveSources(sourceSlugs, content, articles);
```

- [ ] **Step 8: Run the full gate**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green (AppShell/Thread suites tolerate the optional prop).

- [ ] **Step 9: Commit**

```bash
git add src/lib/types.ts src/lib/parseAnswer.ts src/lib/parseAnswer.test.ts src/components/AppShell.tsx src/components/main/Thread.tsx src/components/AiRow.tsx src/components/AiRow.test.tsx
git commit -m "feat(rag): retrieval-driven source chips via X-Sources header"
```

---

### Task 7: Docs, env, PR

**Files:**
- Modify: `.env.example`, `README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: `.env.example`** — add:

```bash
# Voyage AI embeddings (RAG retrieval — spec/rag-retrieval-citations).
# Get a key at https://dash.voyageai.com. OPTIONAL: unset ⇒ retrieval is off and
# chat behaves exactly as before (summaries-only grounding, title-match chips).
VOYAGE_API_KEY=

# Embedding model override (default voyage-3.5-lite, 1024 dims). Changing it
# re-embeds all articles on the next cron.
# EMBEDDING_MODEL=voyage-3.5-lite
```

- [ ] **Step 2: `README.md`** — in the architecture section, add a short "RAG retrieval" paragraph: articles are embedded (Voyage `voyage-3.5-lite` → pgvector on Supabase) during the daily cron; each question retrieves the top-3 most similar articles (cosine, floor 0.35) whose bodies are appended to the prompt as an uncached block; the response's `X-Sources` header drives the source chips; without `VOYAGE_API_KEY` the feature is off with zero behavior change. Add `VOYAGE_API_KEY` to the env-var table. Note the Supabase fallback: if `CREATE EXTENSION vector` is refused at runtime, enable the `vector` extension once in the dashboard (Database → Extensions).

- [ ] **Step 3: Full gate, push, PR**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green. Then:

```bash
git add .env.example README.md
git commit -m "docs(rag): VOYAGE_API_KEY setup + RAG architecture notes"
git push -u origin feat/rag-01-retrieval
gh pr create --base main --title "RAG retrieval + retrieval-driven source chips (spec 01)" \
  --body "Implements spec/rag-retrieval-citations/01-retrieval-chips.md: Voyage embeddings into pgvector at cron time, query-time top-3 retrieval with a similarity floor, retrieved bodies as an uncached second system block (cached grounding block untouched), and SourceChips driven by the X-Sources header. Purely additive: without VOYAGE_API_KEY behavior is byte-identical to main. Includes manual verification results (see checklist in plan-01.md Task 7)."
```

- [ ] **Step 4: Manual verification (needs `VOYAGE_API_KEY` + `DATABASE_URL` in `.env.local`)**

1. `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/scrape/refresh` → 200; in Supabase table editor, `embedding` non-NULL and `embedded_hash` = `voyage-3.5-lite:<hash>` for every article.
2. Ask a topical question in the app → response carries `X-Sources`; chips ordered by relevance; answer contains body-level detail absent from summaries.
3. Ask "hello!" → no `X-Sources` (floor filters), UI unchanged.
4. Unset `VOYAGE_API_KEY`, restart dev → behavior identical to `main`.
5. Two consecutive questions → dev console `[chat] cache usage` shows `cache_read` ≈ prior `cache_creation` (block 2 did not break the prompt cache).

---

## Definition of Done (plan 01)

All tasks committed; quality gate green; PR open against `main`; manual verification 1–5 recorded in the PR description.
