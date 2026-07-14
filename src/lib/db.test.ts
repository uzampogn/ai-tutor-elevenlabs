import { describe, it, expect, vi, beforeEach } from 'vitest';

// A tagged-template stub: records each call's SQL fragments and returns a canned result.
const { sqlMock, postgresMock } = vi.hoisted(() => {
  const sqlMock = vi.fn();
  return { sqlMock, postgresMock: vi.fn(() => sqlMock) };
});
// postgres.js default export is the factory: postgres(url, opts) → tagged-template `sql`.
vi.mock('postgres', () => ({ default: postgresMock }));

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
  postgresMock.mockClear();
  process.env.DATABASE_URL = 'postgres://test';
});

describe('db.ts — no-op without DATABASE_URL', () => {
  it('returns safe empties and never constructs a client', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    const db = await freshDb();
    expect(await db.getArticles()).toEqual([]);
    expect(await db.getKnownSummaries()).toEqual(new Map());
    await expect(db.upsertArticles([])).resolves.toBeUndefined();
    await expect(db.deleteMissing(['x'])).resolves.toBeUndefined();
    expect(await db.readMeta()).toEqual({ lastSuccessfulFetch: null, lastError: null });
    expect(postgresMock).not.toHaveBeenCalled();
    if (ORIGINAL_URL !== undefined) process.env.DATABASE_URL = ORIGINAL_URL;
  });
});

describe('db.ts — queries', () => {
  it('constructs the postgres client with prepare:false (transaction-pooler safe)', async () => {
    await freshDb();
    expect(postgresMock).toHaveBeenCalledWith(
      'postgres://test',
      expect.objectContaining({ prepare: false })
    );
  });

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

  it('serializes queries: concurrent callers never put two queries in flight at once', async () => {
    // Supavisor's transaction pooler (port 6543) wedges permanently when postgres.js
    // pipelines a query onto a busy connection, which happens whenever in-flight
    // queries exceed pool connections (max: 1). Prod hits this via
    // Promise.all([getArticles(), readMeta()]) — reproduce that exact shape.
    let inFlight = 0;
    let peak = 0;
    sqlMock.mockImplementation(() => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      return new Promise((resolve) =>
        setTimeout(() => {
          inFlight--;
          resolve([]);
        }, 2)
      );
    });
    const db = await freshDb();
    await Promise.all([db.getArticles(), db.readMeta()]);
    expect(peak).toBe(1);
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
