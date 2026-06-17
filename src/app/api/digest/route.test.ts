import { describe, it, expect, vi } from 'vitest';

const { getArticleDigestsMock } = vi.hoisted(() => ({ getArticleDigestsMock: vi.fn() }));
vi.mock('@/lib/digest', () => ({ getArticleDigests: getArticleDigestsMock }));

import { GET } from './route';

const DIGEST = {
  tldr: 't',
  takeaways: ['a'],
  whyItMatters: 'w',
  tags: ['x', 'y', 'z'],
  questions: ['q?'],
};

describe('GET /api/digest', () => {
  it('returns the digests map', async () => {
    getArticleDigestsMock.mockResolvedValue({ 'https://x/a': DIGEST });
    const res = await GET();
    const json = await res.json();
    expect(json.digests['https://x/a']).toEqual(DIGEST);
  });

  it('fails soft to an empty map when generation throws', async () => {
    getArticleDigestsMock.mockRejectedValue(new Error('boom'));
    const res = await GET();
    const json = await res.json();
    expect(json.digests).toEqual({});
  });
});
