'use client';

import Orb, { type OrbState } from './Orb';
import { useVoiceInput } from './useVoiceInput';

interface VoiceDockProps {
  input: string;
  setInput: (v: string) => void;
  isLoading: boolean;
  listening: boolean;
  setListening: (v: boolean) => void;
  onSend: (override?: string) => void;
  speaking: boolean;
  /** Pause TTS playback when a listening turn starts (echo strategy). */
  onStartListening?: () => void;
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
  onStartListening,
  controls,
}: VoiceDockProps) {
  const { supported, toggle, sendNow } = useVoiceInput({
    listening,
    setListening,
    onInterim: (t) => setInput(t),
    onFinal: (t) => {
      setInput(t);
      onSend(t);
    },
    disabled: isLoading,
    onStartListening,
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
      {/* Tap while listening = send now; tap while idle = start listening. */}
      <Orb
        state={orbState}
        onClick={listening ? sendNow : toggle}
        disabled={isLoading || !supported}
      />

      {controls}

      {!supported && (
        <p className="voice-dock-unsupported" role="status">
          Voice input isn&apos;t available in this browser. Switch to Text mode to continue.
        </p>
      )}
    </div>
  );
}
