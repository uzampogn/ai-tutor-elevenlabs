'use client';

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
    <a
      className="source-chip score-original"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <LinkIcon />
      <span className="source-chip-title">Read the original article</span>
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
        <p className="drawer-summary">{description}</p>
        <OriginalLink url={url} />
      </div>
    );
  }

  return (
    <div className="score-card">
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

      {/* Reuses the chat Impact-card styling (.impact) with a card-appropriate label. */}
      <div className="impact">
        <div className="impact-label">
          <span aria-hidden="true">💼</span> Why it matters
        </div>
        <p className="impact-text">
          <InlineMarkdown text={digest.whyItMatters} />
        </p>
      </div>

      <div className="drawer-tags">
        {digest.tags.map((t) => (
          <span key={t} className="tag">
            {t}
          </span>
        ))}
      </div>

      <div className="score-asks">
        <div className="score-asks-label">Ask the tutor</div>
        {digest.questions.map((q) => (
          <button key={q} type="button" className="score-ask" onClick={() => onAsk(q)}>
            {q}
          </button>
        ))}
      </div>

      <OriginalLink url={url} />
    </div>
  );
}
