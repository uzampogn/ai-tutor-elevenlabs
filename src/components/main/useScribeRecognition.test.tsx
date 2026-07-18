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
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ token: 'tok' }), { status: 200 })),
      ) as any;
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
      .mockImplementation(() => Promise.resolve(new Response('', { status: 503 }))) as any;
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
