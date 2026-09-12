'use client';

// The orb: the one object that carries the whole pinned gradient, with the
// single sparkle at its warm core. Four states, each distinct in a still frame
// (the CSS poses hold under reduced motion; the breathing is gated).

import Mark from '../Mark';

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
      <Mark className="orb-spark" />
    </button>
  );
}
