'use client';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface OrbProps {
  state: OrbState;
  onClick: () => void;
  disabled?: boolean;
}

const ARIA_LABELS: Record<OrbState, string> = {
  idle: 'Start voice input',
  listening: 'Stop listening',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
};

export default function Orb({ state, onClick, disabled }: OrbProps) {
  return (
    <button
      type="button"
      className="orb"
      data-orb-state={state}
      onClick={onClick}
      disabled={disabled}
      aria-label={ARIA_LABELS[state]}
      aria-pressed={state === 'listening'}
    >
      <span className="orb-bloom" aria-hidden="true" />
      <span className="orb-core" aria-hidden="true" />
      <span className="orb-ring" aria-hidden="true" />
      <span className="orb-ring" aria-hidden="true" />
    </button>
  );
}
