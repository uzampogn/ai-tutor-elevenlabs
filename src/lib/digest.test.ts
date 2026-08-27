import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Article } from './types';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({ messages: { create: createMock } })),
}));

// Only system boundaries are mocked: the Anthropic SDK above and the postgres
// driver here. `db.ts` itself runs for real — the seam where a `::jsonb` vs
// `::text::jsonb` double-encoding bug hid behind a mocked `./db`.
const { sqlMock, postgresMock } = vi.hoisted(() => {
  const sqlMock = vi.fn();
  return { sqlMock, postgresMock: vi.fn(() => sqlMock) };
});
// postgres.js default export is the factory: postgres(url, opts) → tagged-template `sql`.
vi.mock('postgres', () => ({ default: postgresMock }));

const ORIGINAL_DB_URL = process.env.DATABASE_URL;
const ORIGINAL_PG_URL = process.env.POSTGRES_URL;

/** Rows `getDigestStates()` reads back; reassign per test. */
let storedStates: { slug: string; digest_hash: string }[] = [];
/** When set, the digest-state SELECT rejects with it. */
let selectError: Error | null = null;

/** The UPDATE calls `db.updateDigests()` issued: [templateStrings, ...boundValues]. */
function digestUpdates(): unknown[][] {
  return sqlMock.mock.calls.filter((c) =>
    (c[0] as string[]).join('?').includes('UPDATE articles SET digest ='),
  );
}

const ARTICLE: Article = {
  title: 'Post',
  url: 'https://claude.com/blog/post',
  pubDate: '2026-06-10T00:00:00Z',
  description: 'Desc',
  body: 'Full body text.',
  summary: '',
  heroImage: '',
};

const VALID = {
  tldr: 'A one-liner.',
  takeaways: ['a', 'b', 'c'],
  whyItMatters: 'It matters.',
  tags: ['X', 'Y', 'Z'],
  questions: ['Q1?', 'Q2?'],
};

const textRes = (text: string) => ({ content: [{ type: 'text', text }] });

beforeEach(() => {
  createMock.mockReset();
  storedStates = [];
  selectError = null;
  postgresMock.mockClear();
  // Route by SQL text rather than call order, so schema DDL can grow without
  // rewriting every expectation.
  sqlMock.mockReset().mockImplementation((strings: TemplateStringsArray) => {
    if (strings.join('?').includes('SELECT slug, digest_hash FROM articles')) {
      return selectError ? Promise.reject(selectError) : Promise.resolve(storedStates);
    }
    return Promise.resolve([]);
  });
  process.env.DATABASE_URL = 'postgres://test';
  delete process.env.POSTGRES_URL;
});
afterEach(() => {
  vi.resetModules();
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
  if (ORIGINAL_PG_URL === undefined) delete process.env.POSTGRES_URL;
  else process.env.POSTGRES_URL = ORIGINAL_PG_URL;
});

describe('digestArticle', () => {
  it('parses a valid JSON digest', async () => {
    createMock.mockResolvedValue(textRes(JSON.stringify(VALID)));
    const { digestArticle } = await import('./digest');
    expect(await digestArticle(ARTICLE)).toEqual(VALID);
  });

  it('calls Sonnet 5 with thinking disabled (digest is a fixed-shape JSON task)', async () => {
    createMock.mockResolvedValue(textRes(JSON.stringify(VALID)));
    const { digestArticle } = await import('./digest');
    await digestArticle(ARTICLE);
    expect(createMock.mock.calls[0][0]).toMatchObject({
      model: 'claude-sonnet-5',
      thinking: { type: 'disabled' },
    });
  });

  it('strips a ```json fence around the object', async () => {
    createMock.mockResolvedValue(textRes('```json\n' + JSON.stringify(VALID) + '\n```'));
    const { digestArticle } = await import('./digest');
    expect(await digestArticle(ARTICLE)).toEqual(VALID);
  });

  it('returns null on malformed JSON', async () => {
    createMock.mockResolvedValue(textRes('not json at all'));
    const { digestArticle } = await import('./digest');
    expect(await digestArticle(ARTICLE)).toBeNull();
  });

  it('returns null when the shape is invalid', async () => {
    createMock.mockResolvedValue(textRes(JSON.stringify({ tldr: 'only this' })));
    const { digestArticle } = await import('./digest');
    expect(await digestArticle(ARTICLE)).toBeNull();
  });

  it('returns null when the response has no usable text', async () => {
    createMock.mockResolvedValue({ content: [] });
    const { digestArticle } = await import('./digest');
    expect(await digestArticle(ARTICLE)).toBeNull();
  });

  it('returns null for an empty body without calling the model', async () => {
    const { digestArticle } = await import('./digest');
    expect(await digestArticle({ ...ARTICLE, body: '' })).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('digestStaleArticles', () => {
  it('digests articles with no stored hash and persists them', async () => {
    createMock.mockResolvedValue(textRes(JSON.stringify(VALID)));
    const { digestStaleArticles } = await import('./digest');
    const res = await digestStaleArticles([ARTICLE]);
    expect(res).toEqual({ digested: 1, failed: 0 });
    const updates = digestUpdates();
    expect(updates).toHaveLength(1);
    const [strings, json, hash, slug] = updates[0] as [string[], string, string, string];
    // A bare ::jsonb would make postgres.js re-encode the stringified digest into
    // a jsonb *string*; the text cast forces the server to parse it as an object.
    expect(strings.join('?')).toContain('::text::jsonb');
    expect(JSON.parse(json)).toEqual(VALID);
    expect(slug).toBe('post');
    expect(hash).toBeTruthy();
  });

  it('skips unchanged content — 0 API calls', async () => {
    const { digestStaleArticles } = await import('./digest');
    // First run stores the hash that was persisted alongside the digest.
    createMock.mockResolvedValue(textRes(JSON.stringify(VALID)));
    await digestStaleArticles([ARTICLE]);
    const storedHash = digestUpdates()[0][2] as string;
    createMock.mockClear();
    storedStates = [{ slug: 'post', digest_hash: storedHash }];
    const res = await digestStaleArticles([ARTICLE]);
    expect(res).toEqual({ digested: 0, failed: 0 });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('counts a null digest as failed and does not persist it', async () => {
    createMock.mockResolvedValue(textRes('not json at all'));
    const { digestStaleArticles } = await import('./digest');
    const res = await digestStaleArticles([ARTICLE]);
    expect(res).toEqual({ digested: 0, failed: 1 });
    expect(digestUpdates()).toHaveLength(0);
  });

  it('never throws — a DB error degrades to zero counts', async () => {
    selectError = new Error('pooler down');
    const { digestStaleArticles } = await import('./digest');
    await expect(digestStaleArticles([ARTICLE])).resolves.toEqual({ digested: 0, failed: 0 });
  });

  it('makes no API calls when no DB is configured (results would be discarded)', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    createMock.mockResolvedValue(textRes(JSON.stringify(VALID)));
    const { digestStaleArticles } = await import('./digest');
    expect(await digestStaleArticles([ARTICLE])).toEqual({ digested: 0, failed: 0 });
    expect(createMock).not.toHaveBeenCalled();
    expect(postgresMock).not.toHaveBeenCalled();
  });
});
