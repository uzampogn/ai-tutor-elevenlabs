'use client';

import Orb, { type OrbState } from './Orb';
import { useSpeechRecognition } from './useSpeechRecognition';

interface VoiceDockProps {
  input: string;
  setInput: (v: string) => void;
  isLoading: boolean;
  listening: boolean;
  setListening: (v: boolean) => void;
  onSend: (override?: string) => void;
  speaking: boolean;
  /** Session controls (Voice/Text switch + New chat) rendered below the orb. */
  controls?: React.ReactNode;
}

export default function VoiceDock({
  setInput,
  isLoading,
  listening,
  setListening,
  onSend,
  speaking,
  controls,
}: VoiceDockProps) {
  const { supported, toggle } = useSpeechRecognition({
    listening,
    setListening,
    onInterim: (t) => setInput(t),
    onFinal: (t) => {
      setInput(t);
      onSend(t);
    },
    disabled: isLoading,
  });

  // Derive orb state with precedence: speaking > thinking > listening > idle.
  // The orb's animation states are now the only voice cue — the orb's
  // aria-label (set per state in Orb.tsx) covers screen readers.
  const orbState: OrbState = speaking
    ? 'speaking'
    : isLoading
      ? 'thinking'
      : listening
        ? 'listening'
        : 'idle';

  return (
    <div className="voice-dock">
      <Orb state={orbState} onClick={toggle} disabled={isLoading || !supported} />

      {controls}

      {!supported && (
        <p className="voice-dock-unsupported" role="status">
          Voice input isn&apos;t available in this browser. Switch to Text mode to continue.
        </p>
      )}
    </div>
  );
}
