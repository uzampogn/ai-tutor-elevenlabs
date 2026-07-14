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
