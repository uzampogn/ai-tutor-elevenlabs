'use client';

import { useEffect, useRef, useState } from 'react';

/** Silence (no new speech result) after which we auto-send. Tunable. */
const SILENCE_TIMEOUT_MS = 2500;

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

  // Accumulated transcript + silence-timer state for the current turn.
  const committedRef = useRef('');
  const interimRef = useRef('');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether we *intend* to be listening — lets onend tell a deliberate stop
  // (commit / cancel / disable) apart from the browser ending the session
  // early, so we can restart and not silently cut the user off.
  const shouldListenRef = useRef(false);

  // Imperative API built once inside the mount effect; toggle() calls through it.
  const apiRef = useRef<{ start: () => void; stop: () => void } | null>(null);

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

    function commit() {
      clearSilenceTimer();
      const text = (committedRef.current + interimRef.current).trim();
      if (!text) return; // nothing said yet — keep listening; next result re-arms
      committedRef.current = '';
      interimRef.current = '';
      stop();
      cb.current.onFinal(text);
    }

    function armSilenceTimer() {
      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(commit, SILENCE_TIMEOUT_MS);
    }

    function start() {
      committedRef.current = '';
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
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) committedRef.current += transcript;
        else interim += transcript;
      }
      interimRef.current = interim;
      const running = (committedRef.current + interim).trim();
      if (running) cb.current.onInterim(running);
      armSilenceTimer();
    };

    recognition.onend = () => {
      // Continuous mode can still end (network / browser timeout). If we still
      // intend to listen, restart so the user isn't silently cut off.
      if (shouldListenRef.current) {
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
    apiRef.current = { start, stop };

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

  return { supported, toggle };
}
