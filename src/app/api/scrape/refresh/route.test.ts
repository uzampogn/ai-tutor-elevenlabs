import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the scraper (route auth tested without scraping) and next/cache (assert revalidation).
const { getClaudeArticlesMock, getIngestionStatusMock, revalidateTagMock } = vi.hoisted(() => ({
  getClaudeArticlesMock: vi.fn(),
  getIngestionStatusMock: vi.fn(),
  revalidateTagMock: vi.fn(),
}));
vi.mock('@/lib/scraper', () => ({
  getClaudeArticles: getClaudeArticlesMock,
  getIngestionStatus: getIngestionStatusMock,
  GROUNDING_TAG: 'grounding',
}));
vi.mock('next/cache', () => ({
  revalidateTag: revalidateTagMock,
}));

import { GET } from './route';

const STATUS = {
  count: 24,
  lastSuccessfulFetch: '2026-06-16T00:00:00.000Z',
  ageMs: 0,
  stale: false,
  lastError: null,
};

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function req(authorization?: string): Request {
  return new Request('http://localhost/api/scrape/refresh', {
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  getClaudeArticlesMock.mockReset().mockResolvedValue([]);
  getIngestionStatusMock.mockReset().mockReturnValue(STATUS);
  revalidateTagMock.mockReset();
  process.env.CRON_SECRET = 'test-secret';
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe('GET /api/scrape/refresh', () => {
  it('401s without an Authorization header and does not scrape or revalidate', async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(getClaudeArticlesMock).not.toHaveBeenCalled();
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });

  it('401s with the wrong bearer token and does not scrape or revalidate', async () => {
    const res = await GET(req('Bearer wrong-token'));
    expect(res.status).toBe(401);
    expect(getClaudeArticlesMock).not.toHaveBeenCalled();
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });

  it('with the correct bearer, forces a re-scrape, revalidates the grounding cache, and returns status JSON', async () => {
    const res = await GET(req('Bearer test-secret'));
    expect(res.status).toBe(200);
    expect(getClaudeArticlesMock).toHaveBeenCalledWith({ force: true });
    expect(revalidateTagMock).toHaveBeenCalledWith('grounding');
    const body = await res.json();
    expect(body).toEqual(STATUS);
  });

  it('fails closed (401, no scrape, no revalidate) when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req('Bearer test-secret'));
    expect(res.status).toBe(401);
    expect(getClaudeArticlesMock).not.toHaveBeenCalled();
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });
});
