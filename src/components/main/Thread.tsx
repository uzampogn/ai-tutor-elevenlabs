'use client';

import { useEffect, useRef } from 'react';
import type { Message, Article } from '@/lib/types';
import UserRow from '../UserRow';
import AiRow from '../AiRow';
import Welcome from './Welcome';

interface ThreadProps {
  messages: Message[];
  isLoading: boolean;
  articles: Article[];
  onAsk: (question: string) => void;
  onReadAloud: (text: string) => void;
}

export default function Thread({ messages, isLoading, articles, onAsk, onReadAloud }: ThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="scroll">
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
                onReadAloud={onReadAloud}
              />
            ),
          )
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
