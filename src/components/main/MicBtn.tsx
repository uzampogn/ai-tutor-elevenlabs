'use client';

import { MicIcon } from '../icons';
import { useVoiceInput } from './useVoiceInput';

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
  const { supported, toggle } = useVoiceInput({
    listening,
    setListening,
    onInterim,
    onFinal,
    disabled,
  });

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
