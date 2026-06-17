'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Message, Article, ArticleDigest } from '@/lib/types';
import { buildSpokenDoc } from '@/lib/readAlong/spokenDoc';
import { buildTimings, type ReadAlongTimings } from '@/lib/readAlong/timingMap';
import Sidebar from './sidebar/Sidebar';
import SidebarToggle from './sidebar/SidebarToggle';
import Thread from './main/Thread';
import InputDock from './main/InputDock';
import ArticleDrawer from './ArticleDrawer';
import { categoryFor } from './sidebar/kb';

type Density = 'compact' | 'normal' | 'comfy';

/**
 * Read-along mode (Spec 00 cross-cutting flag). `'off'` is a total no-op
 * equivalent to today; `'sentence'` is the dev default once Spec 04 lands;
 * `'word'` arrives in Spec 07. A user-facing toggle is out of scope.
 */
export type ReadAlongMode = 'off' | 'sentence' | 'word';

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
  // Read-along mode. Default 'sentence' (Spec 04): a true no-op visually until
  // audio plays with valid timings; the controller is otherwise inert.
  const [readAlong] = useState<ReadAlongMode>('sentence');
  // The live audio element, surfaced to the view so the read-along controller
  // can drive its rAF loop. Set on `onplay`, cleared on `ended`/`pause`.
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [inputMode, setInputMode] = useState<'voice' | 'text'>('voice');

  // KB sidebar collapse. Starts closed every load (no persistence).
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [articles, setArticles] = useState<Article[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(true);

  const [activeArticle, setActiveArticle] = useState<Article | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [digests, setDigests] = useState<Record<string, ArticleDigest | null>>({});
  const [digestsLoaded, setDigestsLoaded] = useState(false);

  // density default 'normal' = no class on .app.
  const [density] = useState<Density>('normal');

  // Sentence/word time windows for the speaking answer (Spec 03), built from the
  // canonical spoken doc + stashed alignment. Null until both are present; the
  // read-along controller treats null as "inert".
  const timings: ReadAlongTimings | null = useMemo(() => {
    if (!speakingContent || !speakingAlignment) return null;
    return buildTimings(buildSpokenDoc(speakingContent), speakingAlignment);
  }, [speakingContent, speakingAlignment]);

  // Category color of the active article, for the hero gradient fallback. Keeps
  // the palette logic in one place (sidebar/kb), matching the KB card dots.
  const activeAccent = useMemo(() => {
    if (!activeArticle) return categoryFor(0).color;
    const i = articles.findIndex((a) => a.url === activeArticle.url);
    return categoryFor(i >= 0 ? i : 0).color;
  }, [activeArticle, articles]);

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

  // Prefetch the per-article digests once, in the background. The sidebar list
  // never waits on this; the drawer reads from `digests` when an article opens.
  useEffect(() => {
    fetch('/api/digest')
      .then((r) => r.json())
      .then((d: { digests?: Record<string, ArticleDigest | null> }) => setDigests(d.digests ?? {}))
      .catch(console.error)
      .finally(() => setDigestsLoaded(true));
  }, []);

  function stopAudio() {
    speakAbortRef.current?.abort();
    audioRef.current?.pause();
    setSpeakingContent(null);
    setSpeakingAlignment(null);
    setAudioEl(null);
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
          setAudioEl(audio);
        };
        audio.onended = () => {
          setSpeakingContent(null);
          setSpeakingAlignment(null);
          setAudioEl(null);
        };
        audio.onpause = () => {
          setSpeakingContent(null);
          setSpeakingAlignment(null);
          setAudioEl(null);
        };
        audio.play().catch(() => {
          setSpeakingContent(null);
          setSpeakingAlignment(null);
          setAudioEl(null);
        });
      } catch (err) {
        console.error('[voice]', err);
        setSpeakingContent(null);
        setSpeakingAlignment(null);
        setAudioEl(null);
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
    setAudioEl(null);
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
        if (!res.ok) { setSpeakingContent(null); setSpeakingAlignment(null); setAudioEl(null); return; }
        const { audioBase64, alignment } = (await res.json()) as SpeakResult;
        const audio = new Audio(audioUrlFromBase64(audioBase64));
        audioRef.current = audio;
        audio.onplay = () => {
          setSpeakingContent(content);
          setSpeakingAlignment(alignment);
          setAudioEl(audio);
        };
        audio.onended = () => {
          setSpeakingContent(null);
          setSpeakingAlignment(null);
          setAudioEl(null);
        };
        audio.onpause = () => {
          setSpeakingContent(null);
          setSpeakingAlignment(null);
          setAudioEl(null);
        };
        audio.play().catch(() => {
          setSpeakingContent(null);
          setSpeakingAlignment(null);
          setAudioEl(null);
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        console.error('[voice]', err);
        setSpeakingContent(null);
        setSpeakingAlignment(null);
        setAudioEl(null);
      }
    })();
  }

  const densityClass =
    density === 'compact' ? ' density-compact' : density === 'comfy' ? ' density-comfy' : '';

  return (
    <div className={`app${densityClass}${sidebarOpen ? '' : ' sidebar-collapsed'}`}>
      <SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />
      <Sidebar
        articles={articles}
        articlesLoading={articlesLoading}
        activeUrl={drawerOpen ? activeArticle?.url ?? null : null}
        collapsed={!sidebarOpen}
        onRefresh={loadArticles}
        onOpenArticle={openArticle}
      />

      <main className="main">
        <Thread
          messages={messages}
          isLoading={isLoading}
          articles={articles}
          speakingContent={speakingContent}
          readAlong={readAlong}
          timings={timings}
          audio={audioEl}
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

      <ArticleDrawer
        article={activeArticle}
        digest={activeArticle ? digests[activeArticle.url] ?? null : null}
        digestsLoaded={digestsLoaded}
        accentColor={activeAccent}
        open={drawerOpen}
        onClose={closeDrawer}
        onAsk={(q) => {
          closeDrawer();
          void sendMessage(q);
        }}
      />
    </div>
  );
}
