'use client';

// The conversation surface: rail · knowledge base · main plane · article drawer,
// with the orb as a free body over the main plane (OrbStage). Voice is the
// primary input; Text is the fallback, a ruled line at the orb's home.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Message, Article, ArticleDigest } from '@/lib/types';
import { buildSpokenDoc } from '@/lib/readAlong/spokenDoc';
import { buildTimings, type ReadAlongTimings } from '@/lib/readAlong/timingMap';
import { driftCheck, type ChunkMeta } from '@/lib/readAlong/driftCheck';
import Rail, { type InputMode } from './rail/Rail';
import Sidebar from './sidebar/Sidebar';
import Thread from './main/Thread';
import Composer from './main/Composer';
import OrbStage, { type OrbPose } from './main/OrbStage';
import { useIsMobile } from './main/useIsMobile';
import { useSwipeToClose } from './main/useSwipeToClose';
import ArticleDrawer from './ArticleDrawer';

/**
 * Read-along mode (Spec 00 cross-cutting flag). `'off'` is a total no-op;
 * `'sentence'` is the default; `'word'` is reserved. No user-facing toggle.
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
  chunkMeta?: ChunkMeta;
}

/** Decode base64 → Blob('audio/mpeg') → object URL for playback. */
function audioUrlFromBase64(audioBase64: string): string {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  return URL.createObjectURL(blob);
}

const ERROR_ROW = 'Something went wrong. Please try again.';

export default function AppShell() {
  const [messages, setMessages] = useState<Message[]>([]); // start empty → Welcome
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speakingContent, setSpeakingContent] = useState<string | null>(null);
  const [speakingAlignment, setSpeakingAlignment] = useState<SpeakAlignment | null>(null);
  const [readAlong] = useState<ReadAlongMode>('sentence');
  // The live audio element, surfaced so the read-along controller can drive its rAF loop.
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>('voice');
  // False once OrbStage reports the browser has no voice input: Text is then fixed on.
  const [voiceSupported, setVoiceSupported] = useState(true);

  // KB sidebar collapse. Starts closed every load (no persistence).
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isMobile = useIsMobile();
  const mainRef = useRef<HTMLElement>(null);

  // Swipe the KB overlay left to dismiss it (mobile only, while open).
  const sidebarSwipe = useSwipeToClose({
    onClose: () => setSidebarOpen(false),
    direction: 'left',
    enabled: isMobile && sidebarOpen,
  });

  // Mobile overlay only: Escape closes the sidebar and the body is scroll-locked
  // while it's open. Both are no-ops on desktop.
  useEffect(() => {
    if (!isMobile || !sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isMobile, sidebarOpen]);

  useEffect(() => {
    if (!isMobile || !sidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isMobile, sidebarOpen]);

  // Keyboard-aware foot (mobile only): lift it by the slice of viewport the
  // on-screen keyboard covers. The CSS var defaults to 0px via globals.css.
  useEffect(() => {
    if (!isMobile) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--kb-inset', `${inset}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--kb-inset');
    };
  }, [isMobile]);

  const [articles, setArticles] = useState<Article[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(true);

  const [activeArticle, setActiveArticle] = useState<Article | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Swipe the article drawer right to dismiss it (mobile only, while open).
  const drawerSwipe = useSwipeToClose({
    onClose: () => closeDrawer(),
    direction: 'right',
    enabled: isMobile && drawerOpen,
  });

  const [digests, setDigests] = useState<Record<string, ArticleDigest | null>>({});
  const [digestsLoaded, setDigestsLoaded] = useState(false);

  // Sentence/word time windows for the speaking answer, built from the
  // canonical spoken doc + stashed alignment. Null until both are present.
  const timings: ReadAlongTimings | null = useMemo(() => {
    if (!speakingContent || !speakingAlignment) return null;
    return buildTimings(buildSpokenDoc(speakingContent), speakingAlignment);
  }, [speakingContent, speakingAlignment]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakAbortRef = useRef<AbortController | null>(null);
  // The KB row that opened the drawer, so focus returns there on close.
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

  // Prefetch the per-article digests once, in the background.
  useEffect(() => {
    fetch('/api/digest')
      .then((r) => r.json())
      .then((d: { digests?: Record<string, ArticleDigest | null> }) => setDigests(d.digests ?? {}))
      .catch(console.error)
      .finally(() => setDigestsLoaded(true));
  }, []);

  function clearSpeaking() {
    setSpeakingContent(null);
    setSpeakingAlignment(null);
    setAudioEl(null);
  }

  function stopAudio() {
    speakAbortRef.current?.abort();
    audioRef.current?.pause();
    clearSpeaking();
  }

  /** Fetch speech for `content` and play it, wiring the read-along state. */
  const speak = useCallback(async (content: string, signal?: AbortSignal) => {
    const spokenText = buildSpokenDoc(content).spokenText;
    const res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: spokenText }),
      signal,
    });
    if (!res.ok) {
      clearSpeaking();
      return;
    }
    const { audioBase64, alignment, chunkMeta } = (await res.json()) as SpeakResult;
    const audio = new Audio(audioUrlFromBase64(audioBase64));
    audioRef.current = audio;
    audio.addEventListener(
      'loadedmetadata',
      () => {
        const totalSec = alignment?.charEndTimesSec.length ? Math.max(...alignment.charEndTimesSec) : 0;
        const { level, message } = driftCheck(audio.duration, totalSec, chunkMeta);
        console[level](message);
      },
      { once: true },
    );
    audio.onplay = () => {
      setSpeakingContent(content);
      setSpeakingAlignment(alignment);
      setAudioEl(audio);
    };
    audio.onended = clearSpeaking;
    audio.onpause = clearSpeaking;
    audio.play().catch(clearSpeaking);
  }, []);

  const playVoice = useCallback(
    async (content: string) => {
      audioRef.current?.pause();
      try {
        await speak(content);
      } catch (err) {
        console.error('[voice]', err);
        clearSpeaking();
      }
    },
    [speak],
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

        const sourceSlugs = res.headers.get('X-Sources')?.split(',').filter(Boolean);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let full = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          setMessages([...history, { role: 'assistant', content: full, sources: sourceSlugs }]);
        }

        await playVoice(full);
      } catch (err) {
        console.error('[chat]', err);
        setMessages([...history, { role: 'assistant', content: ERROR_ROW, error: true }]);
      } finally {
        setIsLoading(false);
      }
    },
    [input, isLoading, isListening, messages, playVoice],
  );

  function handleNewChat() {
    stopAudio();
    setMessages([]);
    setInput('');
  }

  function openArticle(article: Article, trigger: HTMLButtonElement | null) {
    drawerTriggerRef.current = trigger;
    setActiveArticle(article);
    setDrawerOpen(true);
    // Mobile master→detail: the KB overlay sits above the drawer, so dismiss it
    // when an article opens. No-op on desktop, where they sit side by side.
    if (isMobile) setSidebarOpen(false);
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
    void speak(content, controller.signal).catch((err: unknown) => {
      if ((err as Error).name === 'AbortError') return;
      console.error('[voice]', err);
      clearSpeaking();
    });
  }

  const textMode = inputMode === 'text' || !voiceSupported;
  const inConversation = messages.length > 0;
  // The orb starts centre stage and leaves it as the first answer begins (or
  // when the text line is asked for, since the orb is that line's mic).
  const pose: OrbPose = inConversation || textMode ? 'home' : 'centre';
  const showFoot = pose === 'home';

  return (
    <div className={`app${sidebarOpen ? '' : ' sidebar-collapsed'}`}>
      <Rail
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        inputMode={textMode ? 'text' : 'voice'}
        voiceUnavailable={!voiceSupported}
        onSetInputMode={setInputMode}
        onNewChat={handleNewChat}
      />
      {isMobile && sidebarOpen && (
        <div className="scrim" aria-hidden="true" onClick={() => setSidebarOpen(false)} />
      )}
      <Sidebar
        articles={articles}
        articlesLoading={articlesLoading}
        activeUrl={drawerOpen ? activeArticle?.url ?? null : null}
        collapsed={!sidebarOpen}
        onRefresh={loadArticles}
        onOpenArticle={openArticle}
        swipeHandlers={sidebarSwipe}
      />

      <main className="main" ref={mainRef}>
        <Thread
          messages={messages}
          isLoading={isLoading}
          articles={articles}
          speakingContent={speakingContent}
          readAlong={readAlong}
          timings={timings}
          audio={audioEl}
          orbHere={pose === 'centre'}
          onAsk={(q) => void sendMessage(q)}
          onReadAloud={readAloud}
          onStopAudio={stopAudio}
          onOpenSource={(a) => openArticle(a, null)}
        />

        {showFoot && (
          <div className="foot">
            <div className="foot-slot" data-orb-anchor="home" aria-hidden="true" />
            {textMode && (
              <Composer
                input={input}
                setInput={setInput}
                isLoading={isLoading}
                onSend={(override) => void sendMessage(override)}
              />
            )}
            <p className="foot-note">Answers are grounded in the Claude blog and may be imperfect.</p>
          </div>
        )}

        <OrbStage
          planeRef={mainRef}
          pose={pose}
          isMobile={isMobile}
          input={input}
          setInput={setInput}
          isLoading={isLoading}
          listening={isListening}
          setListening={setIsListening}
          onSend={(override) => void sendMessage(override)}
          speaking={!!speakingContent}
          onStartListening={stopAudio}
          onSupportedChange={setVoiceSupported}
        />
      </main>

      <ArticleDrawer
        article={activeArticle}
        digest={activeArticle ? digests[activeArticle.url] ?? null : null}
        digestsLoaded={digestsLoaded}
        open={drawerOpen}
        onClose={closeDrawer}
        swipeHandlers={drawerSwipe}
        onAsk={(q) => {
          closeDrawer();
          void sendMessage(q);
        }}
      />
    </div>
  );
}
