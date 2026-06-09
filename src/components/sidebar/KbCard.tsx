// One knowledge-base article card. Clicking opens the reader drawer.

import { forwardRef } from 'react';
import type { Article } from '@/lib/types';
import { categoryFor, formatShortDate } from './kb';

interface KbCardProps {
  article: Article;
  index: number;
  active: boolean;
  onOpen: () => void;
}

const KbCard = forwardRef<HTMLButtonElement, KbCardProps>(function KbCard(
  { article, index, active, onOpen },
  ref,
) {
  const cat = categoryFor(index);
  return (
    <button
      ref={ref}
      type="button"
      className={`kb-card${active ? ' is-active' : ''}`}
      onClick={onOpen}
    >
      <div className="kb-card-top">
        <span className="kb-cat" style={{ ['--c' as string]: cat.color } as React.CSSProperties}>
          <span className="kb-cat-dot" />
          {cat.name}
        </span>
        <span className="kb-date">{formatShortDate(article.pubDate)}</span>
      </div>
      <div className="kb-card-title">{article.title}</div>
    </button>
  );
});

export default KbCard;
