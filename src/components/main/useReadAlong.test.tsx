import React, { useRef, useState, useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useReadAlong } from './useReadAlong';
import type { ReadAlongTimings } from '@/lib/readAlong/timingMap';

// ── Fake audio clock ───────────────────────────────────────────────────────
// A plain object standing in for HTMLAudioElement: `currentTime` and `paused`
// are advanced/toggled by hand; `addEventListener` records handlers we fire
// manually. (Per guide §7 we hand-roll the element rather than use a real
// <audio>.)
type Handler = () => void;

class FakeAudio {
  currentTime = 0;
  paused = true;
  private handlers: Record<string, Handler[]> = {};

  addEventListener(type: string, fn: Handler) {
    (this.handlers[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: Handler) {
    this.handlers[type] = (this.handlers[type] ?? []).filter((h) => h !== fn);
  }
  /** Simulate playback starting. */
  firePlay() {
    this.paused = false;
    for (const h of this.handlers['play'] ?? []) h();
  }
  fireEnded() {
    this.paused = true;
    for (const h of this.handlers['ended'] ?? []) h();
  }
  firePause() {
    this.paused = true;
    for (const h of this.handlers['pause'] ?? []) h();
  }
}

// ── Stubbed rAF: step frames deterministically ─────────────────────────────
// requestAnimationFrame queues a callback we drain on demand via `flushFrames`,
// so the rAF loop advances exactly as many times as we choose.
let rafQueue: Map<number, FrameRequestCallback>;
let rafId: number;

function flushFrames(n: number) {
  for (let f = 0; f < n; f++) {
    const entries = Array.from(rafQueue.entries());
    rafQueue = new Map();
    for (const [, cb] of entries) cb(performance.now());
  }
}

// ── Timings fixture: 3 sentences, windows [0,1) [1,2) [2,3) ────────────────
const timings: ReadAlongTimings = {
  sentences: [
    { id: 0, startSec: 0, endSec: 1 },
    { id: 1, startSec: 1, endSec: 2 },
    { id: 2, startSec: 2, endSec: 3 },
  ],
  words: [],
  totalSec: 3,
};

// A tiny harness that renders a row of [data-s] spans + a scroll container and
// drives the hook. Exposes the audio + scroll element so tests can manipulate.
function Harness({
  active = true,
  audio,
  autoRef,
}: {
  active?: boolean;
  audio: HTMLAudioElement | null;
  /** Optional out-ref so tests can observe the `isAutoScrolling` flag. */
  autoRef?: React.MutableRefObject<boolean>;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);

  // Re-render once after mount so the hook picks up the attached refs (mirrors
  // the real Thread, where audio arrives after the refs are live).
  useEffect(() => {
    force((v) => v + 1);
  }, []);

  useReadAlong({
    active,
    audio,
    timings,
    rowEl: rowRef.current,
    scrollEl: scrollRef.current,
    granularity: 'sentence',
    autoScrollingRef: autoRef,
  });

  return (
    <div className="scroll" ref={scrollRef} data-testid="scroll">
      <div className="row row-ai" ref={rowRef} data-testid="row">
        <span className="s" data-s={0}>
          One.
        </span>{' '}
        <span className="s" data-s={1}>
          Two.
        </span>{' '}
        <span className="s" data-s={2}>
          Three.
        </span>
      </div>
    </div>
  );
}

function spanAt(i: number): HTMLElement {
  return document.querySelector(`[data-s="${i}"]`) as HTMLElement;
}

// ── Geometry harness (Spec 05) ─────────────────────────────────────────────
// jsdom has no layout, so we stamp controllable geometry onto the scroll
// container and each [data-s] span: the viewport height, current scrollTop,
// total scrollHeight, and where each span's top sits (in container-relative px).
// `scrollSpanIntoBand` reads `clientHeight`, `scrollTop`, `scrollHeight`,
// `scrollEl.getBoundingClientRect().top` and `span.getBoundingClientRect().top`,
// so those are exactly the knobs we override.
interface Layout {
  clientHeight: number;
  scrollTop: number;
  scrollHeight: number;
  /** container-relative top (px) of each [data-s] span, by index. */
  spanTops: number[];
}

const CONTAINER_TOP = 100; // arbitrary container viewport offset; cancels out.

/** Apply a layout to the live DOM so the hook measures what we want. */
function applyLayout(layout: Layout) {
  const scrollEl = document.querySelector('.scroll') as HTMLElement;
  Object.defineProperty(scrollEl, 'clientHeight', {
    configurable: true,
    get: () => layout.clientHeight,
  });
  Object.defineProperty(scrollEl, 'scrollHeight', {
    configurable: true,
    get: () => layout.scrollHeight,
  });
  // scrollTop is a real, settable property in jsdom; just assign it.
  scrollEl.scrollTop = layout.scrollTop;
  scrollEl.getBoundingClientRect = (() =>
    ({ top: CONTAINER_TOP }) as DOMRect) as HTMLElement['getBoundingClientRect'];

  for (let i = 0; i < layout.spanTops.length; i++) {
    const span = spanAt(i);
    if (!span) continue;
    const top = CONTAINER_TOP + layout.spanTops[i];
    span.getBoundingClientRect = (() =>
      ({ top }) as DOMRect) as HTMLElement['getBoundingClientRect'];
  }
}

/** The `top` value passed to the most recent scrollTo call. */
function lastScrollTop(): number {
  const call = scrollToSpy.mock.calls.at(-1);
  return (call?.[0] as { top: number }).top;
}

function classesOf(i: number): string[] {
  return Array.from(spanAt(i).classList).filter((c) => c === 's-active' || c === 's-read');
}

let scrollToSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  rafQueue = new Map();
  rafId = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++rafId;
    rafQueue.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafQueue.delete(id);
  });

  // Stub scrollTo on the scroll element. jsdom doesn't implement it.
  scrollToSpy = vi.fn();
  Element.prototype.scrollTo = scrollToSpy as unknown as Element['scrollTo'];

  // Default matchMedia: no reduced-motion (matches:false).
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useReadAlong — active sentence tracking', () => {
  it('inside sentence k: span k is .s-active, spans <k are .s-read, others neither', () => {
    const audio = new FakeAudio() as unknown as HTMLAudioElement;
    render(<Harness audio={audio} />);

    audio.currentTime = 1.5; // inside sentence 1
    act(() => (audio as unknown as FakeAudio).firePlay());

    expect(classesOf(0)).toEqual(['s-read']);
    expect(classesOf(1)).toEqual(['s-active']);
    expect(classesOf(2)).toEqual([]);
  });

  it('advances .s-active one boundary at a time as currentTime steps forward', () => {
    const audio = new FakeAudio() as unknown as HTMLAudioElement;
    const fake = audio as unknown as FakeAudio;
    render(<Harness audio={audio} />);

    fake.currentTime = 0.2;
    act(() => fake.firePlay());
    expect(classesOf(0)).toEqual(['s-active']);

    fake.currentTime = 1.2;
    act(() => flushFrames(1));
    expect(classesOf(0)).toEqual(['s-read']);
    expect(classesOf(1)).toEqual(['s-active']);
    expect(classesOf(2)).toEqual([]);

    fake.currentTime = 2.4;
    act(() => flushFrames(1));
    expect(classesOf(0)).toEqual(['s-read']);
    expect(classesOf(1)).toEqual(['s-read']);
    expect(classesOf(2)).toEqual(['s-active']);
  });
});

describe('useReadAlong — scroll-to-start', () => {
  it('fires once on first play targeting the scroll container, not again on later frames', () => {
    const audio = new FakeAudio() as unknown as HTMLAudioElement;
    const fake = audio as unknown as FakeAudio;
    render(<Harness audio={audio} />);

    fake.currentTime = 0;
    act(() => fake.firePlay());
    expect(scrollToSpy).toHaveBeenCalledTimes(1);

    // Subsequent frames advance the highlight but must NOT scroll again.
    fake.currentTime = 1.5;
    act(() => flushFrames(2));
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
  });

  it('uses behavior:"smooth" under no-preference', () => {
    const audio = new FakeAudio() as unknown as HTMLAudioElement;
    render(<Harness audio={audio} />);
    act(() => (audio as unknown as FakeAudio).firePlay());

    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
  });

  it('uses behavior:"auto" under prefers-reduced-motion: reduce', () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const audio = new FakeAudio() as unknown as HTMLAudioElement;
    render(<Harness audio={audio} />);
    act(() => (audio as unknown as FakeAudio).firePlay());

    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto' }),
    );
  });
});

describe('useReadAlong — cleanup', () => {
  it('clears classes and cancels rAF on ended', () => {
    const audio = new FakeAudio() as unknown as HTMLAudioElement;
    const fake = audio as unknown as FakeAudio;
    render(<Harness audio={audio} />);

    fake.currentTime = 1.5;
    act(() => fake.firePlay());
    expect(classesOf(1)).toEqual(['s-active']);

    act(() => fake.fireEnded());
    expect(classesOf(0)).toEqual([]);
    expect(classesOf(1)).toEqual([]);
    expect(classesOf(2)).toEqual([]);
    // The loop is cancelled: stepping frames does nothing.
    expect(rafQueue.size).toBe(0);
  });

  it('clears classes on pause', () => {
    const audio = new FakeAudio() as unknown as HTMLAudioElement;
    const fake = audio as unknown as FakeAudio;
    render(<Harness audio={audio} />);

    fake.currentTime = 2.4;
    act(() => fake.firePlay());
    expect(classesOf(2)).toEqual(['s-active']);

    act(() => fake.firePause());
    expect(classesOf(2)).toEqual([]);
    expect(rafQueue.size).toBe(0);
  });
});

describe('useReadAlong — inert when off', () => {
  it('active:false touches no classes and does not scroll', () => {
    const audio = new FakeAudio() as unknown as HTMLAudioElement;
    const fake = audio as unknown as FakeAudio;
    render(<Harness audio={audio} active={false} />);

    fake.currentTime = 1.5;
    act(() => fake.firePlay());

    expect(classesOf(0)).toEqual([]);
    expect(classesOf(1)).toEqual([]);
    expect(classesOf(2)).toEqual([]);
    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it('audio:null is inert', () => {
    render(<Harness audio={null} />);
    // Nothing rendered with read-along classes; no scroll.
    expect(classesOf(0)).toEqual([]);
    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});

// ── Spec 05 — follow-scroll (reading band) ─────────────────────────────────
// BAND_TOP=0.30, BAND_BOTTOM=0.55 of clientHeight. On sentence change only,
// if the active span sits outside the band, scroll it to BAND_TOP; if inside,
// do nothing. With h=1000 the band is [300, 550]px and BAND_TOP target is 300.
describe('useReadAlong — follow-scroll (band)', () => {
  function startPlaying(autoRef?: React.MutableRefObject<boolean>) {
    const audio = new FakeAudio() as unknown as HTMLAudioElement;
    const fake = audio as unknown as FakeAudio;
    render(<Harness audio={audio} autoRef={autoRef} />);
    return { audio, fake };
  }

  it('follows on change: a sentence below the band scrolls so its top lands at BAND_TOP', () => {
    const { fake } = startPlaying();

    // Sentence 0 sits comfortably; sentence 1 has drifted well below the band.
    applyLayout({
      clientHeight: 1000,
      scrollTop: 0,
      scrollHeight: 10000,
      spanTops: [200, 800, 1600],
    });

    fake.currentTime = 0.5; // sentence 0
    act(() => fake.firePlay());
    scrollToSpy.mockClear(); // ignore the one scroll-to-start call

    fake.currentTime = 1.5; // → sentence 1 (top 800, below BAND_BOTTOM*h=550)
    act(() => flushFrames(1));

    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    // desiredScrollTop = scrollTop(0) + spanTop(800) - h*BAND_TOP(300) = 500.
    expect(lastScrollTop()).toBe(500);
    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ top: 500, behavior: 'smooth' }),
    );
  });

  it('no jitter: when the next sentence is already inside the band, does not scroll', () => {
    const { fake } = startPlaying();

    // Sentence 1's top (400) sits inside the band [300, 550] → leave it alone.
    applyLayout({
      clientHeight: 1000,
      scrollTop: 0,
      scrollHeight: 10000,
      spanTops: [120, 400, 700],
    });

    fake.currentTime = 0.5;
    act(() => fake.firePlay());
    scrollToSpy.mockClear();

    fake.currentTime = 1.5; // → sentence 1, already in band
    act(() => flushFrames(1));

    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it('cadence: at most one scroll per sentence change, not per frame', () => {
    const { fake } = startPlaying();

    applyLayout({
      clientHeight: 1000,
      scrollTop: 0,
      scrollHeight: 10000,
      spanTops: [200, 800, 1600],
    });

    fake.currentTime = 0.5;
    act(() => fake.firePlay());
    scrollToSpy.mockClear();

    // Several frames all WITHIN sentence 1 — one sentence change, one scroll.
    fake.currentTime = 1.2;
    act(() => flushFrames(1));
    fake.currentTime = 1.5;
    act(() => flushFrames(1));
    fake.currentTime = 1.9;
    act(() => flushFrames(3));

    expect(scrollToSpy).toHaveBeenCalledTimes(1);
  });

  it('reduced-motion: behavior:auto and threshold-only (no scroll while within the wider band)', () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { fake } = startPlaying();

    // Under reduce the "leave alone" zone widens to [0, BAND_BOTTOM*h]=[0,550].
    // Sentence 1's top (500) is within it → no correction (motion avoided).
    applyLayout({
      clientHeight: 1000,
      scrollTop: 0,
      scrollHeight: 10000,
      spanTops: [50, 500, 1400],
    });

    fake.currentTime = 0.5;
    act(() => fake.firePlay());
    // scroll-to-start used behavior:auto under reduce.
    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto' }),
    );
    scrollToSpy.mockClear();

    fake.currentTime = 1.5; // sentence 1 within the widened band → no scroll
    act(() => flushFrames(1));
    expect(scrollToSpy).not.toHaveBeenCalled();

    // Sentence 2 (top 1400) is fully past the band → correct, instantly.
    fake.currentTime = 2.5;
    act(() => flushFrames(1));
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto' }),
    );
  });

  it('end-of-thread: desiredScrollTop is clamped so we never over-scroll past content', () => {
    const { fake } = startPlaying();

    // Thread is barely taller than the viewport: maxScrollTop = 1200-1000 = 200.
    applyLayout({
      clientHeight: 1000,
      scrollTop: 0,
      scrollHeight: 1200,
      spanTops: [100, 600, 950],
    });

    fake.currentTime = 0.5;
    act(() => fake.firePlay());
    scrollToSpy.mockClear();

    // Sentence 2 top=950 → raw desired = 0 + 950 - 300 = 650, but clamped to 200.
    fake.currentTime = 2.5;
    act(() => flushFrames(1));

    expect(lastScrollTop()).toBe(200);
  });
});

describe('useReadAlong — isAutoScrolling flag (for Spec 06)', () => {
  it('is set during a controller scroll and cleared on scrollend', () => {
    const autoRef = { current: false } as React.MutableRefObject<boolean>;
    const audio = new FakeAudio() as unknown as HTMLAudioElement;
    const fake = audio as unknown as FakeAudio;
    render(<Harness audio={audio} autoRef={autoRef} />);

    applyLayout({
      clientHeight: 1000,
      scrollTop: 0,
      scrollHeight: 10000,
      spanTops: [200, 800, 1600],
    });

    fake.currentTime = 0.5;
    act(() => fake.firePlay()); // scroll-to-start raises the flag
    expect(autoRef.current).toBe(true);

    // The container's scrollend marks the controller scroll as finished.
    const scrollEl = document.querySelector('.scroll') as HTMLElement;
    act(() => {
      scrollEl.dispatchEvent(new Event('scrollend'));
    });
    expect(autoRef.current).toBe(false);
  });

  it('is cleared by the timeout fallback when scrollend never fires', () => {
    vi.useFakeTimers();
    try {
      const autoRef = { current: false } as React.MutableRefObject<boolean>;
      const audio = new FakeAudio() as unknown as HTMLAudioElement;
      const fake = audio as unknown as FakeAudio;
      render(<Harness audio={audio} autoRef={autoRef} />);

      applyLayout({
        clientHeight: 1000,
        scrollTop: 0,
        scrollHeight: 10000,
        spanTops: [200, 800, 1600],
      });

      fake.currentTime = 0.5;
      act(() => fake.firePlay());
      expect(autoRef.current).toBe(true);

      // No scrollend; the fallback timeout clears the flag.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(autoRef.current).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is cleared on pause/cleanup', () => {
    const autoRef = { current: false } as React.MutableRefObject<boolean>;
    const audio = new FakeAudio() as unknown as HTMLAudioElement;
    const fake = audio as unknown as FakeAudio;
    render(<Harness audio={audio} autoRef={autoRef} />);

    applyLayout({
      clientHeight: 1000,
      scrollTop: 0,
      scrollHeight: 10000,
      spanTops: [200, 800, 1600],
    });

    fake.currentTime = 0.5;
    act(() => fake.firePlay());
    expect(autoRef.current).toBe(true);

    act(() => fake.firePause());
    expect(autoRef.current).toBe(false);
  });
});

// ── Spec 10 — matches spans by `data-s` id, not DOM position ───────────────
// With block-structured rendering (DocBlocks) a sentence's timing-array index
// no longer necessarily equals its span's DOM position: e.g. a sentence may be
// narrated (has a timing window) but not wrapped in its own `[data-s]` span
// (list items, future filtered regions). `timings` below is contiguous
// (ids 0, 1, 2 — id 1 IS a real timing window) but the DOM only renders spans
// for ids 0 and 2 — a deliberate gap. The active window at t=2.5 is array
// index 2; position-based mapping (`k === i`) would try to mark spans[2],
// which doesn't exist (spans.length is 2), so nothing goes active and both
// rendered spans wrongly fall to 's-read'. Id-based mapping must instead mark
// the span whose `data-s` equals the active sentence's id (2), regardless of
// its DOM position (1).
const gapTimings: ReadAlongTimings = {
  sentences: [
    { id: 0, startSec: 0, endSec: 1 },
    { id: 1, startSec: 1, endSec: 2 },
    { id: 2, startSec: 2, endSec: 3 },
  ],
  words: [],
  totalSec: 3,
};

function GapHarness({ audio }: { audio: HTMLAudioElement | null }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);

  useEffect(() => {
    force((v) => v + 1);
  }, []);

  useReadAlong({
    active: true,
    audio,
    timings: gapTimings,
    rowEl: rowRef.current,
    scrollEl: scrollRef.current,
    granularity: 'sentence',
  });

  return (
    <div className="scroll" ref={scrollRef} data-testid="scroll">
      <div className="row row-ai" ref={rowRef} data-testid="row">
        <span className="s" data-s={0}>
          Zero.
        </span>{' '}
        <span className="s" data-s={2}>
          Two.
        </span>
      </div>
    </div>
  );
}

describe('useReadAlong — matches spans by data-s id (not DOM position)', () => {
  it('id 2 (DOM position 1) goes active, id 0 goes read, when sentence id 1 has no span', () => {
    const audio = new FakeAudio() as unknown as HTMLAudioElement;
    const fake = audio as unknown as FakeAudio;
    render(<GapHarness audio={audio} />);

    fake.currentTime = 2.5; // inside sentence id 2's window; array index 2
    act(() => fake.firePlay());

    expect(classesOf(2)).toEqual(['s-active']);
    expect(classesOf(0)).toEqual(['s-read']);
  });
});
