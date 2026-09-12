'use client';

import { useMemo, useState } from 'react';
import type { Article } from '@/lib/types';
import { parseAnswer, resolveSources, citationTargets } from '@/lib/parseAnswer';
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
  /** True for the stream-failure row: no Impact ghost, no sources, no actions. */
  error?: boolean;
  /**
   * Optional ref callback to the root row element, supplied for the speaking row
   * so the read-along controller (Spec 04) can toggle classes on its `[data-s]`
   * spans. Absent for non-speaking rows.
   */
  rowRef?: (el: HTMLElement | null) => void;
  /** Speak this answer aloud via the parent's TTS pipeline. */
  onReadAloud: (text: string) => void;
  onStopAudio: () => void;
  /** Open the article drawer at a cited post (source list and superscripts). */
  onOpenSource?: (article: Article) => void;
  /** Retrieved-source slugs from the chat response (X-Sources), retrieval order. */
  sourceSlugs?: string[];
}

export default function AiRow({
  content,
  streaming,
  articles,
  speaking,
  error = false,
  rowRef,
  onReadAloud,
  onStopAudio,
  onOpenSource,
  sourceSlugs,
}: AiRowProps) {
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState(false);

  const { impact } = parseAnswer(content);
  const sources = resolveSources(sourceSlugs, content, articles);
  // Positional citation targets ([n] → citeTargets[n-1]). The glued sentinels
  // themselves live inside the SpokenDoc (buildSpokenDoc → citation overlay);
  // DocBlocks renders them as superscript links against these targets.
  const citeTargets = citationTargets(sourceSlugs, articles);

  // Single source of truth for read-along: one tokenization drives both the TTS
  // string and the addressable spans rendered below via DocBlocks. Built once
  // per message; partial/streaming content is tolerated (never throws).
  const doc = useMemo(() => buildSpokenDoc(content), [content]);

  const hasImpact = impact !== null && impact.length > 0;
  const settled = !streaming && content.trim().length > 0;

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
    <div className={`row row-ai${error ? ' is-error' : ''}${speaking ? ' is-speaking' : ''}`} ref={rowRef}>
      <div className="ai-body" aria-live="polite">
        {streaming && content.length === 0 && (
          <div className="ai-status">
            <span className="status-label">Thinking</span>
            <span className="thinking-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}

        <DocBlocks
          doc={doc}
          region="body"
          streaming={streaming && impact === null}
          citeTargets={citeTargets}
          onOpenSource={onOpenSource}
        />

        {hasImpact && <ImpactCard doc={doc} citeTargets={citeTargets} onOpenSource={onOpenSource} />}
        {!hasImpact && settled && !error && <ImpactCard ghost />}

        {!error && <SourceChips sources={sources} numbered={Boolean(sourceSlugs?.length)} onOpen={onOpenSource} />}

        {settled && !error && (
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
              onClick={() => (speaking ? onStopAudio() : onReadAloud(content))}
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
