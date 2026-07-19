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

let webOpts: { listening: boolean; setListening: (v: boolean) => void } | undefined;
// Mocked Web Speech mirrors the real hook: toggle() opens/closes the mic, which
// flips `listening` via the setListening it was handed. Scribe's mock leaves
// `listening` untouched (turn-scoped failures happen before SESSION_STARTED).
const webToggle = vi.fn(() => webOpts!.setListening(!webOpts!.listening));
const webSendNow = vi.fn();
let webSupported = true;
vi.mock('./useSpeechRecognition', () => ({
  useSpeechRecognition: (opts: { listening: boolean; setListening: (v: boolean) => void }) => {
    webOpts = opts;
    return {
      supported: webSupported,
      toggle: webToggle,
      sendNow: webSendNow,
    };
  },
}));

function Harness({
  onResult,
  listening: initialListening,
  ...hookArgs
}: UseVoiceInputOptions & { onResult: (r: UseVoiceInputResult) => void }) {
  // Real, reactive listening state: the seam reads it to tell start from stop,
  // and the Web Speech mock flips it via setListening (as the real hook does).
  const [listening, setListening] = React.useState(initialListening);
  const result = useVoiceInput({ ...hookArgs, listening, setListening });
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
      vi.useFakeTimers();
      try {
        const { hook } = setup();
        act(() => hook().toggle());
        scribeError(kind);
        // The fallback start is deferred one macrotask (so React can flush the
        // batched setListening(false) first); flush it to observe the handover.
        act(() => vi.runAllTimers());
        // seamless same-turn continuation on web speech
        expect(webToggle).toHaveBeenCalledTimes(1);
        expect(hook().engine).toBe('scribe'); // session engine unchanged
        expect(scribeOpts!.active).toBe(true);
        // a NEW turn tries scribe again
        act(() => hook().toggle()); // (stops the webspeech turn)
        act(() => hook().toggle());
        expect(scribeToggle).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('starts Web Speech after a turn-scoped error that already opened the Scribe session', () => {
    // Regression: a turn that reached SESSION_STARTED (listening=true) then hit a
    // turn-scoped failure must still hand off to Web Speech. The naive
    // synchronous webSpeech.toggle() saw the stale listening=true and stopped
    // instead of starting, silently losing the turn.
    vi.useFakeTimers();
    try {
      const { hook } = setup();
      act(() => hook().toggle()); // start on scribe
      // SESSION_STARTED: Scribe flips listening true (its own render commits).
      act(() => scribeOpts!.setListening(true));
      // Same tick as the failure: teardown sets listening false (batched, not
      // yet re-rendered) and onTurnError fires synchronously with the stale
      // listening=true render still in scope.
      act(() => {
        scribeOpts!.setListening(false);
        scribeOpts!.onTurnError({ kind: 'socket', partial: '' });
      });
      // Deferred, so nothing has toggled yet.
      expect(webToggle).not.toHaveBeenCalled();
      act(() => vi.runAllTimers()); // React has flushed listening=false; now start
      expect(webToggle).toHaveBeenCalledTimes(1);
      expect(webOpts!.listening).toBe(true); // Web Speech actually took over
    } finally {
      vi.useRealTimers();
    }
  });

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
