// src/components/main/useVoiceInput.ts
'use client';

import { useEffect, useRef, useState } from 'react';
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

  // Latest webSpeech result + listening value, held in refs so a deferred
  // fallback start reads the FRESH `useSpeechRecognition.toggle` closure — the
  // one whose captured `listening` reflects the post-teardown re-render, not the
  // stale render in which the error fired. See handleScribeTurnError.
  const webSpeechRef = useRef(webSpeech);
  webSpeechRef.current = webSpeech;
  const listeningRef = useRef(listening);
  listeningRef.current = listening;

  /** Pending macrotask that starts Web Speech to continue an errored turn. */
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function clearFallbackStart() {
    if (fallbackTimerRef.current !== null) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }

  function handleScribeTurnError(err: ScribeTurnError) {
    if (LATCH_KINDS.has(err.kind)) setLatched(true);
    if (err.partial.trim()) {
      // Words already spoken reached the composer via onInterim. Leave them
      // for manual send/edit — restarting an engine now would race the user.
      return;
    }
    if (!webSpeech.supported) return;
    // Nothing said yet — continue the turn seamlessly on Web Speech.
    //
    // Scribe's teardown calls setListening(false) and then fires this callback
    // synchronously in the SAME tick, so React 18 has not yet flushed that
    // re-render: useSpeechRecognition.toggle()'s closure still sees the
    // SESSION_STARTED `listening === true` and would stop() instead of start().
    // Defer the start one macrotask so the batched re-render commits first; the
    // fresh closure (webSpeechRef) then sees `listening === false` and starts.
    turnEngineRef.current = 'webspeech';
    clearFallbackStart(); // never stack two pending starts
    fallbackTimerRef.current = setTimeout(() => {
      fallbackTimerRef.current = null;
      // Bail on any ghost start: a new turn reset the engine, Web Speech is
      // already capturing this turn, or the component unmounted (cleared below).
      if (turnEngineRef.current !== 'webspeech') return;
      if (listeningRef.current) return;
      webSpeechRef.current.toggle();
    }, 0);
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
    // Any explicit toggle supersedes a pending fallback start (new turn or a
    // deliberate stop) — cancel it so the mic never opens behind the user.
    clearFallbackStart();
    if (!listening) {
      onStartListening?.(); // pause TTS before the mic opens
      turnEngineRef.current = scribeActive ? 'scribe' : 'webspeech';
    }
    engineFor(turnEngineRef.current).toggle();
  }

  function sendNow() {
    engineFor(turnEngineRef.current).sendNow();
  }

  // Unmount: drop any pending fallback start so it can't fire on a dead tree.
  useEffect(() => () => clearFallbackStart(), []);

  return {
    supported: scribeActive || webSpeech.supported,
    toggle,
    sendNow,
    engine,
  };
}
