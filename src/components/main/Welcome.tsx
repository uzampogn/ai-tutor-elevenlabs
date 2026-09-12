// The welcome: a greeting above the orb's centre-stage slot, the quick
// questions as ruled text rows beneath. The orb itself is the free body in
// OrbStage; `[data-orb-anchor="centre"]` is where it measures its centre pose.
// When the orb is elsewhere (Text mode chosen on the welcome) the slot closes.

import { SUGGESTED } from '@/lib/types';

interface WelcomeProps {
  onAsk: (question: string) => void;
  /** False when the orb has left centre stage; the slot then takes no room. */
  orbHere?: boolean;
}

export default function Welcome({ onAsk, orbHere = true }: WelcomeProps) {
  return (
    <div className="welcome">
      <div className="welcome-greeting">
        <h1 className="welcome-title">What do you want to understand today?</h1>
        <p className="welcome-lede">
          Tap the orb and ask. I answer from the latest posts, read it aloud, and follow along.
        </p>
      </div>
      <div className={`welcome-slot${orbHere ? '' : ' is-empty'}`} data-orb-anchor="centre" aria-hidden="true" />
      <ul className="welcome-asks">
        {SUGGESTED.map((q) => (
          <li key={q}>
            <button type="button" className="welcome-ask" onClick={() => onAsk(q)}>
              {q}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
