# Scribe STT Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser Web Speech API recognition engine with ElevenLabs Scribe v2 Realtime (per-turn WebSocket, server VAD) behind the existing voice-input seam, with Web Speech kept as a silent fallback.

**Architecture:** A new `useVoiceInput` hook wraps two always-mounted engine hooks — new `useScribeRecognition` (primary) and the untouched `useSpeechRecognition` (fallback) — and exposes the exact contract `VoiceDock`/`MicBtn` already consume. A new server route mints single-use Scribe tokens. Starting to listen pauses TTS playback (echo strategy).

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript 5, Vitest + Testing Library (jsdom), `@elevenlabs/client` ^1.15.1.

**Spec:** `spec/scribe-stt-migration/spec.md` — read it first; the fallback table, parity checklist, and config values there are normative.

## Global Constraints

- Work in a **git worktree** (superpowers:using-git-worktrees), branch `feat/scribe-stt-migration`, PR targets `main`.
- Node **>= 24** (`nvm use` in the project dir before anything).
- Never run `next build` while `next dev` is live (shared `.next/` corrupts).
- Quality gate before push: `npm run lint && npm run typecheck && npm run test:run`.
- `src/components/main/useSpeechRecognition.ts` and `src/components/main/useSpeechRecognition.test.tsx` must remain **byte-unchanged**.
- `VoiceDock.test.tsx` behavioral assertions unchanged (only mock wiring may move).
- Visual system Aurora Mist is **locked**: no palette/font/radius/shadow/`@keyframes` changes.
- Imports use the `@/*` → `./src/*` alias (house style).
- Verified API facts (do not re-derive): token mint = `POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe`, header `xi-api-key`, no body → `{ "token": string }`, expires 15 min, single-use. Transcript payloads carry `.text`. Every Scribe WS message carries `message_type`. The generic `ERROR` event **also fires for specific error types** — dedupe by `message_type`.

---

### Task 1: Token-mint server route

**Files:**
- Create: `src/app/api/stt-token/route.ts`
- Create: `src/app/api/stt-token/route.test.ts`
- Modify: `.env.example` (ELEVENLABS_API_KEY comment)

**Interfaces:**
- Consumes: `process.env.ELEVENLABS_API_KEY` (already used by `/api/speak`).
- Produces: `POST /api/stt-token` → `200 {token: string}` | `503 {error}` (no key) | `502 {error}` (upstream failure). All responses `Cache-Control: no-store`. Task 3's `fetchSttToken` depends on exactly these statuses.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/api/stt-token/route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';

describe('/api/stt-token', () => {
  const realFetch = global.fetch;
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => {
    global.fetch = realFetch;
    vi.unstubAllEnvs();
  });

  it('returns 503 with no-store when ELEVENLABS_API_KEY is unset', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    const res = await POST();
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('mints a token via the ElevenLabs single-use-token endpoint', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'test-key');
    const upstream = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'tok-123' }), { status: 200 }),
    );
    global.fetch = upstream as unknown as typeof fetch;

    const res = await POST();
    expect(upstream).toHaveBeenCalledWith(
      'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe',
      { method: 'POST', headers: { 'xi-api-key': 'test-key' } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({ token: 'tok-123' });
    // the API key must never appear in the response
    expect(JSON.stringify(body)).not.toContain('test-key');
  });

  it('returns 502 when the upstream mint fails', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'test-key');
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('nope', { status: 401 })) as unknown as typeof fetch;
    const res = await POST();
    expect(res.status).toBe(502);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/app/api/stt-token/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement the route**

```ts
// src/app/api/stt-token/route.ts
import { NextResponse } from 'next/server';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Mint a single-use realtime-Scribe token for client-side STT.
 * The ElevenLabs API key stays server-side; the returned token is
 * time-bound (15 min) and consumed on first use.
 */
export async function POST() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'STT is not configured' },
      { status: 503, headers: NO_STORE },
    );
  }
  const res = await fetch(`${ELEVENLABS_BASE}/single-use-token/realtime_scribe`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: 'Token mint failed' },
      { status: 502, headers: NO_STORE },
    );
  }
  const { token } = (await res.json()) as { token: string };
  return NextResponse.json({ token }, { headers: NO_STORE });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- src/app/api/stt-token/route.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Update `.env.example`**

Find the `ELEVENLABS_API_KEY` line and extend its comment to:

```
# ElevenLabs — powers TTS (/api/speak) AND STT token minting (/api/stt-token).
# Without it: answers are text-only and voice input falls back to the
# browser's Web Speech API (Chrome/Edge only).
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/stt-token/ .env.example
git commit -m "feat(stt): token-mint route for realtime Scribe"
```

---

### Task 2: STT config, SDK dependency, and the test fake

**Files:**
- Create: `src/lib/stt/config.ts`
- Create: `src/test/fakeScribeClient.ts`
- Create: `src/test/fakeScribeClient.test.ts`
- Modify: `vitest.config.mts` (alias), `vitest.setup.ts` (reset hook), `package.json` (dependency)

**Interfaces:**
- Produces: config constants `STT_MODEL_ID`, `STT_LANGUAGE`, `STT_VAD_SILENCE_SECS`, `STT_TOKEN_MAX_AGE_MS`, `STT_MIC`, `STT_KEYTERMS`, `STT_COMMIT_STRATEGY` (Tasks 4–5 import these).
- Produces: in tests, `import { Scribe, RealtimeEvents, __lastConnection, __reset } from '@/test/fakeScribeClient'` — the alias makes every `@elevenlabs/client` import resolve to this fake at test runtime, so the real SDK (which needs `AudioContext`/`AudioWorklet`, absent in jsdom) never loads. `tsc` still checks against the real package types.

- [ ] **Step 1: Install the SDK**

Run: `npm install @elevenlabs/client@^1.15.1`
Expected: added to `package.json` dependencies.

- [ ] **Step 2: Write the config module**

```ts
// src/lib/stt/config.ts
import { CommitStrategy } from '@elevenlabs/client';

/** All Scribe STT tuning constants in one place (spec § Scribe configuration). */
export const STT_MODEL_ID = 'scribe_v2_realtime';
/** ISO 639-3 — explicit hint beats locale guessing for accented English. */
export const STT_LANGUAGE = 'eng';
export const STT_COMMIT_STRATEGY = CommitStrategy.VAD;
/** SDK range 0.3–3.0; matches the old app-side SILENCE_TIMEOUT_MS (2500ms). */
export const STT_VAD_SILENCE_SECS = 2.5;
/** Tokens expire at 15 min; refresh anything older than 10 before connecting. */
export const STT_TOKEN_MAX_AGE_MS = 10 * 60_000;
/** Mic constraints — AEC/NS/AGC on as defense in depth (echo is primarily
 * handled by pausing TTS playback when listening starts). */
export const STT_MIC = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};
/** Deferred (spec § Deferred). Max 50 terms × 20 chars on realtime.
 * Wire-ready: passed to connect() whenever non-empty. */
export const STT_KEYTERMS: string[] = [];
```

- [ ] **Step 3: Write the failing fake-client smoke test**

```ts
// src/test/fakeScribeClient.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  Scribe,
  RealtimeEvents,
  CommitStrategy,
  __connections,
  __lastConnection,
  __reset,
} from './fakeScribeClient';

describe('fakeScribeClient', () => {
  it('connect() returns a connection that records options and emits to listeners', () => {
    __reset();
    const conn = Scribe.connect({ token: 't', modelId: 'scribe_v2_realtime' });
    expect(__lastConnection()).toBe(conn);
    expect(Scribe.connect).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'scribe_v2_realtime' }),
    );

    const onPartial = vi.fn();
    conn.on(RealtimeEvents.PARTIAL_TRANSCRIPT, onPartial);
    conn.emit(RealtimeEvents.PARTIAL_TRANSCRIPT, {
      message_type: 'partial_transcript',
      text: 'hello',
    });
    expect(onPartial).toHaveBeenCalledWith({
      message_type: 'partial_transcript',
      text: 'hello',
    });

    conn.off(RealtimeEvents.PARTIAL_TRANSCRIPT, onPartial);
    conn.emit(RealtimeEvents.PARTIAL_TRANSCRIPT, { message_type: 'partial_transcript', text: 'x' });
    expect(onPartial).toHaveBeenCalledTimes(1);
  });

  it('__reset clears recorded connections', () => {
    Scribe.connect({ token: 't', modelId: 'm' });
    __reset();
    expect(__connections).toHaveLength(0);
  });

  it('exports the enum values app code relies on', () => {
    expect(CommitStrategy.VAD).toBe('vad');
    expect(RealtimeEvents.SESSION_STARTED).toBe('session_started');
    expect(RealtimeEvents.COMMITTED_TRANSCRIPT).toBe('committed_transcript');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:run -- src/test/fakeScribeClient.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the fake**

```ts
// src/test/fakeScribeClient.ts
/**
 * Test stand-in for '@elevenlabs/client'. The real SDK needs
 * AudioContext/AudioWorklet, which jsdom lacks — a vitest alias resolves
 * every '@elevenlabs/client' import here at test runtime (tsc still checks
 * app code against the real package's types). Mirrors the
 * MockSpeechRecognition pattern in vitest.setup.ts.
 */
import { vi } from 'vitest';

// Values copied verbatim from @elevenlabs/client's declaration files.
export enum RealtimeEvents {
  SESSION_STARTED = 'session_started',
  PARTIAL_TRANSCRIPT = 'partial_transcript',
  COMMITTED_TRANSCRIPT = 'committed_transcript',
  COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS = 'committed_transcript_with_timestamps',
  AUTH_ERROR = 'auth_error',
  ERROR = 'error',
  OPEN = 'open',
  CLOSE = 'close',
  QUOTA_EXCEEDED = 'quota_exceeded',
  COMMIT_THROTTLED = 'commit_throttled',
  TRANSCRIBER_ERROR = 'transcriber_error',
  UNACCEPTED_TERMS = 'unaccepted_terms',
  RATE_LIMITED = 'rate_limited',
  INPUT_ERROR = 'input_error',
  QUEUE_OVERFLOW = 'queue_overflow',
  RESOURCE_EXHAUSTED = 'resource_exhausted',
  SESSION_TIME_LIMIT_EXCEEDED = 'session_time_limit_exceeded',
  CHUNK_SIZE_EXCEEDED = 'chunk_size_exceeded',
  INSUFFICIENT_AUDIO_ACTIVITY = 'insufficient_audio_activity',
}

export enum CommitStrategy {
  MANUAL = 'manual',
  VAD = 'vad',
}

export enum AudioFormat {
  PCM_8000 = 'pcm_8000',
  PCM_16000 = 'pcm_16000',
  PCM_22050 = 'pcm_22050',
  PCM_24000 = 'pcm_24000',
  PCM_44100 = 'pcm_44100',
  PCM_48000 = 'pcm_48000',
  ULAW_8000 = 'ulaw_8000',
}

type Listener = (data: unknown) => void;

export class FakeRealtimeConnection {
  private handlers = new Map<string, Set<Listener>>();
  send = vi.fn();
  commit = vi.fn();
  close = vi.fn();
  mute = vi.fn();
  unmute = vi.fn();

  on(event: string, listener: Listener): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(listener);
  }

  off(event: string, listener: Listener): void {
    this.handlers.get(event)?.delete(listener);
  }

  /** Test helper — drive an incoming server message. */
  emit(event: string, data?: unknown): void {
    this.handlers.get(event)?.forEach((l) => l(data));
  }
}

export const __connections: FakeRealtimeConnection[] = [];
export const __lastConnection = (): FakeRealtimeConnection =>
  __connections[__connections.length - 1];

export const Scribe = {
  connect: vi.fn((_options: unknown): FakeRealtimeConnection => {
    const conn = new FakeRealtimeConnection();
    __connections.push(conn);
    return conn;
  }),
};

export function __reset(): void {
  __connections.length = 0;
  Scribe.connect.mockClear();
}

// Type-position imports in app code are erased at runtime; this satisfies
// any accidental value-position use.
export type RealtimeConnection = FakeRealtimeConnection;
```

- [ ] **Step 6: Wire the alias and the reset hook**

In `vitest.config.mts`, add a `resolve.alias` block (keep all existing fields):

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      // jsdom has no AudioContext/AudioWorklet — never load the real SDK in tests.
      '@elevenlabs/client': path.resolve(__dirname, 'src/test/fakeScribeClient.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
```

In `vitest.setup.ts`, append at the end:

```ts
// Scribe STT — reset the fake '@elevenlabs/client' between tests.
import { __reset as resetFakeScribe } from './src/test/fakeScribeClient';

afterEach(() => {
  resetFakeScribe();
});
```

- [ ] **Step 7: Run the whole suite to verify nothing broke**

Run: `npm run test:run`
Expected: all existing tests + the 3 new fake tests pass. Then `npm run typecheck` — passes (config.ts imports the real SDK's `CommitStrategy` type).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/stt/config.ts src/test/ vitest.config.mts vitest.setup.ts
git commit -m "feat(stt): Scribe config, SDK dep, and jsdom test fake"
```

---

### Task 3: Token cache with staleness guard

**Files:**
- Create: `src/lib/stt/tokenCache.ts`
- Create: `src/lib/stt/tokenCache.test.ts`

**Interfaces:**
- Consumes: `POST /api/stt-token` (Task 1 statuses).
- Produces (Task 4 depends on these exact signatures):
  - `class SttTokenUnavailableError extends Error`
  - `fetchSttToken(): Promise<string>` — throws `SttTokenUnavailableError` on 503.
  - `createTokenCache(opts: { fetchToken: () => Promise<string>; maxAgeMs: number; now?: () => number }): TokenCache`
  - `interface TokenCache { prefetch(): void; get(forceFresh?: boolean): Promise<string> }` — `get` consumes the cached token (single-use) and transparently refreshes if older than `maxAgeMs`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/stt/tokenCache.test.ts
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
      .mockResolvedValue(new Response(JSON.stringify({ token: 'tok' }), { status: 200 }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      as any;
    await expect(fetchSttToken()).resolves.toBe('tok');
    expect(global.fetch).toHaveBeenCalledWith('/api/stt-token', { method: 'POST' });
  });

  it('throws SttTokenUnavailableError on 503 (no key configured)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 503 })) as any;
    await expect(fetchSttToken()).rejects.toBeInstanceOf(SttTokenUnavailableError);
  });

  it('throws a plain Error on other failures', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/lib/stt/tokenCache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/stt/tokenCache.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- src/lib/stt/tokenCache.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stt/tokenCache.ts src/lib/stt/tokenCache.test.ts
git commit -m "feat(stt): single-use token cache with staleness guard"
```

---

### Task 4: `useScribeRecognition` hook

**Files:**
- Create: `src/components/main/useScribeRecognition.ts`
- Create: `src/components/main/useScribeRecognition.test.tsx`

**Interfaces:**
- Consumes: Task 2 config constants; Task 3 `createTokenCache`/`fetchSttToken`/`SttTokenUnavailableError`; `@elevenlabs/client` (`Scribe`, `RealtimeEvents`, type `RealtimeConnection`).
- Produces (Task 5 depends on these exact signatures):

```ts
export type ScribeFailureKind =
  | 'no_key' | 'auth' | 'quota' | 'terms' | 'resources' | 'rate_limited' | 'socket';
export interface ScribeTurnError { kind: ScribeFailureKind; partial: string; }
export interface UseScribeRecognitionOptions {
  active: boolean;                       // engine selected by useVoiceInput
  setListening: (v: boolean) => void;    // flips true only on SESSION_STARTED
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onTurnError: (err: ScribeTurnError) => void;
  disabled?: boolean;
}
export interface UseScribeRecognitionResult { toggle: () => void; sendNow: () => void; }
export function useScribeRecognition(o: UseScribeRecognitionOptions): UseScribeRecognitionResult;
```

Behavior contract (each is a test below): connect per turn with config values; listening=true only on `SESSION_STARTED`; partial → `onInterim` (replace); committed → `onFinal` + close; `sendNow` with text → `onFinal(partial)`, empty → silent cancel; toggle while on → cancel without sending; `disabled` mid-turn → close + suppress late events; `AUTH_ERROR` → one forced-fresh-token reconnect, then `onTurnError('auth')`; specific errors → mapped kinds with the last partial; generic `ERROR` deduped by `message_type`; unexpected `CLOSE` → `'socket'`; token 503 → `'no_key'`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/main/useScribeRecognition.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import {
  Scribe,
  RealtimeEvents,
  __lastConnection,
  __connections,
} from '@/test/fakeScribeClient';
import {
  useScribeRecognition,
  type UseScribeRecognitionOptions,
  type UseScribeRecognitionResult,
} from './useScribeRecognition';

function Harness({
  onResult,
  ...hookArgs
}: UseScribeRecognitionOptions & {
  onResult: (r: UseScribeRecognitionResult) => void;
}) {
  const result = useScribeRecognition(hookArgs);
  React.useEffect(() => {
    onResult(result);
  });
  return null;
}

function setup(overrides: Partial<UseScribeRecognitionOptions> = {}) {
  const props: UseScribeRecognitionOptions = {
    active: true,
    setListening: vi.fn(),
    onInterim: vi.fn(),
    onFinal: vi.fn(),
    onTurnError: vi.fn(),
    disabled: false,
    ...overrides,
  };
  let hook!: UseScribeRecognitionResult;
  const view = render(<Harness {...props} onResult={(r) => (hook = r)} />);
  return { props, hook: () => hook, view };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useScribeRecognition', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ token: 'tok' }), { status: 200 }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      as any;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('toggle() connects with the spec config; listening only on SESSION_STARTED', async () => {
    const { props, hook } = setup();
    act(() => hook().toggle());
    await flush();

    expect(Scribe.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'tok',
        modelId: 'scribe_v2_realtime',
        languageCode: 'eng',
        commitStrategy: 'vad',
        vadSilenceThresholdSecs: 2.5,
        microphone: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }),
    );
    // keyterms empty → not sent at all
    expect(Scribe.connect).not.toHaveBeenCalledWith(
      expect.objectContaining({ keyterms: expect.anything() }),
    );
    expect(props.setListening).not.toHaveBeenCalledWith(true);

    act(() => __lastConnection().emit(RealtimeEvents.SESSION_STARTED, {
      message_type: 'session_started', session_id: 's', config: {},
    }));
    expect(props.setListening).toHaveBeenCalledWith(true);
  });

  it('partial → onInterim; committed → onFinal + close', async () => {
    const { props, hook } = setup();
    act(() => hook().toggle());
    await flush();
    const conn = __lastConnection();

    act(() => conn.emit(RealtimeEvents.PARTIAL_TRANSCRIPT, {
      message_type: 'partial_transcript', text: 'bonjour claude',
    }));
    expect(props.onInterim).toHaveBeenCalledWith('bonjour claude');

    act(() => conn.emit(RealtimeEvents.COMMITTED_TRANSCRIPT, {
      message_type: 'committed_transcript', text: 'bonjour claude ',
    }));
    expect(props.onFinal).toHaveBeenCalledWith('bonjour claude');
    expect(conn.close).toHaveBeenCalled();
    expect(props.setListening).toHaveBeenLastCalledWith(false);
  });

  it('sendNow() with partial text fires onFinal and closes; empty partial cancels silently', async () => {
    const { props, hook } = setup();
    act(() => hook().toggle());
    await flush();
    const conn = __lastConnection();
    act(() => conn.emit(RealtimeEvents.PARTIAL_TRANSCRIPT, {
      message_type: 'partial_transcript', text: 'send this now',
    }));
    act(() => hook().sendNow());
    expect(props.onFinal).toHaveBeenCalledWith('send this now');
    expect(conn.close).toHaveBeenCalled();

    // fresh turn, nothing said → cancel
    vi.mocked(props.onFinal).mockClear();
    act(() => hook().toggle());
    await flush();
    const conn2 = __lastConnection();
    act(() => hook().sendNow());
    expect(props.onFinal).not.toHaveBeenCalled();
    expect(conn2.close).toHaveBeenCalled();
    expect(props.setListening).toHaveBeenLastCalledWith(false);
  });

  it('toggle() while connecting/listening cancels without sending', async () => {
    const { props, hook } = setup();
    act(() => hook().toggle());
    await flush();
    const conn = __lastConnection();
    act(() => conn.emit(RealtimeEvents.PARTIAL_TRANSCRIPT, {
      message_type: 'partial_transcript', text: 'never sent',
    }));
    act(() => hook().toggle());
    expect(conn.close).toHaveBeenCalled();
    expect(props.onFinal).not.toHaveBeenCalled();
  });

  it('disabled mid-turn closes and suppresses late events (no double-send)', async () => {
    const { props, hook, view } = setup();
    act(() => hook().toggle());
    await flush();
    const conn = __lastConnection();
    act(() => conn.emit(RealtimeEvents.SESSION_STARTED, {
      message_type: 'session_started', session_id: 's', config: {},
    }));

    view.rerender(
      <Harness
        {...props}
        disabled
        onResult={() => {}}
      />,
    );
    expect(conn.close).toHaveBeenCalled();

    // a straggler commit after close must NOT reach onFinal
    act(() => conn.emit(RealtimeEvents.COMMITTED_TRANSCRIPT, {
      message_type: 'committed_transcript', text: 'late',
    }));
    expect(props.onFinal).not.toHaveBeenCalled();
  });

  it('AUTH_ERROR retries once with a forced-fresh token, then reports kind auth', async () => {
    const { props, hook } = setup();
    act(() => hook().toggle());
    await flush();
    expect(__connections).toHaveLength(1);

    act(() => __lastConnection().emit(RealtimeEvents.AUTH_ERROR, {
      message_type: 'auth_error', error: 'expired',
    }));
    await flush();
    expect(__connections).toHaveLength(2); // reconnected
    expect(global.fetch).toHaveBeenCalledTimes(2); // second token was forced fresh
    expect(props.onTurnError).not.toHaveBeenCalled();

    act(() => __lastConnection().emit(RealtimeEvents.AUTH_ERROR, {
      message_type: 'auth_error', error: 'still bad',
    }));
    await flush();
    expect(__connections).toHaveLength(2); // no third attempt
    expect(props.onTurnError).toHaveBeenCalledWith({ kind: 'auth', partial: '' });
  });

  it('maps specific errors to kinds and carries the last partial', async () => {
    const cases: Array<[RealtimeEvents, string, string]> = [
      [RealtimeEvents.QUOTA_EXCEEDED, 'quota_exceeded', 'quota'],
      [RealtimeEvents.UNACCEPTED_TERMS, 'unaccepted_terms', 'terms'],
      [RealtimeEvents.RESOURCE_EXHAUSTED, 'resource_exhausted', 'resources'],
      [RealtimeEvents.RATE_LIMITED, 'rate_limited', 'rate_limited'],
    ];
    for (const [event, messageType, kind] of cases) {
      const { props, hook, view } = setup();
      act(() => hook().toggle());
      await flush();
      const conn = __lastConnection();
      act(() => conn.emit(RealtimeEvents.PARTIAL_TRANSCRIPT, {
        message_type: 'partial_transcript', text: 'half a sentence',
      }));
      act(() => conn.emit(event, { message_type: messageType, error: 'x' }));
      expect(props.onTurnError).toHaveBeenCalledWith({ kind, partial: 'half a sentence' });
      view.unmount();
    }
  });

  it('generic ERROR for an already-handled message_type is ignored (no double report)', async () => {
    const { props, hook } = setup();
    act(() => hook().toggle());
    await flush();
    const conn = __lastConnection();
    act(() => conn.emit(RealtimeEvents.QUOTA_EXCEEDED, {
      message_type: 'quota_exceeded', error: 'x',
    }));
    act(() => conn.emit(RealtimeEvents.ERROR, {
      message_type: 'quota_exceeded', error: 'x',
    }));
    expect(props.onTurnError).toHaveBeenCalledTimes(1);
    expect(props.onTurnError).toHaveBeenCalledWith({ kind: 'quota', partial: '' });
  });

  it('unexpected CLOSE mid-turn reports socket with the partial', async () => {
    const { props, hook } = setup();
    act(() => hook().toggle());
    await flush();
    const conn = __lastConnection();
    act(() => conn.emit(RealtimeEvents.PARTIAL_TRANSCRIPT, {
      message_type: 'partial_transcript', text: 'dropped words',
    }));
    act(() => conn.emit(RealtimeEvents.CLOSE, {}));
    expect(props.onTurnError).toHaveBeenCalledWith({ kind: 'socket', partial: 'dropped words' });
  });

  it('token route 503 reports no_key and never connects', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 503 }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      as any;
    const { props, hook } = setup();
    act(() => hook().toggle());
    await flush();
    expect(Scribe.connect).not.toHaveBeenCalled();
    expect(props.onTurnError).toHaveBeenCalledWith({ kind: 'no_key', partial: '' });
  });

  it('inactive engine never prefetches or connects', async () => {
    const { hook } = setup({ active: false });
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
    act(() => hook().toggle());
    await flush();
    expect(Scribe.connect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/components/main/useScribeRecognition.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
// src/components/main/useScribeRecognition.ts
'use client';

import { useEffect, useRef } from 'react';
import {
  Scribe,
  RealtimeEvents,
  type RealtimeConnection,
} from '@elevenlabs/client';
import {
  STT_MODEL_ID,
  STT_LANGUAGE,
  STT_COMMIT_STRATEGY,
  STT_VAD_SILENCE_SECS,
  STT_TOKEN_MAX_AGE_MS,
  STT_MIC,
  STT_KEYTERMS,
} from '@/lib/stt/config';
import {
  createTokenCache,
  fetchSttToken,
  SttTokenUnavailableError,
} from '@/lib/stt/tokenCache';

export type ScribeFailureKind =
  | 'no_key'
  | 'auth'
  | 'quota'
  | 'terms'
  | 'resources'
  | 'rate_limited'
  | 'socket';

export interface ScribeTurnError {
  kind: ScribeFailureKind;
  /** Words already recognized when the turn died — never silently lost. */
  partial: string;
}

export interface UseScribeRecognitionOptions {
  /** Engine selected by useVoiceInput. Inactive = fully inert (no network/mic). */
  active: boolean;
  /** Flipped true only on SESSION_STARTED — the orb must not invite speech
   * into a socket that isn't open yet. */
  setListening: (v: boolean) => void;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onTurnError: (err: ScribeTurnError) => void;
  disabled?: boolean;
}

export interface UseScribeRecognitionResult {
  toggle: () => void;
  sendNow: () => void;
}

/** message_types owned by specific handlers; the generic ERROR event also
 * fires for these and must not double-report. */
const SPECIFICALLY_HANDLED = new Set([
  'auth_error',
  'quota_exceeded',
  'unaccepted_terms',
  'resource_exhausted',
  'rate_limited',
]);

export function useScribeRecognition({
  active,
  setListening,
  onInterim,
  onFinal,
  onTurnError,
  disabled = false,
}: UseScribeRecognitionOptions): UseScribeRecognitionResult {
  const connRef = useRef<RealtimeConnection | null>(null);
  const partialRef = useRef('');
  /** User intends to be capturing (connecting or listening). */
  const intentRef = useRef(false);
  /** One forced-fresh-token reconnect per turn on AUTH_ERROR. */
  const authRetriedRef = useRef(false);
  const tokenCacheRef = useRef(
    createTokenCache({ fetchToken: fetchSttToken, maxAgeMs: STT_TOKEN_MAX_AGE_MS }),
  );

  // Latest callbacks in a ref so handlers always see current props
  // (same pattern as useSpeechRecognition).
  const cb = useRef({ onInterim, onFinal, setListening, onTurnError });
  cb.current = { onInterim, onFinal, setListening, onTurnError };

  // Hide the connect handshake: warm a token as soon as the engine is active.
  useEffect(() => {
    if (active) tokenCacheRef.current.prefetch();
  }, [active]);

  /** Close the current connection and reset turn state. Clearing connRef
   * FIRST makes every late event a no-op (each handler checks identity). */
  function teardown() {
    intentRef.current = false;
    const conn = connRef.current;
    connRef.current = null;
    partialRef.current = '';
    authRetriedRef.current = false;
    conn?.close();
    cb.current.setListening(false);
  }

  function fail(kind: ScribeFailureKind) {
    const partial = partialRef.current;
    teardown();
    cb.current.onTurnError({ kind, partial });
  }

  async function connect(forceFreshToken: boolean) {
    let token: string;
    try {
      token = await tokenCacheRef.current.get(forceFreshToken);
    } catch (err) {
      intentRef.current = false;
      cb.current.setListening(false);
      cb.current.onTurnError({
        kind: err instanceof SttTokenUnavailableError ? 'no_key' : 'socket',
        partial: '',
      });
      return;
    }
    if (!intentRef.current) return; // user cancelled while the token was in flight

    const conn = Scribe.connect({
      token,
      modelId: STT_MODEL_ID,
      languageCode: STT_LANGUAGE,
      commitStrategy: STT_COMMIT_STRATEGY,
      vadSilenceThresholdSecs: STT_VAD_SILENCE_SECS,
      ...(STT_KEYTERMS.length > 0 ? { keyterms: STT_KEYTERMS } : {}),
      microphone: STT_MIC,
    });
    connRef.current = conn;
    const isCurrent = () => connRef.current === conn;

    conn.on(RealtimeEvents.SESSION_STARTED, () => {
      if (!isCurrent()) return;
      cb.current.setListening(true);
    });

    conn.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (msg) => {
      if (!isCurrent()) return;
      const { text } = msg as { text: string };
      partialRef.current = text;
      if (text.trim()) cb.current.onInterim(text);
    });

    conn.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (msg) => {
      if (!isCurrent()) return;
      const text = (msg as { text: string }).text.trim();
      teardown();
      // Empty commit (VAD fired on noise): the turn just ends, nothing sent —
      // parity with the old timer firing on an empty transcript.
      if (text) cb.current.onFinal(text);
    });

    conn.on(RealtimeEvents.AUTH_ERROR, () => {
      if (!isCurrent()) return;
      connRef.current = null; // suppress this connection's remaining events
      conn.close();
      if (!authRetriedRef.current) {
        // A stale prefetched token must never end the turn — one retry
        // with a forced-fresh token.
        authRetriedRef.current = true;
        void connect(true);
      } else {
        const partial = partialRef.current;
        intentRef.current = false;
        partialRef.current = '';
        authRetriedRef.current = false;
        cb.current.setListening(false);
        cb.current.onTurnError({ kind: 'auth', partial });
      }
    });

    conn.on(RealtimeEvents.QUOTA_EXCEEDED, () => isCurrent() && fail('quota'));
    conn.on(RealtimeEvents.UNACCEPTED_TERMS, () => isCurrent() && fail('terms'));
    conn.on(RealtimeEvents.RESOURCE_EXHAUSTED, () => isCurrent() && fail('resources'));
    conn.on(RealtimeEvents.RATE_LIMITED, () => isCurrent() && fail('rate_limited'));

    conn.on(RealtimeEvents.ERROR, (msg) => {
      if (!isCurrent()) return;
      // ERROR also fires for specific error types — their handlers own those.
      const messageType = (msg as { message_type?: string } | undefined)?.message_type ?? '';
      if (SPECIFICALLY_HANDLED.has(messageType)) return;
      fail('socket');
    });

    conn.on(RealtimeEvents.CLOSE, () => {
      if (!isCurrent()) return; // deliberate teardown cleared connRef first
      fail('socket'); // server/network dropped us mid-turn
    });
  }

  function start() {
    if (!active || disabled || intentRef.current) return;
    partialRef.current = '';
    authRetriedRef.current = false;
    intentRef.current = true;
    void connect(false);
  }

  function sendNow() {
    if (!intentRef.current) return;
    const text = partialRef.current.trim();
    teardown();
    // Empty transcript → explicit tap means cancel (parity with the old
    // commit(cancelIfEmpty=true) path).
    if (text) cb.current.onFinal(text);
  }

  function toggle() {
    if (intentRef.current) {
      teardown(); // stop without sending (MicBtn parity)
    } else {
      start();
    }
  }

  // A send started while capturing → hard-stop the mic (parity with
  // useSpeechRecognition's disabled effect).
  useEffect(() => {
    if (disabled && intentRef.current) teardown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  // Unmount: release the socket + mic without touching state setters.
  useEffect(
    () => () => {
      const conn = connRef.current;
      connRef.current = null;
      conn?.close();
    },
    [],
  );

  return { toggle, sendNow };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- src/components/main/useScribeRecognition.test.tsx`
Expected: 11 passed. Also run `npm run typecheck` — the hook compiles against the **real** SDK types (`RealtimeConnection.on` expects typed listeners; the `msg as { text: string }` casts keep the fake and real signatures compatible).

- [ ] **Step 5: Commit**

```bash
git add src/components/main/useScribeRecognition.ts src/components/main/useScribeRecognition.test.tsx
git commit -m "feat(stt): Scribe realtime recognition hook"
```

---

### Task 5: `useVoiceInput` engine selector

**Files:**
- Create: `src/components/main/useVoiceInput.ts`
- Create: `src/components/main/useVoiceInput.test.tsx`

**Interfaces:**
- Consumes: Task 4's hook + types; the untouched `useSpeechRecognition` (`{ listening, setListening, onInterim, onFinal, disabled }` → `{ supported, toggle, sendNow }`).
- Produces (Task 6 depends on these exact signatures):

```ts
export type SttEngine = 'scribe' | 'webspeech';
export interface UseVoiceInputOptions {
  listening: boolean;
  setListening: (v: boolean) => void;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  disabled?: boolean;
  /** Called when a turn starts (used to pause TTS playback — echo strategy). */
  onStartListening?: () => void;
}
export interface UseVoiceInputResult {
  supported: boolean;
  toggle: () => void;
  sendNow: () => void;
  /** Console-observable engine indicator; UI ignores it (spec § Fallback). */
  engine: SttEngine;
}
export function useVoiceInput(o: UseVoiceInputOptions): UseVoiceInputResult;
```

Fallback rules implemented here (spec table): latch kinds = `no_key | auth | quota | terms | resources` (session-scoped); `rate_limited | socket` = this turn only; error with partial text → leave text in composer, stop, **no** auto-restart; error before any speech → seamlessly start Web Speech for this turn.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/main/useVoiceInput.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useVoiceInput, type UseVoiceInputOptions, type UseVoiceInputResult } from './useVoiceInput';
import type { ScribeTurnError, UseScribeRecognitionOptions } from './useScribeRecognition';

// Mock BOTH engines — this file tests selection/fallback logic only.
const scribeToggle = vi.fn();
const scribeSendNow = vi.fn();
let scribeOpts: UseScribeRecognitionOptions | undefined;
vi.mock('./useScribeRecognition', () => ({
  useScribeRecognition: (opts: UseScribeRecognitionOptions) => {
    scribeOpts = opts;
    return { toggle: scribeToggle, sendNow: scribeSendNow };
  },
}));

const webToggle = vi.fn();
const webSendNow = vi.fn();
let webSupported = true;
vi.mock('./useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    supported: webSupported,
    toggle: webToggle,
    sendNow: webSendNow,
  }),
}));

function Harness({
  onResult,
  ...hookArgs
}: UseVoiceInputOptions & { onResult: (r: UseVoiceInputResult) => void }) {
  const result = useVoiceInput(hookArgs);
  React.useEffect(() => {
    onResult(result);
  });
  return null;
}

function setup(overrides: Partial<UseVoiceInputOptions> = {}) {
  const props: UseVoiceInputOptions = {
    listening: false,
    setListening: vi.fn(),
    onInterim: vi.fn(),
    onFinal: vi.fn(),
    disabled: false,
    onStartListening: vi.fn(),
    ...overrides,
  };
  let hook!: UseVoiceInputResult;
  const view = render(<Harness {...props} onResult={(r) => (hook = r)} />);
  return { props, hook: () => hook, view };
}

const scribeError = (kind: ScribeTurnError['kind'], partial = '') =>
  act(() => scribeOpts!.onTurnError({ kind, partial }));

describe('useVoiceInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scribeOpts = undefined;
    webSupported = true;
  });

  it('defaults to scribe: toggle routes there and fires onStartListening', () => {
    const { props, hook } = setup();
    expect(hook().engine).toBe('scribe');
    act(() => hook().toggle());
    expect(props.onStartListening).toHaveBeenCalledTimes(1);
    expect(scribeToggle).toHaveBeenCalledTimes(1);
    expect(webToggle).not.toHaveBeenCalled();
  });

  it('sendNow routes to the engine that started the turn', () => {
    const { hook } = setup();
    act(() => hook().toggle());
    act(() => hook().sendNow());
    expect(scribeSendNow).toHaveBeenCalledTimes(1);
    expect(webSendNow).not.toHaveBeenCalled();
  });

  it.each(['no_key', 'auth', 'quota', 'terms', 'resources'] as const)(
    'latches to webspeech for the session on %s',
    (kind) => {
      const { hook } = setup();
      act(() => hook().toggle());
      scribeError(kind);
      expect(hook().engine).toBe('webspeech');
      // scribe hook must now be inactive
      expect(scribeOpts!.active).toBe(false);
      // next turn goes to web speech
      act(() => hook().toggle());
      expect(webToggle).toHaveBeenCalled();
    },
  );

  it.each(['rate_limited', 'socket'] as const)(
    '%s before any speech falls back this turn only and retries scribe next turn',
    (kind) => {
      const { hook } = setup();
      act(() => hook().toggle());
      scribeError(kind);
      // seamless same-turn continuation on web speech
      expect(webToggle).toHaveBeenCalledTimes(1);
      expect(hook().engine).toBe('scribe'); // session engine unchanged
      expect(scribeOpts!.active).toBe(true);
      // a NEW turn tries scribe again
      act(() => hook().toggle()); // (stops the webspeech turn)
      act(() => hook().toggle());
      expect(scribeToggle).toHaveBeenCalledTimes(2);
    },
  );

  it('error with partial text stops the turn but does NOT auto-restart an engine', () => {
    const { props, hook } = setup();
    act(() => hook().toggle());
    scribeError('socket', 'half spoken sentence');
    expect(webToggle).not.toHaveBeenCalled();
    // the partial reached the composer earlier via onInterim — nothing to re-send;
    // the hook just must not clear or auto-send it
    expect(props.onFinal).not.toHaveBeenCalled();
    expect(hook().engine).toBe('scribe');
  });

  it('supported=false only when scribe is latched AND web speech is unsupported', () => {
    webSupported = false;
    const { hook } = setup();
    expect(hook().supported).toBe(true); // scribe still viable
    act(() => hook().toggle());
    scribeError('no_key');
    expect(hook().supported).toBe(false); // keyless + no web speech
  });

  it('onStartListening is not fired when stopping an active turn', () => {
    const { props, hook } = setup({ listening: true });
    act(() => hook().toggle()); // listening=true → this is a stop
    expect(props.onStartListening).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/components/main/useVoiceInput.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/components/main/useVoiceInput.ts
'use client';

import { useRef, useState } from 'react';
import { useSpeechRecognition } from './useSpeechRecognition';
import {
  useScribeRecognition,
  type ScribeFailureKind,
  type ScribeTurnError,
} from './useScribeRecognition';

export type SttEngine = 'scribe' | 'webspeech';

/** Failures no retry can fix — Scribe is off for the rest of the session. */
const LATCH_KINDS = new Set<ScribeFailureKind>([
  'no_key',
  'auth', // only reported after the forced-fresh-token retry also failed
  'quota',
  'terms',
  'resources',
]);

export interface UseVoiceInputOptions {
  listening: boolean;
  setListening: (v: boolean) => void;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  disabled?: boolean;
  /** Called when a turn starts (used to pause TTS playback — echo strategy). */
  onStartListening?: () => void;
}

export interface UseVoiceInputResult {
  supported: boolean;
  toggle: () => void;
  sendNow: () => void;
  /** Console-observable engine indicator; the UI ignores it. */
  engine: SttEngine;
}

/**
 * Voice-input seam: Scribe v2 Realtime primary, Web Speech silent fallback.
 * Exposes the exact contract VoiceDock/MicBtn consumed before the migration.
 */
export function useVoiceInput({
  listening,
  setListening,
  onInterim,
  onFinal,
  disabled = false,
  onStartListening,
}: UseVoiceInputOptions): UseVoiceInputResult {
  // Scribe permanently unusable this session (state, not ref: flips `engine`
  // and `supported` in render output).
  const [latched, setLatched] = useState(false);
  /** Engine handling the CURRENT turn (a turn that started on Scribe can
   * finish on Web Speech after a turn-scoped failure). */
  const turnEngineRef = useRef<SttEngine>('scribe');

  const scribeActive = !latched;
  const engine: SttEngine = scribeActive ? 'scribe' : 'webspeech';

  const webSpeech = useSpeechRecognition({
    listening,
    setListening,
    onInterim,
    onFinal,
    disabled,
  });

  function handleScribeTurnError(err: ScribeTurnError) {
    if (LATCH_KINDS.has(err.kind)) setLatched(true);
    if (err.partial.trim()) {
      // Words already spoken reached the composer via onInterim. Leave them
      // for manual send/edit — restarting an engine now would race the user.
      return;
    }
    // Nothing said yet — continue the turn seamlessly on Web Speech.
    if (webSpeech.supported) {
      turnEngineRef.current = 'webspeech';
      webSpeech.toggle();
    }
  }

  const scribe = useScribeRecognition({
    active: scribeActive,
    setListening,
    onInterim,
    onFinal,
    disabled,
    onTurnError: handleScribeTurnError,
  });

  function engineFor(target: SttEngine) {
    return target === 'scribe' ? scribe : webSpeech;
  }

  function toggle() {
    if (!listening) {
      onStartListening?.(); // pause TTS before the mic opens
      turnEngineRef.current = scribeActive ? 'scribe' : 'webspeech';
    }
    engineFor(turnEngineRef.current).toggle();
  }

  function sendNow() {
    engineFor(turnEngineRef.current).sendNow();
  }

  return {
    supported: scribeActive || webSpeech.supported,
    toggle,
    sendNow,
    engine,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- src/components/main/useVoiceInput.test.tsx`
Expected: 12 passed (7 blocks, two are `.each`).

- [ ] **Step 5: Commit**

```bash
git add src/components/main/useVoiceInput.ts src/components/main/useVoiceInput.test.tsx
git commit -m "feat(stt): voice-input seam with Scribe primary + Web Speech fallback"
```

---

### Task 6: Wire the UI — VoiceDock, MicBtn, AppShell

**Files:**
- Modify: `src/components/main/VoiceDock.tsx` (hook swap + `onStartListening` prop)
- Modify: `src/components/main/MicBtn.tsx` (hook swap)
- Modify: `src/components/AppShell.tsx` (pass `stopAudio`)
- Modify: `src/components/main/VoiceDock.test.tsx` (**mock wiring only** — see Step 6; zero assertion changes)
- Create: `src/components/main/VoiceDock.scribe.test.tsx`

**Interfaces:**
- Consumes: Task 5's `useVoiceInput`.
- Produces: `VoiceDockProps` gains `onStartListening?: () => void`. No other prop changes anywhere.

- [ ] **Step 1: Write the failing integration tests**

```tsx
// src/components/main/VoiceDock.scribe.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Scribe, RealtimeEvents, __lastConnection } from '@/test/fakeScribeClient';
import VoiceDock from './VoiceDock';

function Shell({ onStartListening }: { onStartListening: () => void }) {
  // Minimal stand-in for AppShell's listening state ownership.
  const [listening, setListening] = React.useState(false);
  return (
    <VoiceDock
      input=""
      setInput={vi.fn()}
      isLoading={false}
      listening={listening}
      setListening={setListening}
      onSend={vi.fn()}
      speaking={false}
      onStartListening={onStartListening}
    />
  );
}

describe('VoiceDock + Scribe integration', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ token: 'tok' }), { status: 200 }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      as any;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('tapping the orb pauses playback (onStartListening) and only shows listening after SESSION_STARTED', async () => {
    const onStartListening = vi.fn();
    render(<Shell onStartListening={onStartListening} />);
    const user = userEvent.setup();

    const orb = screen.getByRole('button', { name: 'Start voice input' });
    await user.click(orb);
    expect(onStartListening).toHaveBeenCalledTimes(1);

    // Socket not open yet → orb must still be idle.
    await vi.waitFor(() => expect(Scribe.connect).toHaveBeenCalled());
    expect(orb).toHaveAttribute('data-orb-state', 'idle');

    act(() =>
      __lastConnection().emit(RealtimeEvents.SESSION_STARTED, {
        message_type: 'session_started',
        session_id: 's',
        config: {},
      }),
    );
    expect(screen.getByRole('button', { name: 'Stop listening' })).toHaveAttribute(
      'data-orb-state',
      'listening',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/components/main/VoiceDock.scribe.test.tsx`
Expected: FAIL — `onStartListening` is not a valid VoiceDock prop / hook not wired.

- [ ] **Step 3: Modify VoiceDock**

In `src/components/main/VoiceDock.tsx`: replace the `useSpeechRecognition` import with `useVoiceInput`, add the prop, swap the hook call. The complete changed regions:

```tsx
import { useVoiceInput } from './useVoiceInput';
```

```tsx
interface VoiceDockProps {
  input: string;
  setInput: (v: string) => void;
  isLoading: boolean;
  listening: boolean;
  setListening: (v: boolean) => void;
  onSend: (override?: string) => void;
  speaking: boolean;
  /** Pause TTS playback when a listening turn starts (echo strategy). */
  onStartListening?: () => void;
  /** Session controls (Voice/Text switch + New chat) rendered below the orb. */
  controls?: React.ReactNode;
}
```

```tsx
export default function VoiceDock({
  setInput,
  isLoading,
  listening,
  setListening,
  onSend,
  speaking,
  onStartListening,
  controls,
}: VoiceDockProps) {
  const { supported, toggle, sendNow } = useVoiceInput({
    listening,
    setListening,
    onInterim: (t) => setInput(t),
    onFinal: (t) => {
      setInput(t);
      onSend(t);
    },
    disabled: isLoading,
    onStartListening,
  });
```

Everything below the hook call (orb state derivation, JSX) stays byte-identical.

- [ ] **Step 4: Modify MicBtn**

In `src/components/main/MicBtn.tsx`, the complete changed regions:

```tsx
import { useVoiceInput } from './useVoiceInput';
```

```tsx
  const { supported, toggle } = useVoiceInput({
    listening,
    setListening,
    onInterim,
    onFinal,
    disabled,
  });
```

(No `onStartListening` here: MicBtn lives in text mode, where answers aren't auto-played; the button/JSX below stays byte-identical.)

- [ ] **Step 5: Modify AppShell**

In `src/components/AppShell.tsx`, find the `<VoiceDock` JSX (the block containing `listening={isListening}`, around line 390) and add one prop:

```tsx
          onStartListening={stopAudio}
```

`stopAudio` (`AppShell.tsx:179`) already pauses the audio element and clears read-along state, and is idempotent when nothing is playing.

- [ ] **Step 6: Pin the legacy VoiceDock tests to the Web Speech engine (mock wiring only)**

Three tests in `VoiceDock.test.tsx` reach *through* the seam into engine behavior (sync `setListening(true)` on tap; tap-while-listening driving the injected `SpeechRecognition` instance; the unsupported-message test). Under Scribe-first routing they would exercise the wrong engine. Spec § success criterion 4 explicitly permits moving mock wiring: add this block near the top of `src/components/main/VoiceDock.test.tsx` (after the imports), and change **nothing else** in the file — every `describe`/`it`/assertion stays byte-identical:

```tsx
// Pin these legacy tests to the Web Speech engine: they assert engine-level
// behavior (sync setListening, injected SpeechRecognition instances, the
// unsupported message) that useVoiceInput now routes to Scribe first.
// Scribe-path integration lives in VoiceDock.scribe.test.tsx.
vi.mock('./useVoiceInput', async () => {
  const { useSpeechRecognition } = await import('./useSpeechRecognition');
  return {
    useVoiceInput: (opts: Parameters<typeof useSpeechRecognition>[0]) => ({
      ...useSpeechRecognition(opts),
      engine: 'webspeech' as const,
    }),
  };
});
```

(`useSpeechRecognition` ignores the extra `onStartListening` option — the object spread is contract-compatible: `{ supported, toggle, sendNow }`.)

- [ ] **Step 7: Run the new test, the regression suites, then everything**

Run: `npm run test:run -- src/components/main/VoiceDock.scribe.test.tsx`
Expected: PASS.
Run: `npm run test:run -- src/components/main/useSpeechRecognition.test.tsx src/components/main/VoiceDock.test.tsx src/components/main/InputDock.test.tsx src/components/main/Composer.test.tsx src/components/AppShell.test.tsx`
Expected: PASS. `useSpeechRecognition.test.tsx` must be byte-unchanged; `VoiceDock.test.tsx` changed only by the Step 6 mock block. If `Composer.test.tsx` or `InputDock.test.tsx` fail because they drive the mic button's engine behavior, apply the identical Step 6 mock block to the failing file (mock wiring only, zero assertion changes).
Run: `npm run test:run && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/components/main/VoiceDock.tsx src/components/main/MicBtn.tsx src/components/AppShell.tsx src/components/main/VoiceDock.test.tsx src/components/main/VoiceDock.scribe.test.tsx
git commit -m "feat(stt): switch VoiceDock/MicBtn to the Scribe-first voice seam"
```

---

### Task 7: Docs, full gate, push, PR

**Files:**
- Modify: `README.md` (voice input rows), `CLAUDE.md` (stack line)

- [ ] **Step 1: Update README**

In the architecture table (around lines 73–74), change the voice rows to:

```
| Voice output | ElevenLabs TTS — `eleven_turbo_v2`, timestamped `/with-timestamps` |
| Voice input  | ElevenLabs Scribe v2 Realtime (`scribe_v2_realtime`, WebSocket, server VAD) with browser Web Speech API fallback |
```

Around line 110, replace the "Voice input uses the browser-native Web Speech API" sentence with:

```
Voice **input** uses ElevenLabs Scribe v2 Realtime (needs `ELEVENLABS_API_KEY`; tokens
are minted server-side at `/api/stt-token`). Without a key it falls back to the
browser-native Web Speech API (Chrome/Edge).
```

- [ ] **Step 2: Update CLAUDE.md**

Change the stack bullet mentioning ElevenLabs to:

```
- **@anthropic-ai/sdk** (explanations), **ElevenLabs** (TTS + timestamps; STT via Scribe v2 Realtime with Web Speech fallback), **Voyage AI** (embeddings for RAG retrieval → pgvector on Supabase; optional, off without `VOYAGE_API_KEY`)
```

- [ ] **Step 3: Full quality gate**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green. Fix anything that isn't before proceeding.

- [ ] **Step 4: Commit, push, open the PR** (workspace rule: PR opens automatically once verification passes — do not wait to be asked)

```bash
git add README.md CLAUDE.md
git commit -m "docs(stt): Scribe v2 Realtime migration"
git push -u origin feat/scribe-stt-migration
gh pr create --base main --title "Migrate STT to ElevenLabs Scribe v2 Realtime (Web Speech fallback)" --body "$(cat <<'EOF'
## Summary
- Voice input now uses ElevenLabs Scribe v2 Realtime (per-turn WebSocket, server VAD at 2.5s) instead of the browser Web Speech API — targeting much better recognition of French-accented English
- Web Speech kept as a silent fallback (keyless local dev, quota/auth failures); token minted server-side at /api/stt-token
- Starting to listen pauses TTS playback (echo strategy); orb animates only once the session is live
- Deletes the app-side silence timer and the Android transcript-dedup workaround (issue #30) — both were Web Speech quirks

Spec: spec/scribe-stt-migration/spec.md

## Test plan
- [ ] npm run lint && npm run typecheck && npm run test:run
- [ ] Manual: parity checklist in spec § Parity checklist on the preview deploy
- [ ] Manual: accent measurement protocol in spec § Testing (Scribe vs fallback)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Post-merge manual verification (on the preview/prod deploy — not automatable)

1. **Parity checklist** — every box in spec § Parity checklist, on desktop Chrome + one mobile browser.
2. **Accent measurement** — spec § Testing manual protocol: ~15 fixed utterances, Scribe vs Web Speech, hand-counted word errors. This is the success criterion for the whole migration.
3. **Open item probes** (spec § Open items): tap-and-talk immediately — is the first word captured? Does `connection.commit()` under VAD return a committed transcript quickly (if yes, switch `sendNow()` to commit-then-close in a follow-up)?
4. If domain terms still mis-transcribe → activate the `STT_KEYTERMS` follow-up (spec § Deferred).
