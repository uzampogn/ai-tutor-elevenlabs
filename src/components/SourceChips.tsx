// The numbered source list under an answer. Each row is a real anchor to the
// post (so middle-click, copy-link and keyboard all work); a plain click opens
// the article drawer at that post when the shell provides `onOpen`.

import type { MouseEvent } from 'react';
import type { Article } from '@/lib/types';
import { LinkIcon } from './icons';

interface SourceChipsProps {
  sources: Article[];
  numbered?: boolean;
  onOpen?: (article: Article) => void;
}

export default function SourceChips({ sources, numbered = false, onOpen }: SourceChipsProps) {
  if (sources.length === 0) return null;
  function handleClick(e: MouseEvent<HTMLAnchorElement>, article: Article) {
    if (!onOpen || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onOpen(article);
  }
  return (
    <div className="sources">
      <div className="sources-label">{sources.length === 1 ? 'Source' : 'Sources'}</div>
      <ol className="sources-list">
        {sources.map((article, i) => (
          <li key={article.url}>
            <a
              className="source-chip"
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => handleClick(e, article)}
            >
              <span className="source-chip-num">{numbered ? i + 1 : <LinkIcon />}</span>
              <span className="source-chip-title">{article.title}</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
