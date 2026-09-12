'use client';

// The score card: the digest as stacked blocks in the article drawer —
// What it says (tl;dr + takeaways + tags) · Why it matters · Ask the tutor
// (questions as ruled rows) · Read the original. Loading draws a skeleton in
// place; no digest falls back to the excerpt and the original link.

import type { ArticleDigest } from '@/lib/types';
import InlineMarkdown from './InlineMarkdown';
import { LinkIcon } from './icons';

interface ScoreCardProps {
  digest: ArticleDigest | null;
  digestsLoaded: boolean;
  description: string; // fallback excerpt when there's no digest
  url: string; // original article link
  onAsk: (question: string) => void;
}

function OriginalLink({ url }: { url: string }) {
  return (
    <a className="score-original" href={url} target="_blank" rel="noopener noreferrer">
      <LinkIcon />
      <span>Read the original article</span>
    </a>
  );
}

function ScoreCardSkeleton() {
  return (
    <div className="score-card score-card-loading" aria-hidden="true">
      <div className="score-skel score-skel-line" />
      <div className="score-skel score-skel-line short" />
      <div className="score-skel score-skel-block" />
      <div className="score-skel score-skel-tags" />
    </div>
  );
}

export default function ScoreCard({ digest, digestsLoaded, description, url, onAsk }: ScoreCardProps) {
  if (!digestsLoaded) return <ScoreCardSkeleton />;

  if (!digest) {
    return (
      <div className="score-card">
        <section className="dblock">
          <h3 className="dblock-title">What it says</h3>
          <p className="drawer-summary">{description}</p>
        </section>
        <section className="dblock">
          <OriginalLink url={url} />
        </section>
      </div>
    );
  }

  return (
    <div className="score-card">
      <section className="dblock">
        <h3 className="dblock-title">What it says</h3>
        <p className="score-tldr">
          <InlineMarkdown text={digest.tldr} />
        </p>
        <ul className="score-takeaways">
          {digest.takeaways.map((t, i) => (
            <li key={i}>
              <InlineMarkdown text={t} />
            </li>
          ))}
        </ul>
        {digest.tags.length > 0 && (
          <p className="drawer-tags">
            {digest.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </p>
        )}
      </section>

      <section className="dblock">
        <h3 className="dblock-title">Why it matters</h3>
        <p className="score-why">
          <InlineMarkdown text={digest.whyItMatters} />
        </p>
      </section>

      {digest.questions.length > 0 && (
        <section className="dblock">
          <h3 className="dblock-title">Ask the tutor</h3>
          <ul className="score-asks">
            {digest.questions.map((q) => (
              <li key={q}>
                <button type="button" className="score-ask" onClick={() => onAsk(q)}>
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="dblock">
        <OriginalLink url={url} />
      </section>
    </div>
  );
}
