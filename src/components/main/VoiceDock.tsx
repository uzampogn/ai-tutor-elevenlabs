'use client';

import { useState } from 'react';
import Orb, { type OrbState } from './Orb';
import Waveform from '../Waveform';
import { useSpeechRecognition } from './useSpeechRecognition';

interface VoiceDockProps {
  input: string;
  setInput: (v: string) => void;
  isLoading: boolean;
  listening: boolean;
  setListening: (v: boolean) => void;
  onSend: (override?: string) => void;
  speaking: boolean;
  /** Slot for the mode-switch element rendered by InputDock. */
  modeSwitch?: React.ReactNode;
}

export default function VoiceDock({
  setInput,
  isLoading,
  listening,
  setListening,
  onSend,
  speaking,
  modeSwitch,
}: VoiceDockProps) {
  const [interimText, setInterimText] = useState('');

  const { supported, toggle } = useSpeechRecognition({
    listening,
    setListening,
    onInterim: (t) => {
      setInterimText(t);
      setInput(t);
    },
    onFinal: (t) => {
      setInterimText('');
      setInput(t);
      onSend(t);
    },
    disabled: isLoading,
  });

  // Derive orb state with precedence: speaking > thinking > listening > idle
  const orbState: OrbState = speaking
    ? 'speaking'
    : isLoading
      ? 'thinking'
      : listening
        ? 'listening'
        : 'idle';

  const STATUS_TEXT: Record<OrbState, string> = {
    idle: 'Tap to speak',
    listening: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
  };

  const readoutText = listening && interimText ? interimText : STATUS_TEXT[orbState];

  return (
    <div className="voice-dock">
      {modeSwitch}

      <Orb
        state={orbState}
        onClick={toggle}
        disabled={isLoading || !supported}
      />

      <div className="voice-dock-readout" aria-live="polite" aria-atomic="true">
        <Waveform active={listening || speaking} bars={12} />
        <span className="voice-dock-readout-text">{readoutText}</span>
      </div>

      {!supported && (
        <p className="voice-dock-unsupported" role="status">
          Voice input isn&apos;t available in this browser. Switch to Text mode to continue.
        </p>
      )}
    </div>
  );
}
