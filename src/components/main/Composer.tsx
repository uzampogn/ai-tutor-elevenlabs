'use client';

import { useEffect, useRef } from 'react';
import { SUGGESTED } from '@/lib/types';
import MicBtn from './MicBtn';
import SendBtn from './SendBtn';

// A subset of the suggested questions surfaced as composer quick chips.
const QUICK_CHIPS = SUGGESTED.slice(0, 2);

interface ComposerProps {
  input: string;
  setInput: (v: string) => void;
  isLoading: boolean;
  listening: boolean;
  setListening: (v: boolean) => void;
  onSend: (override?: string) => void;
}

export default function Composer({
  input,
  setInput,
  isLoading,
  listening,
  setListening,
  onSend,
}: ComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea up to the CSS max-height.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [input]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSend();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  const sendDisabled = isLoading || input.trim().length === 0;

  return (
    <div className="composer-wrap">
      <div className="quick-row">
        {QUICK_CHIPS.map((q) => (
          <button
            key={q}
            type="button"
            className="quick-chip"
            disabled={isLoading}
            onClick={() => onSend(q)}
          >
            {q}
          </button>
        ))}
      </div>

      <form className="composer" onSubmit={handleSubmit}>
        <MicBtn
          listening={listening}
          setListening={setListening}
          onInterim={(t) => setInput(t)}
          onFinal={(t) => {
            setInput(t);
            // AUTO_SEND: send the final transcript automatically.
            const AUTO_SEND = true;
            if (AUTO_SEND) onSend(t);
          }}
          disabled={isLoading}
        />
        <textarea
          ref={taRef}
          className="composer-ta"
          rows={1}
          value={input}
          placeholder="Ask about the latest AI news…"
          disabled={isLoading}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <SendBtn disabled={sendDisabled} />
      </form>

      <div className="composer-foot">
        Answers are grounded in Anthropic&apos;s RSS feed and may be imperfect.
      </div>
    </div>
  );
}
