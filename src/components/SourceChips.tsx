// Row of clickable source links, recovered by matching article titles in the
// answer text. Each chip is a real anchor to the article URL.

import type { Article } from '@/lib/types';
import { LinkIcon } from './icons';

export default function SourceChips({ sources, numbered = false }: { sources: Article[]; numbered?: boolean }) {
  if (sources.length === 0) return null;
  return (
    <div className="sources">
      <div className="sources-label">Sources</div>
      <div className="sources-row">
        {sources.map((article, i) => (
          <a
            key={article.url}
            className="source-chip"
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {numbered ? <span className="source-chip-num">{i + 1}</span> : <LinkIcon />}
            <span className="source-chip-title">{article.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
