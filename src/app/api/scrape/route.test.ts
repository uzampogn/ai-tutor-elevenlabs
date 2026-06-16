import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getClaudeArticlesMock, getIngestionStatusMock } = vi.hoisted(() => ({
  getClaudeArticlesMock: vi.fn(),
  getIngestionStatusMock: vi.fn(),
}));
vi.mock('@/lib/scraper', () => ({
  getClaudeArticles: getClaudeArticlesMock,
  getIngestionStatus: getIngestionStatusMock,
}));

import { GET } from './route';

beforeEach(() => {
  getClaudeArticlesMock.mockReset();
  getIngestionStatusMock.mockReset();
});

describe('GET /api/scrape', () => {
  it('returns articles at the top level (back-compat) plus a status object', async () => {
    const articles = [
      { title: 'A', url: 'https://claude.com/blog/a', pubDate: '', description: '', body: '' },
    ];
    const status = {
      count: 1,
      lastSuccessfulFetch: '2026-06-16T00:00:00.000Z',
      ageMs: 0,
      stale: false,
      lastError: null,
    };
    getClaudeArticlesMock.mockResolvedValue(articles);
    getIngestionStatusMock.mockReturnValue(status);

    const res = await GET();
    const body = await res.json();
    expect(body.articles).toEqual(articles); // AppShell reads d.articles — unchanged
    expect(body.status).toEqual(status); // additive freshness signal
  });
});
