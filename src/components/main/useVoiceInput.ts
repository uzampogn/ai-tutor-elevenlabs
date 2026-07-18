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
