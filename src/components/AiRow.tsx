'use client';

import { useState } from 'react';
import type { Article } from '@/lib/types';
import { parseAnswer, matchSources, parseBlocks } from '@/lib/parseAnswer';
import InlineMarkdown from './InlineMarkdown';
import ImpactCard from './ImpactCard';
import SourceChips from './SourceChips';
import { CopyIcon, SoundIcon, LikeIcon } from './icons';

interface AiRowProps {
  content: string;
  /** True when this is the last assistant message and the stream is in progress. */
  streaming: boolean;
  articles: Article[];
  speaking: boolean;
  /** Speak this answer aloud via the parent's TTS pipeline. */
  onReadAloud: (text: string) => void;
  onStopAudio: () => void;
}

export default function AiRow({ content, streaming, articles, speaking, onReadAloud, onStopAudio }: AiRowProps) {
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState(false);

  const { body, impact } = parseAnswer(content);
  const sources = matchSources(content, articles);

  const blocks = parseBlocks(body);

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

        {blocks.map((block, i) => {
          const isLast = i === blocks.length - 1;
          if (block.type === 'ul') {
            return (
              <ul key={i} className="ai-list">
                {block.items.map((item, j) => {
                  const isLastItem = j === block.items.length - 1;
                  return (
                    <li key={j} className="ai-list-item">
                      <InlineMarkdown text={item} />
                      {streaming && impact === null && isLast && isLastItem && <span className="caret" />}
                    </li>
                  );
                })}
              </ul>
            );
          }
          if (block.type === 'ol') {
            return (
              <ol key={i} className="ai-list">
                {block.items.map((item, j) => {
                  const isLastItem = j === block.items.length - 1;
                  return (
                    <li key={j} className="ai-list-item">
                      <InlineMarkdown text={item} />
                      {streaming && impact === null && isLast && isLastItem && <span className="caret" />}
                    </li>
                  );
                })}
              </ol>
            );
          }
          return (
            <p key={i} className="ai-para">
              <InlineMarkdown text={block.text} />
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
              className={`act${speaking ? ' is-on' : ''}`}
              onClick={() => speaking ? onStopAudio() : onReadAloud(content)}
              aria-label={speaking ? 'Stop audio' : 'Read aloud'}
            >
              {speaking ? (
                <span className="sound-wave" aria-hidden="true">
                  <i /><i /><i />
                </span>
              ) : (
                <SoundIcon />
              )}
              {speaking ? 'Stop' : 'Read aloud'}
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
