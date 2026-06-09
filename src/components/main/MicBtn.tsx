'use client';

import { useEffect, useRef, useState } from 'react';
import { MicIcon } from '../icons';

interface MicBtnProps {
  /** Listening state owned by the shell (also drives the shared waveform). */
  listening: boolean;
  setListening: (v: boolean) => void;
  /** Interim transcript — write into the composer as the user speaks. */
  onInterim: (text: string) => void;
  /** Final transcript — set the composer value (and auto-send upstream). */
  onFinal: (text: string) => void;
  /** Disable the mic while a send is in progress. */
  disabled?: boolean;
}

export default function MicBtn({
  listening,
  setListening,
  onInterim,
  onFinal,
  disabled = false,
}: MicBtnProps) {
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

  const isDisabled = disabled || !supported;
  const label = supported ? 'Voice input' : 'Voice input is not available in this browser';

  return (
    <button
      type="button"
      className="mic-btn"
      onClick={toggle}
      disabled={isDisabled}
      aria-label={label}
      aria-pressed={listening}
      title={label}
    >
      <MicIcon />
    </button>
  );
}
