import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const dbMock = vi.hoisted(() => ({ getDigests: vi.fn() }));
vi.mock('@/lib/db', () => dbMock);

const VALID = {
  tldr: 'A one-liner.',
  takeaways: ['a', 'b', 'c'],
  whyItMatters: 'It matters.',
  tags: ['X', 'Y', 'Z'],
  questions: ['Q1?', 'Q2?'],
};

// Block body on purpose: an arrow returning `mockReset()` hands Vitest the stub
// as a teardown function, which then *calls* the mock after the test — outside
// the route's try/catch, so a rejecting mock surfaces as an unhandled error.
beforeEach(() => {
  dbMock.getDigests.mockReset();
});
afterEach(() => {
  vi.resetModules();
});

describe('GET /api/digest', () => {
  it('returns the persisted digest map', async () => {
    dbMock.getDigests.mockResolvedValue({ 'https://claude.com/blog/post': VALID });
    const { GET } = await import('./route');
    const res = await GET();
    expect(await res.json()).toEqual({ digests: { 'https://claude.com/blog/post': VALID } });
  });

  it('fails soft to an empty map on a DB error', async () => {
    dbMock.getDigests.mockRejectedValue(new Error('pooler down'));
    const { GET } = await import('./route');
    const res = await GET();
    expect(await res.json()).toEqual({ digests: {} });
  });
});
