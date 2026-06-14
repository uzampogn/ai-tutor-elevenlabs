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
}: {
  active?: boolean;
  audio: HTMLAudioElement | null;
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
