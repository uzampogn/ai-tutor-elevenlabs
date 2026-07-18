'use client';

import { useMemo, useState } from 'react';
import type { Article } from '@/lib/types';
import { parseAnswer, resolveSources } from '@/lib/parseAnswer';
import { buildSpokenDoc } from '@/lib/readAlong/spokenDoc';
import DocBlocks from './DocBlocks';
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

  const { impact } = parseAnswer(content);
  const sources = resolveSources(sourceSlugs, content, articles);

  // Single source of truth for read-along: one tokenization drives both the TTS
  // string (later specs) and the addressable spans rendered below via
  // DocBlocks. Built once per message; partial/streaming content is tolerated
  // (never throws).
  const doc = useMemo(() => buildSpokenDoc(content), [content]);

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

        <DocBlocks doc={doc} region="body" streaming={streaming && impact === null} />

        {impact !== null && impact.length > 0 && <ImpactCard doc={doc} />}

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
