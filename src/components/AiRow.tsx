'use client';

import { useMemo, useState } from 'react';
import type { Article } from '@/lib/types';
import { parseAnswer, resolveSources, parseBlocks } from '@/lib/parseAnswer';
import { buildSpokenDoc, makeWordCursor } from '@/lib/readAlong/spokenDoc';
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
  /**
   * Optional ref callback to the root row element, supplied for the speaking row
   * so the read-along controller (Spec 04) can toggle classes on its `[data-s]`
   * spans. Absent for non-speaking rows.
   */
  rowRef?: (el: HTMLElement | null) => void;
  /** Speak this answer aloud via the parent's TTS pipeline. */
  onReadAloud: (text: string) => void;
  onStopAudio: () => void;
  /** Retrieved-source slugs from the chat response (X-Sources), retrieval order. */
  sourceSlugs?: string[];
}

export default function AiRow({ content, streaming, articles, speaking, rowRef, onReadAloud, onStopAudio, sourceSlugs }: AiRowProps) {
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState(false);

  const { body, impact } = parseAnswer(content);
  const sources = resolveSources(sourceSlugs, content, articles);

  const blocks = parseBlocks(body);

  // Single source of truth for read-along: one tokenization drives both the TTS
  // string (later specs) and the addressable spans below. Built once per
  // message; partial/streaming content is tolerated (never throws).
  const doc = useMemo(() => buildSpokenDoc(content), [content]);
  const bodyWords = useMemo(
    () => doc.words.filter((w) => doc.sentences[w.sentenceId]?.region === 'body'),
    [doc],
  );
  const impactWords = useMemo(
    () => doc.words.filter((w) => doc.sentences[w.sentenceId]?.region === 'impact'),
    [doc],
  );
  // Body blocks render in document order, consuming the shared body cursor in
  // order (React renders children top-to-bottom), so word ids line up 1:1 with
  // doc.words. The impact card consumes its own cursor.
  const bodyCursor = makeWordCursor(bodyWords);
  const impactCursor = makeWordCursor(impactWords);

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
    <div className="row row-ai" ref={rowRef}>
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
                      <InlineMarkdown text={item} cursor={bodyCursor} />
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
                      <InlineMarkdown text={item} cursor={bodyCursor} />
                      {streaming && impact === null && isLast && isLastItem && <span className="caret" />}
                    </li>
                  );
                })}
              </ol>
            );
          }
          return (
            <p key={i} className="ai-para">
              <InlineMarkdown text={block.text} cursor={bodyCursor} />
              {streaming && impact === null && isLast && <span className="caret" />}
            </p>
          );
        })}

        {impact !== null && impact.length > 0 && <ImpactCard text={impact} cursor={impactCursor} />}

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
