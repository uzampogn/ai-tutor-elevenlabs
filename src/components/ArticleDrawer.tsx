'use client';

import { useEffect } from 'react';
import type { Article, ArticleDigest } from '@/lib/types';
import { formatShortDate } from './sidebar/kb';
import { CloseIcon } from './icons';
import ArticleHero from './ArticleHero';
import ScoreCard from './ScoreCard';

interface ArticleDrawerProps {
  article: Article | null;
  digest: ArticleDigest | null;
  digestsLoaded: boolean;
  accentColor: string;
  open: boolean;
  onClose: () => void;
  onAsk: (question: string) => void;
}

export default function ArticleDrawer({
  article,
  digest,
  digestsLoaded,
  accentColor,
  open,
  onClose,
  onAsk,
}: ArticleDrawerProps) {
  // Esc closes the drawer (focus return is handled by the shell).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <aside className={`drawer${open ? ' open' : ''}`} aria-hidden={!open}>
      {article && (
        <div className="drawer-inner">
          <div className="drawer-head">
            <span className="drawer-date">{formatShortDate(article.pubDate)}</span>
            <button
              type="button"
              className="drawer-close"
              onClick={onClose}
              aria-label="Close article"
            >
              <CloseIcon />
            </button>
          </div>
          <h2 className="drawer-title">{article.title}</h2>
          <ArticleHero src={article.heroImage} alt={article.title} accentColor={accentColor} />
          <ScoreCard
            digest={digest}
            digestsLoaded={digestsLoaded}
            description={article.description}
            url={article.url}
            onAsk={onAsk}
          />
        </div>
      )}
    </aside>
  );
}
