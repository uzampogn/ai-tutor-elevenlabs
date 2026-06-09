// Scrollable list of knowledge-base cards.

import type { Article } from '@/lib/types';
import KbCard from './KbCard';

interface KbListProps {
  articles: Article[];
  loading: boolean;
  activeUrl: string | null;
  /** Receives the clicked article and its button element (for focus return). */
  onOpen: (article: Article, trigger: HTMLButtonElement | null) => void;
}

export default function KbList({ articles, loading, activeUrl, onOpen }: KbListProps) {
  return (
    <div className="kb-list">
      <div className="kb-list-label">Latest articles</div>
      {loading && articles.length === 0 ? (
        <div className="kb-list-label">Loading…</div>
      ) : (
        articles.map((article, i) => (
          <CardItem
            key={article.url || i}
            article={article}
            index={i}
            active={activeUrl === article.url}
            onOpen={onOpen}
          />
        ))
      )}
    </div>
  );
}

// Per-card wrapper that owns the button ref so focus can return on drawer close.
function CardItem({
  article,
  index,
  active,
  onOpen,
}: {
  article: Article;
  index: number;
  active: boolean;
  onOpen: (article: Article, trigger: HTMLButtonElement | null) => void;
}) {
  let el: HTMLButtonElement | null = null;
  return (
    <KbCard
      ref={(node) => {
        el = node;
      }}
      article={article}
      index={index}
      active={active}
      onOpen={() => onOpen(article, el)}
    />
  );
}
