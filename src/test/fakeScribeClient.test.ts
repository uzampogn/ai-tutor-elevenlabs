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
