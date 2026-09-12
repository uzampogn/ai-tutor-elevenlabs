'use client';

// The text fallback: a single ruled line at the orb's home, with the orb as its
// mic (OrbStage places it on `[data-orb-anchor="home"]`) and a plain send.

import { useEffect, useRef } from 'react';
import SendBtn from './SendBtn';

interface ComposerProps {
  input: string;
  setInput: (v: string) => void;
  isLoading: boolean;
  onSend: (override?: string) => void;
}

export default function Composer({ input, setInput, isLoading, onSend }: ComposerProps) {
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
    <form className="composer" onSubmit={handleSubmit}>
      <textarea
        ref={taRef}
        className="composer-ta"
        rows={1}
        value={input}
        placeholder="Ask about the latest AI news…"
        aria-label="Your question"
        disabled={isLoading}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <SendBtn disabled={sendDisabled} />
    </form>
  );
}
