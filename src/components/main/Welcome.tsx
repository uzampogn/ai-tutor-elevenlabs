// The welcome: a greeting above the orb's centre-stage slot, the quick
// questions as ruled text rows beneath. The orb itself is the free body in
// OrbStage; `[data-orb-anchor="centre"]` is where it measures its centre pose.

import { SUGGESTED } from '@/lib/types';

export default function Welcome({ onAsk }: { onAsk: (question: string) => void }) {
  return (
    <div className="welcome">
      <div className="welcome-greeting">
        <h1 className="welcome-title">What do you want to understand today?</h1>
        <p className="welcome-lede">
          Tap the orb and ask. I answer from the latest posts, read it aloud, and follow along.
        </p>
      </div>
      <div className="welcome-slot" data-orb-anchor="centre" aria-hidden="true" />
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
