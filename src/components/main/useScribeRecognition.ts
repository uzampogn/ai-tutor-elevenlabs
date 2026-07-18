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
      // Empty commit (server VAD committed a silent/noise turn): end the turn
      // silently, nothing sent. This is a deliberate divergence from the old
      // engine, whose silence timer firing on an empty transcript kept listening
      // (see useSpeechRecognition commit(cancelIfEmpty=false)); here server-side
      // VAD owns the turn boundary, so an empty commit ends it.
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
