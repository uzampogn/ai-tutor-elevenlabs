// Empty-state hero with serif title, lede, and a 2x2 grid of the
// suggested questions. Clicking a chip sends that question.

import { SUGGESTED } from '@/lib/types';
import { ArrowIcon } from '../icons';

export default function Welcome({ onAsk }: { onAsk: (question: string) => void }) {
  return (
    <div className="welcome">
      <h2 className="welcome-title">
        Understand the latest in AI, <em>explained clearly</em>.
      </h2>
      <p className="welcome-lede">
        Ask anything about Anthropic&apos;s recent research and product news. I&apos;ll teach you the
        key concepts and the business impact, grounded in the latest articles.
      </p>
      <div className="welcome-grid">
        {SUGGESTED.map((q) => (
          <button key={q} type="button" className="welcome-chip" onClick={() => onAsk(q)}>
            <span className="wc-q">{q}</span>
            <span className="wc-arrow" aria-hidden="true">
              <ArrowIcon />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
