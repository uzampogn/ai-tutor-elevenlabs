'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message, Article } from '@/lib/types';
import Sidebar from './sidebar/Sidebar';
import Topbar from './main/Topbar';
import Thread from './main/Thread';
import Composer from './main/Composer';
import ArticleDrawer from './ArticleDrawer';

type Density = 'compact' | 'normal' | 'comfy';

export default function AppShell() {
  const [messages, setMessages] = useState<Message[]>([]); // start empty → Welcome
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const [articles, setArticles] = useState<Article[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(true);

  const [activeArticle, setActiveArticle] = useState<Article | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // density default 'normal' = no class on .app.
  const [density] = useState<Density>('normal');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  // The KB card that opened the drawer, so focus returns there on close.
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null);

  const loadArticles = useCallback(() => {
    setArticlesLoading(true);
    fetch('/api/scrape')
      .then((r) => r.json())
      .then((d: { articles?: Article[] }) => setArticles(d.articles ?? []))
      .catch(console.error)
      .finally(() => setArticlesLoading(false));
  }, []);

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  const playVoice = useCallback(
    async (text: string) => {
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
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onplay = () => setSpeaking(true);
        audio.onended = () => setSpeaking(false);
        audio.onpause = () => setSpeaking(false);
        audio.play().catch(() => setSpeaking(false));
      } catch (err) {
        console.error('[voice]', err);
        setSpeaking(false);
      }
    },
    [voiceEnabled],
  );

  const sendMessage = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim();
      if (!text || isLoading) return;

      // Stop any active STT session before sending.
      if (isListening) setIsListening(false);

      const userMsg: Message = { role: 'user', content: text };
      const history: Message[] = [...messages, userMsg];

      setMessages([...history, { role: 'assistant', content: '' }]);
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

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          setMessages([...history, { role: 'assistant', content: full }]);
        }

        await playVoice(full);
      } catch (err) {
        console.error('[chat]', err);
        setMessages([
          ...history,
          { role: 'assistant', content: 'Something went wrong. Please try again.' },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [input, isLoading, isListening, messages, playVoice],
  );

  function handleNewChat() {
    audioRef.current?.pause();
    setMessages([]);
    setInput('');
  }

  function openArticle(article: Article, trigger: HTMLButtonElement | null) {
    drawerTriggerRef.current = trigger;
    setActiveArticle(article);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    drawerTriggerRef.current?.focus();
  }

  function readAloud(text: string) {
    audioRef.current?.pause();
    void (async () => {
      try {
        const res = await fetch('/api/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const audio = new Audio(URL.createObjectURL(blob));
        audioRef.current = audio;
        audio.onplay = () => setSpeaking(true);
        audio.onended = () => setSpeaking(false);
        audio.onpause = () => setSpeaking(false);
        audio.play().catch(() => setSpeaking(false));
      } catch (err) {
        console.error('[voice]', err);
      }
    })();
  }

  const densityClass =
    density === 'compact' ? ' density-compact' : density === 'comfy' ? ' density-comfy' : '';

  return (
    <div className={`app${densityClass}`}>
      <Sidebar
        articles={articles}
        articlesLoading={articlesLoading}
        activeUrl={drawerOpen ? activeArticle?.url ?? null : null}
        onRefresh={loadArticles}
        onOpenArticle={openArticle}
      />

      <main className="main">
        <Topbar
          voiceEnabled={voiceEnabled}
          speaking={speaking || isListening}
          onToggleVoice={() => setVoiceEnabled((v) => !v)}
          onNewChat={handleNewChat}
        />
        <Thread
          messages={messages}
          isLoading={isLoading}
          articles={articles}
          onAsk={(q) => void sendMessage(q)}
          onReadAloud={readAloud}
        />
        <Composer
          input={input}
          setInput={setInput}
          isLoading={isLoading}
          listening={isListening}
          setListening={setIsListening}
          onSend={(override) => void sendMessage(override)}
        />
      </main>

      <ArticleDrawer article={activeArticle} open={drawerOpen} onClose={closeDrawer} />
    </div>
  );
}
