'use client';

import { useState, useRef, useEffect } from 'react';
import MessageBubble, { type Message } from './MessageBubble';

const WELCOME: Message = {
  role: 'assistant',
  content:
    "Hi! I'm your AI news tutor. I've loaded Anthropic's latest blog articles and I'm ready to teach you the key concepts and business impact of recent AI developments.\n\nTry asking: \"What are the most important AI announcements this month?\" or \"How does the latest Claude update affect businesses?\"",
};

const SUGGESTED = [
  "What are the biggest AI developments this month?",
  "How does Claude's latest update affect businesses?",
  "Explain the key research findings from Anthropic's recent posts",
  "What should a non-technical executive know about recent AI news?",
];

interface ArticlePreview {
  title: string;
  url: string;
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [articles, setArticles] = useState<ArticlePreview[]>([]);
  const [showArticles, setShowArticles] = useState(false);
  const [articlesLoading, setArticlesLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetch('/api/scrape')
      .then((r) => r.json())
      .then((d) => setArticles(d.articles ?? []))
      .catch(console.error)
      .finally(() => setArticlesLoading(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function playVoice(text: string) {
    if (!voiceEnabled) return;
    audioRef.current?.pause();
    try {
      const res = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioRef.current = new Audio(url);
      audioRef.current.play();
    } catch (err) {
      console.error('[voice]', err);
    }
  }

  async function sendMessage(e?: React.FormEvent, overrideInput?: string) {
    e?.preventDefault();
    const text = (overrideInput ?? input).trim();
    if (!text || isLoading) return;

    const userMsg: Message = { role: 'user', content: text };
    // history sent to API — exclude the static welcome message
    const history: Message[] = [...messages.slice(1), userMsg];

    setMessages([WELCOME, ...history, { role: 'assistant', content: '' }]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setMessages([WELCOME, ...history, { role: 'assistant', content: full }]);
      }

      await playVoice(full);
    } catch (err) {
      console.error('[chat]', err);
      setMessages([
        WELCOME,
        ...history,
        { role: 'assistant', content: 'Something went wrong. Please try again.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  const hasConversation = messages.length > 1;

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-white tracking-tight">AI News Tutor</h1>
          <p className="text-xs text-purple-400">Anthropic blog × ElevenLabs voice</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowArticles((s) => !s)}
            className="text-xs text-purple-300 hover:text-white border border-purple-800 hover:border-purple-500 px-3 py-1.5 rounded-full transition-colors"
          >
            {articlesLoading ? '⏳ Loading…' : `📰 ${articles.length} articles`}
          </button>
          <button
            onClick={() => setVoiceEnabled((v) => !v)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              voiceEnabled
                ? 'bg-purple-700 border-purple-500 text-white'
                : 'border-purple-800 text-purple-400 hover:border-purple-500 hover:text-white'
            }`}
          >
            {voiceEnabled ? '🔊 Voice on' : '🔇 Voice off'}
          </button>
        </div>
      </div>

      {/* Article list panel */}
      {showArticles && (
        <div className="bg-slate-800/60 border-b border-white/10 px-6 py-3 max-h-44 overflow-y-auto flex-shrink-0">
          <p className="text-[11px] font-semibold text-purple-400 uppercase tracking-wider mb-2">
            Knowledge base — Anthropic&apos;s latest articles
          </p>
          {articles.length === 0 ? (
            <p className="text-xs text-slate-400">No articles loaded yet.</p>
          ) : (
            articles.map((a, i) => (
              <a
                key={i}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-slate-300 hover:text-purple-300 py-0.5 truncate transition-colors"
              >
                {i + 1}. {a.title}
              </a>
            ))
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
            isTyping={isLoading && i === messages.length - 1}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Suggested questions — shown only before any conversation */}
      {!hasConversation && (
        <div className="px-6 pb-3 flex flex-wrap gap-2 flex-shrink-0">
          {SUGGESTED.map((q, i) => (
            <button
              key={i}
              onClick={() => sendMessage(undefined, q)}
              className="text-xs bg-purple-950/60 hover:bg-purple-900/60 text-purple-200 px-3 py-1.5 rounded-full border border-purple-800 hover:border-purple-600 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={sendMessage}
        className="px-6 py-4 border-t border-white/10 flex-shrink-0"
      >
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about the latest AI news…"
            disabled={isLoading}
            className="flex-1 bg-white/5 text-white placeholder-white/30 border border-white/15 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-purple-600 hover:bg-purple-500 disabled:bg-purple-900 disabled:cursor-not-allowed text-white px-5 py-3 rounded-xl text-sm font-medium transition-colors"
          >
            {isLoading ? (
              <span className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce [animation-delay:-0.2s]" />
                <span className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce" />
              </span>
            ) : (
              'Send'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
