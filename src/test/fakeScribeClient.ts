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
