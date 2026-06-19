'use client';

import { useEffect, useRef, useState } from 'react';

/** Silence (no new speech result) after which we auto-send. Tunable. */
const SILENCE_TIMEOUT_MS = 2500;

/**
 * Merge a freshly-emitted transcript chunk into the running text for one stream
 * (final or interim). The Web Speech API is not consistent across engines:
 *   - Desktop Chrome emits each result as a *distinct* segment → append.
 *   - Android Chrome (issue #30) appends many final results in one cumulative
 *     `event.results`, each a *growing prefix* of the whole phrase
 *     ("tell" → "tell me" → "tell me everything" …). Blind concatenation stacks
 *     these into "telltell metell me…".
 * Collapsing on the prefix relationship handles both: when one string is a
 * prefix of the other we keep the longer (the latest snapshot); otherwise the
 * chunk is genuinely new and is appended — byte-identical to the old
 * concatenation for a well-behaved desktop engine.
 */
function mergeTranscript(acc: string, next: string): string {
  if (!next) return acc;
  if (!acc) return next;
  if (next.startsWith(acc)) return next; // cumulative snapshot grew (covers next === acc)
  if (acc.startsWith(next)) return acc; // a shorter/older snapshot re-emitted
  return acc + next; // distinct segment → append
}

export interface UseSpeechRecognitionOptions {
  listening: boolean;
  setListening: (v: boolean) => void;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  disabled?: boolean;
}

export interface UseSpeechRecognitionResult {
  supported: boolean;
  toggle: () => void;
  sendNow: () => void;
}

export function useSpeechRecognition({
  listening,
  setListening,
  onInterim,
  onFinal,
  disabled = false,
}: UseSpeechRecognitionOptions): UseSpeechRecognitionResult {
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Transcript assembly for the current turn. The live transcript is always
  // priorSessionsRef + sessionFinalRef + interimRef.
  //   priorSessionsRef — final text from engine sessions that already ended and
  //     were auto-restarted (continuous mode can end on mobile mid-turn).
  //   sessionFinalRef  — the CURRENT session's final text, rebuilt from the
  //     cumulative event.results each onresult (never accumulated with +=, so a
  //     re-emitted growing result[0] replaces instead of stacking).
  const priorSessionsRef = useRef('');
  const sessionFinalRef = useRef('');
  const interimRef = useRef('');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether we *intend* to be listening — lets onend tell a deliberate stop
  // (commit / cancel / disable) apart from the browser ending the session
  // early, so we can restart and not silently cut the user off.
  const shouldListenRef = useRef(false);

  // Imperative API built once inside the mount effect; toggle() calls through it.
  const apiRef = useRef<{ start: () => void; stop: () => void; sendNow: () => void } | null>(null);

  // Latest callbacks held in a ref so the recognition instance is built once
  // but its handlers always call current props.
  const cb = useRef({ onInterim, onFinal, setListening });
  cb.current = { onInterim, onFinal, setListening };

  // Feature-detect and construct the recognition instance once on mount.
  useEffect(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      return;
    }

    const recognition = new Ctor();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;

    function clearSilenceTimer() {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    }

    function stop() {
      shouldListenRef.current = false;
      clearSilenceTimer();
      recognition.stop();
      cb.current.setListening(false);
    }

    function commit(cancelIfEmpty: boolean) {
      clearSilenceTimer();
      const text = (priorSessionsRef.current + sessionFinalRef.current + interimRef.current).trim();
      if (!text) {
        // Timer fire with nothing said: keep listening (next result re-arms).
        // Explicit tap (cancelIfEmpty): treat as cancel — stop listening.
        if (cancelIfEmpty) stop();
        return;
      }
      priorSessionsRef.current = '';
      sessionFinalRef.current = '';
      interimRef.current = '';
      stop();
      cb.current.onFinal(text);
    }

    function armSilenceTimer() {
      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(() => commit(false), SILENCE_TIMEOUT_MS);
    }

    function start() {
      priorSessionsRef.current = '';
      sessionFinalRef.current = '';
      interimRef.current = '';
      shouldListenRef.current = true;
      try {
        recognition.start();
        cb.current.setListening(true);
      } catch {
        // start() throws if a session is already active; ignore.
      }
    }

    recognition.onresult = (event) => {
      // event.results is the cumulative list for THIS session. Rebuild the final
      // and interim text from index 0 every event (do not accumulate across
      // events), merging each result with mergeTranscript instead of blind
      // concatenation. Android Chrome (issue #30) appends many final results
      // that are growing prefixes of the same phrase; concatenating them stacks
      // into "telltell metell me…", whereas the merge keeps only the latest.
      let sessionFinal = '';
      let interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) sessionFinal = mergeTranscript(sessionFinal, transcript);
        else interim = mergeTranscript(interim, transcript);
      }
      sessionFinalRef.current = sessionFinal;
      interimRef.current = interim;
      const running = (priorSessionsRef.current + sessionFinal + interim).trim();
      if (running) cb.current.onInterim(running);
      armSilenceTimer();
    };

    recognition.onend = () => {
      // Continuous mode can still end (network / browser timeout). If we still
      // intend to listen, fold the just-ended session's final text into the
      // carry-over accumulator — so the restarted session (whose event.results
      // resets to empty and is rebuilt from index 0) neither drops it nor
      // double-counts it — then restart so the user isn't silently cut off.
      if (shouldListenRef.current) {
        priorSessionsRef.current += sessionFinalRef.current;
        sessionFinalRef.current = '';
        try {
          recognition.start();
        } catch {
          // start() throws if a session is already active; ignore.
        }
      } else {
        cb.current.setListening(false);
      }
    };

    recognition.onerror = () => {
      shouldListenRef.current = false;
      clearSilenceTimer();
      cb.current.setListening(false);
    };

    recognitionRef.current = recognition;
    apiRef.current = { start, stop, sendNow: () => commit(true) };

    return () => {
      clearSilenceTimer();
      shouldListenRef.current = false;
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.abort();
      recognitionRef.current = null;
      apiRef.current = null;
    };
  }, []);

  // Stop listening if the shell disables the mic (e.g. a send started).
  useEffect(() => {
    if (disabled && listening) {
      shouldListenRef.current = false;
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      recognitionRef.current?.abort();
      setListening(false);
    }
  }, [disabled, listening, setListening]);

  function toggle() {
    if (!apiRef.current) return;
    if (listening) apiRef.current.stop();
    else apiRef.current.start();
  }

  function sendNow() {
    apiRef.current?.sendNow();
  }

  return { supported, toggle, sendNow };
}
