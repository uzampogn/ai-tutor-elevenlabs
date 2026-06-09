'use client';

import { useState } from 'react';
import type { Article } from '@/lib/types';
import { parseAnswer, matchSources } from '@/lib/parseAnswer';
import InlineMarkdown from './InlineMarkdown';
import ImpactCard from './ImpactCard';
import SourceChips from './SourceChips';
import { CopyIcon, SoundIcon, LikeIcon } from './icons';

interface AiRowProps {
  content: string;
  /** True when this is the last assistant message and the stream is in progress. */
  streaming: boolean;
  articles: Article[];
  /** Speak this answer aloud via the parent's TTS pipeline. */
  onReadAloud: (text: string) => void;
}

export default function AiRow({ content, streaming, articles, onReadAloud }: AiRowProps) {
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState(false);

  const { body, impact } = parseAnswer(content);
  const sources = matchSources(content, articles);

  // Split the body into paragraphs on blank lines.
  const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim().length > 0);

  function handleCopy() {
    navigator.clipboard?.writeText(content).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }

  return (
    <div className="row row-ai">
      <div className="ai-avatar" aria-hidden="true">
        <span className="ai-spark" />
      </div>
      <div className="ai-body" aria-live="polite">
        {streaming && (
          <div className="ai-status">
            <span className="status-label">Thinking</span>
            <span className="thinking-dots">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}

        {paragraphs.map((para, i) => {
          const isLast = i === paragraphs.length - 1;
          return (
            <p key={i} className="ai-para">
              <InlineMarkdown text={para} />
              {streaming && impact === null && isLast && <span className="caret" />}
            </p>
          );
        })}

        {impact !== null && impact.length > 0 && <ImpactCard text={impact} />}

        <SourceChips sources={sources} />

        {!streaming && content.trim().length > 0 && (
          <div className="msg-actions">
            <button
              type="button"
              className={`act${copied ? ' is-on' : ''}`}
              onClick={handleCopy}
              aria-label="Copy"
            >
              <CopyIcon />
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              className="act"
              onClick={() => onReadAloud(content)}
              aria-label="Read aloud"
            >
              <SoundIcon />
              Read aloud
            </button>
            <button
              type="button"
              className={`act${liked ? ' is-on' : ''}`}
              onClick={() => setLiked((v) => !v)}
              aria-label="Like"
              aria-pressed={liked}
            >
              <LikeIcon />
              Like
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
