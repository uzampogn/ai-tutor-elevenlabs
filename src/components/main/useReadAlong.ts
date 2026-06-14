'use client';

// Spec 04 — Read-along controller (sentence highlight + scroll-to-start).
//
// Drives the first user-visible read-along: while audio plays, the spoken
// sentence is highlighted (`.s-active`), already-spoken sentences get a subtle
// "read" treatment (`.s-read`), and on the first playing frame the view scrolls
// once so the answer's first sentence sits near the top of the thread.
//
// Design constraints (see spec/read-along/04-* and 00-overview):
//   - Highlight is CSS-class toggling on the STABLE `[data-s]` spans already in
//     the DOM (from Spec 01) — never a React re-render / re-order of text nodes
//     (a11y: aria-live container must not be spammed; perf).
//   - A requestAnimationFrame loop (not `timeupdate`, which is ~4×/s) reads
//     `audio.currentTime` each frame and maps it to a sentence via the pure
//     `activeIndexAt` from Spec 03.
//   - Scroll-to-start fires once per playback. `behavior:'smooth'` normally,
//     `'auto'` under `prefers-reduced-motion: reduce`.
//   - Inert when `active` is false or any of `audio`/`timings`/`rowEl` is null:
//     nothing is touched, equivalent to today's behavior (`readAlong:'off'`).
//   - Enhancement, never a blocker: missing/short timings still leave audio
//     playing and text fully readable.

import { useEffect, useRef } from 'react';
import { activeIndexAt, type ReadAlongTimings } from '@/lib/readAlong/timingMap';

interface UseReadAlongArgs {
  /** readAlong !== 'off' AND this message is the one speaking. */
  active: boolean;
  /** The element AppShell created for this playback (or null when none). */
  audio: HTMLAudioElement | null;
  /** Sentence/word time windows for the speaking answer (Spec 03). */
  timings: ReadAlongTimings | null;
  /** The speaking AiRow's root element (holds the `[data-s]` spans). */
  rowEl: HTMLElement | null;
  /** The `.scroll` container that scroll-to-start moves. */
  scrollEl: HTMLElement | null;
  /** 'sentence' here; 'word' lands in Spec 07. */
  granularity: 'sentence';
}

/** Fraction of the scroll viewport the first sentence should sit from the top. */
const SCROLL_TOP_FRACTION = 0.14; // ~14% — a little headroom above the line.

/** True when the user has asked the OS to reduce motion. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function useReadAlong({
  active,
  audio,
  timings,
  rowEl,
  scrollEl,
  granularity,
}: UseReadAlongArgs): void {
  // Last active sentence index — the forward-scan hint for activeIndexAt and the
  // value we diff against so we only touch classes that actually changed.
  const lastIndexRef = useRef<number>(-1);
  // rAF handle so we can cancel on cleanup.
  const rafRef = useRef<number | null>(null);
  // Once-guard for scroll-to-start (per playback).
  const didScrollRef = useRef<boolean>(false);

  useEffect(() => {
    // Inert: do nothing and leave the DOM untouched. Equivalent to today.
    if (!active || !audio || !timings || !rowEl || granularity !== 'sentence') {
      return;
    }

    const sentences = timings.sentences;
    const spans = Array.from(rowEl.querySelectorAll<HTMLElement>('[data-s]'));

    /** Clear every read-along class from this row's sentence spans. */
    function clearClasses() {
      for (const span of spans) span.classList.remove('s-active', 's-read');
    }

    /** Reflect active sentence index `i` onto the spans (idempotent per frame). */
    function applyIndex(i: number) {
      for (let k = 0; k < spans.length; k++) {
        const span = spans[k];
        if (k === i) {
          span.classList.add('s-active');
          span.classList.remove('s-read');
        } else if (k < i) {
          span.classList.add('s-read');
          span.classList.remove('s-active');
        } else {
          span.classList.remove('s-active', 's-read');
        }
      }
    }

    /** Scroll the row's first `[data-s]` to ~14% from the top of `scrollEl`. */
    function scrollToStart() {
      if (didScrollRef.current || !scrollEl) return;
      didScrollRef.current = true;
      const first = spans[0];
      if (!first) return;
      const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
      // Position the first span SCROLL_TOP_FRACTION down from the container top.
      const containerRect = scrollEl.getBoundingClientRect();
      const spanRect = first.getBoundingClientRect();
      const headroom = scrollEl.clientHeight * SCROLL_TOP_FRACTION;
      const target =
        scrollEl.scrollTop + (spanRect.top - containerRect.top) - headroom;
      scrollEl.scrollTo({ top: Math.max(0, target), behavior });
    }

    /** One animation frame: map currentTime → sentence, update classes. */
    function tick() {
      // Stop looping once paused/ended; cleanup handlers do the class clearing.
      if (!audio || audio.paused) {
        rafRef.current = null;
        return;
      }
      const i = activeIndexAt(sentences, audio.currentTime, lastIndexRef.current);
      if (i !== lastIndexRef.current) {
        applyIndex(i);
        lastIndexRef.current = i;
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    /** Start (or restart) tracking + scroll-to-start. */
    function onPlay() {
      scrollToStart();
      // Prime the highlight immediately, then run the loop.
      const i = activeIndexAt(sentences, audio?.currentTime ?? 0, lastIndexRef.current);
      if (i !== lastIndexRef.current) {
        applyIndex(i);
        lastIndexRef.current = i;
      }
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    /** Stop tracking and clear visual state (pause/ended). */
    function onStop() {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      clearClasses();
      lastIndexRef.current = -1;
      didScrollRef.current = false;
    }

    audio.addEventListener('play', onPlay);
    audio.addEventListener('ended', onStop);
    audio.addEventListener('pause', onStop);

    // If audio is already playing when we attach (the element fires `play`
    // before this effect mounts), start immediately so we don't miss it.
    if (!audio.paused) onPlay();

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('ended', onStop);
      audio.removeEventListener('pause', onStop);
      onStop();
    };
  }, [active, audio, timings, rowEl, scrollEl, granularity]);
}

export default useReadAlong;
