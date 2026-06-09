'use client';

import { useEffect } from 'react';
import type { Article } from '@/lib/types';
import { formatShortDate } from './sidebar/kb';
import { CloseIcon } from './icons';

interface ArticleDrawerProps {
  article: Article | null;
  open: boolean;
  onClose: () => void;
}

// A few static presentational tags for the reader (Article has no tag field).
const TAGS = ['Claude', 'AI', 'Analysis'];

export default function ArticleDrawer({ article, open, onClose }: ArticleDrawerProps) {
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
          <div className="drawer-hero">
            <span className="ph-label">Article preview</span>
          </div>
          <p className="drawer-summary">{article.description}</p>
          <div className="drawer-tags">
            {TAGS.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
          <div className="drawer-note">
            This is a summary from the Claude blog. Open the original article for the full text.
          </div>
        </div>
      )}
    </aside>
  );
}
