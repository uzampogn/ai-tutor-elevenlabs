'use client';

import { useEffect, useRef, useState } from 'react';
import type { Message, Article } from '@/lib/types';
import type { ReadAlongMode } from '../AppShell';
import type { ReadAlongTimings } from '@/lib/readAlong/timingMap';
import UserRow from '../UserRow';
import AiRow from '../AiRow';
import Welcome from './Welcome';
import { useReadAlong } from './useReadAlong';

interface ThreadProps {
  messages: Message[];
  isLoading: boolean;
  articles: Article[];
  speakingContent: string | null;
  /** Read-along mode (Spec 04). `'off'` is a total no-op. */
  readAlong: ReadAlongMode;
  /** Time windows for the speaking answer, or null when none/unavailable. */
  timings: ReadAlongTimings | null;
  /** The live audio element for the speaking answer, or null. */
  audio: HTMLAudioElement | null;
  onAsk: (question: string) => void;
  onReadAloud: (text: string) => void;
  onStopAudio: () => void;
}

export default function Thread({
  messages,
  isLoading,
  articles,
  speakingContent,
  readAlong,
  timings,
  audio,
  onAsk,
  onReadAloud,
  onStopAudio,
}: ThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The speaking AiRow's root element, captured via a ref callback so the
  // read-along controller can toggle classes on its `[data-s]` spans.
  const [speakingRowEl, setSpeakingRowEl] = useState<HTMLElement | null>(null);

  // A read-along is active when the flag is on and a message is speaking. While
  // active we let the controller own scroll (scroll-to-start + follow) and
  // suppress the bottom-pin so it doesn't fight it.
  const isReading = readAlong !== 'off' && !!speakingContent;

  useEffect(() => {
    if (isReading) return; // read-along owns the scroll; don't pin to bottom.
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isReading]);

  useReadAlong({
    active: isReading,
    audio,
    timings,
    rowEl: speakingRowEl,
    scrollEl: scrollRef.current,
    granularity: 'sentence',
  });

  return (
    <div className="scroll" ref={scrollRef}>
      <div className="thread">
        {messages.length === 0 ? (
          <Welcome onAsk={onAsk} />
        ) : (
          messages.map((msg, i) =>
            msg.role === 'user' ? (
              <UserRow key={i} content={msg.content} />
            ) : (
              <AiRow
                key={i}
                content={msg.content}
                streaming={isLoading && i === messages.length - 1}
                articles={articles}
                speaking={speakingContent === msg.content}
                rowRef={speakingContent === msg.content ? setSpeakingRowEl : undefined}
                onReadAloud={onReadAloud}
                onStopAudio={onStopAudio}
                sourceSlugs={msg.sources}
              />
            ),
          )
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
