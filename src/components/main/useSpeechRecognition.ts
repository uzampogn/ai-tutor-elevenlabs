'use client';

import { useEffect, useRef, useState } from 'react';

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
    recognition.continuous = false;

    recognition.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) final += transcript;
        else interim += transcript;
      }
      if (final) cb.current.onFinal(final.trim());
      else if (interim) cb.current.onInterim(interim);
    };

    recognition.onend = () => cb.current.setListening(false);
    recognition.onerror = () => cb.current.setListening(false);

    recognitionRef.current = recognition;

    return () => {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  // Stop listening if the shell disables the mic (e.g. a send started).
  useEffect(() => {
    if (disabled && listening) {
      recognitionRef.current?.abort();
      setListening(false);
    }
  }, [disabled, listening, setListening]);

  function toggle() {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (listening) {
      recognition.stop();
      setListening(false);
    } else {
      try {
        recognition.start();
        setListening(true);
      } catch {
        // start() throws if a session is already active; ignore.
      }
    }
  }

  return { supported, toggle };
}
