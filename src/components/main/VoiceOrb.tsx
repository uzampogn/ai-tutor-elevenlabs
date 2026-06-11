'use client';

import { useEffect, useRef, useState } from 'react';
import { MicIcon } from '../icons';

interface VoiceOrbProps {
  listening: boolean;
  setListening: (v: boolean) => void;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  disabled?: boolean;
  speaking?: boolean;
}

export default function VoiceOrb({
  listening,
  setListening,
  onInterim,
  onFinal,
  disabled = false,
  speaking = false,
}: VoiceOrbProps) {
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const cb = useRef({ onInterim, onFinal, setListening });
  cb.current = { onInterim, onFinal, setListening };

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
  const cls = ['orb', listening && 'is-listening', speaking && 'is-speaking']
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={cls}
      onClick={toggle}
      disabled={isDisabled}
      aria-label={label}
      aria-pressed={listening}
      title={label}
    >
      <span className="orb-ring orb-ring--outer" />
      <span className="orb-ring orb-ring--mid" />
      <span className="orb-ring orb-ring--arc" />
      <span className="orb-ring orb-ring--dash" />
      <span className="orb-core">
        <MicIcon size={14} />
      </span>
    </button>
  );
}
