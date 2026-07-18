/** Thrown when /api/stt-token answers 503 — no ELEVENLABS_API_KEY configured. */
export class SttTokenUnavailableError extends Error {}

/** Fetch a single-use realtime-Scribe token from our server route. */
export async function fetchSttToken(): Promise<string> {
  const res = await fetch('/api/stt-token', { method: 'POST' });
  if (res.status === 503) throw new SttTokenUnavailableError('STT is not configured');
  if (!res.ok) throw new Error(`STT token route failed: ${res.status}`);
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error('STT token route: malformed response');
  return body.token;
}

interface CachedToken {
  token: string;
  fetchedAt: number;
}

export interface TokenCache {
  /** Warm the cache in the background (e.g. on entering voice mode). */
  prefetch(): void;
  /**
   * Hand out a token younger than maxAgeMs, fetching if needed.
   * Tokens are single-use: each get() consumes the cached one.
   * Only one connect happens at a time, so concurrent get()s aren't a concern.
   */
  get(forceFresh?: boolean): Promise<string>;
}

export function createTokenCache({
  fetchToken,
  maxAgeMs,
  now = () => Date.now(),
}: {
  fetchToken: () => Promise<string>;
  maxAgeMs: number;
  now?: () => number;
}): TokenCache {
  let pending: Promise<CachedToken> | null = null;

  function refetch(): void {
    const p = fetchToken().then((token) => ({ token, fetchedAt: now() }));
    // A prefetch may never be awaited — swallow here; get() re-awaits `pending`
    // and still sees the rejection.
    p.catch(() => {});
    pending = p;
  }

  return {
    prefetch() {
      if (!pending) refetch();
    },
    async get(forceFresh = false) {
      if (forceFresh || !pending) refetch();
      try {
        let cached = await pending!;
        if (now() - cached.fetchedAt > maxAgeMs) {
          refetch();
          cached = await pending!;
        }
        pending = null; // consume — tokens are single-use
        return cached.token;
      } catch (err) {
        pending = null; // a failed fetch is not reusable
        throw err;
      }
    },
  };
}
