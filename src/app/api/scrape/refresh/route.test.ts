import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the scraper so route auth is tested without scraping.
const { getClaudeArticlesMock, getIngestionStatusMock } = vi.hoisted(() => ({
  getClaudeArticlesMock: vi.fn(),
  getIngestionStatusMock: vi.fn(),
}));
vi.mock('@/lib/scraper', () => ({
  getClaudeArticles: getClaudeArticlesMock,
  getIngestionStatus: getIngestionStatusMock,
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
  process.env.CRON_SECRET = 'test-secret';
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe('GET /api/scrape/refresh', () => {
  it('401s without an Authorization header and does not scrape', async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(getClaudeArticlesMock).not.toHaveBeenCalled();
  });

  it('401s with the wrong bearer token and does not scrape', async () => {
    const res = await GET(req('Bearer wrong-token'));
    expect(res.status).toBe(401);
    expect(getClaudeArticlesMock).not.toHaveBeenCalled();
  });

  it('with the correct bearer, forces a re-scrape and returns the status JSON', async () => {
    const res = await GET(req('Bearer test-secret'));
    expect(res.status).toBe(200);
    expect(getClaudeArticlesMock).toHaveBeenCalledWith({ force: true });
    const body = await res.json();
    expect(body).toEqual(STATUS);
  });

  it('fails closed (401, no scrape) when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req('Bearer test-secret'));
    expect(res.status).toBe(401);
    expect(getClaudeArticlesMock).not.toHaveBeenCalled();
  });
});
