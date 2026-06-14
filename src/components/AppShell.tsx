'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message, Article } from '@/lib/types';
import { buildSpokenDoc } from '@/lib/readAlong/spokenDoc';
import Sidebar from './sidebar/Sidebar';
import Thread from './main/Thread';
import InputDock from './main/InputDock';
import ArticleDrawer from './ArticleDrawer';

type Density = 'compact' | 'normal' | 'comfy';

/** Character-level alignment returned by /api/speak (Spec 02). */
interface SpeakAlignment {
  chars: string[];
  charStartTimesSec: number[];
  charEndTimesSec: number[];
}
/** Response shape of POST /api/speak (Spec 02 SpeakResult). */
interface SpeakResult {
  audioBase64: string;
  alignment: SpeakAlignment;
}

/** Decode base64 → Blob('audio/mpeg') → object URL for playback. */
function audioUrlFromBase64(audioBase64: string): string {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  return URL.createObjectURL(blob);
}

export default function AppShell() {
  const [messages, setMessages] = useState<Message[]>([]); // start empty → Welcome
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speakingContent, setSpeakingContent] = useState<string | null>(null);
  // Stashed alignment for the currently-speaking answer (consumed by Spec 03).
  const [speakingAlignment, setSpeakingAlignment] = useState<SpeakAlignment | null>(null);
  const [inputMode, setInputMode] = useState<'voice' | 'text'>('voice');

  const [articles, setArticles] = useState<Article[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(true);

  const [activeArticle, setActiveArticle] = useState<Article | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // density default 'normal' = no class on .app.
  const [density] = useState<Density>('normal');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakAbortRef = useRef<AbortController | null>(null);
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

  function stopAudio() {
    speakAbortRef.current?.abort();
    audioRef.current?.pause();
    setSpeakingContent(null);
    setSpeakingAlignment(null);
  }

  // Voice is always on in the conversation-first cleanup — there is no on/off toggle.
  const playVoice = useCallback(
    async (content: string) => {
      audioRef.current?.pause();
      try {
        // Send the canonical spoken text (markdown stripped, no length cap),
        // not the raw markdown — keeps audio identical for short answers and
        // adds the rest for long ones.
        const spokenText = buildSpokenDoc(content).spokenText;
        const res = await fetch('/api/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: spokenText }),
        });
        if (!res.ok) return;
        const { audioBase64, alignment } = (await res.json()) as SpeakResult;
        const audio = new Audio(audioUrlFromBase64(audioBase64));
        audioRef.current = audio;
        audio.onplay = () => {
          setSpeakingContent(content);
          setSpeakingAlignment(alignment);
        };
        audio.onended = () => {
          setSpeakingContent(null);
          setSpeakingAlignment(null);
        };
        audio.onpause = () => {
          setSpeakingContent(null);
          setSpeakingAlignment(null);
        };
        audio.play().catch(() => {
          setSpeakingContent(null);
          setSpeakingAlignment(null);
        });
      } catch (err) {
        console.error('[voice]', err);
        setSpeakingContent(null);
        setSpeakingAlignment(null);
      }
    },
    [],
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

  function readAloud(content: string) {
    speakAbortRef.current?.abort();
    audioRef.current?.pause();
    setSpeakingContent(content);
    setSpeakingAlignment(null);
    const controller = new AbortController();
    speakAbortRef.current = controller;
    void (async () => {
      try {
        const spokenText = buildSpokenDoc(content).spokenText;
        const res = await fetch('/api/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: spokenText }),
          signal: controller.signal,
        });
        if (!res.ok) { setSpeakingContent(null); setSpeakingAlignment(null); return; }
        const { audioBase64, alignment } = (await res.json()) as SpeakResult;
        const audio = new Audio(audioUrlFromBase64(audioBase64));
        audioRef.current = audio;
        audio.onplay = () => {
          setSpeakingContent(content);
          setSpeakingAlignment(alignment);
        };
        audio.onended = () => {
          setSpeakingContent(null);
          setSpeakingAlignment(null);
        };
        audio.onpause = () => {
          setSpeakingContent(null);
          setSpeakingAlignment(null);
        };
        audio.play().catch(() => {
          setSpeakingContent(null);
          setSpeakingAlignment(null);
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        console.error('[voice]', err);
        setSpeakingContent(null);
        setSpeakingAlignment(null);
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
        <Thread
          messages={messages}
          isLoading={isLoading}
          articles={articles}
          speakingContent={speakingContent}
          onAsk={(q) => void sendMessage(q)}
          onReadAloud={readAloud}
          onStopAudio={stopAudio}
        />
        <InputDock
          inputMode={inputMode}
          setInputMode={setInputMode}
          input={input}
          setInput={setInput}
          isLoading={isLoading}
          listening={isListening}
          setListening={setIsListening}
          onSend={(override) => void sendMessage(override)}
          speaking={!!speakingContent}
          onNewChat={handleNewChat}
        />
      </main>

      <ArticleDrawer article={activeArticle} open={drawerOpen} onClose={closeDrawer} />
    </div>
  );
}
