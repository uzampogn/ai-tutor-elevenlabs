// One knowledge-base row: date and category on the meta line, title beneath.
// Clicking opens the article drawer.

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
  return (
    <button
      ref={ref}
      type="button"
      className={`kb-row${active ? ' is-active' : ''}`}
      onClick={onOpen}
      aria-current={active ? 'true' : undefined}
    >
      <span className="kb-row-meta">
        <span>{formatShortDate(article.pubDate)}</span>
        <span aria-hidden="true">·</span>
        <span>{categoryFor(index)}</span>
      </span>
      <span className="kb-row-title">{article.title}</span>
    </button>
  );
});

export default KbCard;
