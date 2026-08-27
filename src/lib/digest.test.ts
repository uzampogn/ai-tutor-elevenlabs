import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Article } from './types';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({ messages: { create: createMock } })),
}));

const dbMock = vi.hoisted(() => ({
  getDigestStates: vi.fn(),
  updateDigests: vi.fn(),
}));
vi.mock('./db', () => dbMock);

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
  dbMock.getDigestStates.mockReset().mockResolvedValue(new Map());
  dbMock.updateDigests.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.resetModules());

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
