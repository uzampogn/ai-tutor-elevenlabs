import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTokenCache, fetchSttToken, SttTokenUnavailableError } from './tokenCache';

describe('fetchSttToken', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('POSTs /api/stt-token and returns the token', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ token: 'tok' }), { status: 200 })) as any;
    await expect(fetchSttToken()).resolves.toBe('tok');
    expect(global.fetch).toHaveBeenCalledWith('/api/stt-token', { method: 'POST' });
  });

  it('throws SttTokenUnavailableError on 503 (no key configured)', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 503 })) as any;
    await expect(fetchSttToken()).rejects.toBeInstanceOf(SttTokenUnavailableError);
  });

  it('throws a plain Error on other failures', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 502 })) as any;
    const err = await fetchSttToken().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SttTokenUnavailableError);
  });
});

describe('createTokenCache', () => {
  it('prefetch() fetches once; get() consumes the prefetched token', async () => {
    const fetchToken = vi.fn().mockResolvedValue('tok-1');
    const cache = createTokenCache({ fetchToken, maxAgeMs: 1000, now: () => 0 });
    cache.prefetch();
    cache.prefetch(); // no double-fetch
    await expect(cache.get()).resolves.toBe('tok-1');
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it('get() after consumption fetches a new token (single-use)', async () => {
    const fetchToken = vi.fn().mockResolvedValueOnce('tok-1').mockResolvedValueOnce('tok-2');
    const cache = createTokenCache({ fetchToken, maxAgeMs: 1000, now: () => 0 });
    await expect(cache.get()).resolves.toBe('tok-1');
    await expect(cache.get()).resolves.toBe('tok-2');
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('get() refreshes a token older than maxAgeMs', async () => {
    let t = 0;
    const fetchToken = vi.fn().mockResolvedValueOnce('stale').mockResolvedValueOnce('fresh');
    const cache = createTokenCache({ fetchToken, maxAgeMs: 1000, now: () => t });
    cache.prefetch();
    await Promise.resolve(); // let the prefetch settle at t=0
    t = 1001; // beyond maxAge
    await expect(cache.get()).resolves.toBe('fresh');
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('get(true) forces a fresh fetch even with a young cached token', async () => {
    const fetchToken = vi.fn().mockResolvedValueOnce('cached').mockResolvedValueOnce('forced');
    const cache = createTokenCache({ fetchToken, maxAgeMs: 60_000, now: () => 0 });
    cache.prefetch();
    await expect(cache.get(true)).resolves.toBe('forced');
  });

  it('a failed fetch is not reused: next get() retries', async () => {
    const fetchToken = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('recovered');
    const cache = createTokenCache({ fetchToken, maxAgeMs: 1000, now: () => 0 });
    await expect(cache.get()).rejects.toThrow('boom');
    await expect(cache.get()).resolves.toBe('recovered');
  });

  it('a rejected prefetch does not cause an unhandled rejection', async () => {
    const fetchToken = vi.fn().mockRejectedValue(new SttTokenUnavailableError('no key'));
    const cache = createTokenCache({ fetchToken, maxAgeMs: 1000, now: () => 0 });
    cache.prefetch();
    await new Promise((r) => setTimeout(r, 0)); // would surface as unhandled here
    await expect(cache.get()).rejects.toBeInstanceOf(SttTokenUnavailableError);
  });
});
