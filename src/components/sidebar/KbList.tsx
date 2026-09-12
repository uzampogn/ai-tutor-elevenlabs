// The ruled list of knowledge-base rows. Loading and empty states are drawn as
// ghosts in place, never left blank.

import type { Article } from '@/lib/types';
import KbCard from './KbCard';

interface KbListProps {
  articles: Article[];
  loading: boolean;
  activeUrl: string | null;
  /** Receives the clicked article and its button element (for focus return). */
  onOpen: (article: Article, trigger: HTMLButtonElement | null) => void;
}

const GHOST_ROWS = 7;

export default function KbList({ articles, loading, activeUrl, onOpen }: KbListProps) {
  if (articles.length === 0) {
    return (
      <div className="kb-list" aria-busy={loading}>
        {loading ? (
          <>
            <span className="sr-only" role="status">Loading the knowledge base…</span>
            {Array.from({ length: GHOST_ROWS }, (_, i) => (
              <div key={i} className="kb-row is-ghost" aria-hidden="true">
                <span className="ghost-line short" />
                <span className="ghost-line" />
              </div>
            ))}
          </>
        ) : (
          <p className="kb-empty">No posts yet. Refresh to fetch the latest.</p>
        )}
      </div>
    );
  }
  return (
    <div className="kb-list">
      {articles.map((article, i) => (
        <CardItem
          key={article.url || i}
          article={article}
          index={i}
          active={activeUrl === article.url}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

// Per-row wrapper that owns the button ref so focus can return on drawer close.
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
