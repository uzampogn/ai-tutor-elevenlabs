import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Article } from './types';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({ messages: { create: createMock } })),
}));

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

beforeEach(() => createMock.mockReset());
afterEach(() => vi.resetModules());

describe('digestArticle', () => {
  it('parses a valid JSON digest', async () => {
    createMock.mockResolvedValue(textRes(JSON.stringify(VALID)));
    const { digestArticle } = await import('./digest');
    expect(await digestArticle(ARTICLE)).toEqual(VALID);
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
