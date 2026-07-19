'use client';

// Spec 04 + 05 — Read-along controller (sentence highlight + follow-scroll).
//
// Drives the first user-visible read-along: while audio plays, the spoken
// sentence is highlighted (`.s-active`), already-spoken sentences get a subtle
// "read" treatment (`.s-read`), and the view *follows* the voice — keeping the
// active sentence inside a comfortable reading band as it advances down a long
// answer (Spec 05, completing Solution 3.5). The first sentence is brought to
// the top once on play; thereafter each sentence change nudges the band only
// when the active sentence has drifted out of it (no per-frame jitter).
//
// Design constraints (see spec/read-along/04-*, /05-* and 00-overview):
//   - Highlight is CSS-class toggling on the STABLE `[data-s]` spans already in
//     the DOM (from Spec 01) — never a React re-render / re-order of text nodes
//     (a11y: aria-live container must not be spammed; perf).
//   - A requestAnimationFrame loop (not `timeupdate`, which is ~4×/s) reads
//     `audio.currentTime` each frame and maps it to a sentence via the pure
//     `activeIndexAt` from Spec 03.
//   - Scroll is driven by the SAME band primitive for both scroll-to-start and
//     follow (`scrollSpanIntoBand`). It runs on SENTENCE CHANGE ONLY (not every
//     frame), at most once per change, and only when the active span sits
//     outside the band — so it never fights itself or micro-jitters.
//   - `behavior:'smooth'` normally; `'auto'` under `prefers-reduced-motion:
//     reduce`, where we also correct only when the sentence is fully outside the
//     band (threshold-only, the lightest motion the user opted into).
//   - `desiredScrollTop` is clamped to `[0, scrollHeight - clientHeight]` so the
//     thread bottoms out naturally near the end (no over-scroll past content).
//   - `isAutoScrolling` is raised for the duration of a controller scroll and
//     cleared on `scrollend` (or a short timeout fallback). Nothing reads it
//     yet — it lets Spec 06 tell controller scrolls from user scrolls.
//   - Inert when `active` is false or any of `audio`/`timings`/`rowEl` is null:
//     nothing is touched, equivalent to today's behavior (`readAlong:'off'`).
//   - Enhancement, never a blocker: missing/short timings still leave audio
//     playing and text fully readable.

import { useEffect, useRef, type MutableRefObject } from 'react';
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
  /**
   * Optional out-ref mirrored true while a controller-initiated scroll is in
   * flight, false otherwise (Spec 05 bookkeeping). Spec 06 passes a ref here and
   * reads it inside its own scroll-event listener to tell controller scrolls
   * from user scrolls; nothing reads it in this spec.
   */
  autoScrollingRef?: MutableRefObject<boolean>;
}

// ── Reading band (Spec 05) ──────────────────────────────────────────────────
// The active sentence is "comfortable" anywhere in [BAND_TOP, BAND_BOTTOM] of
// the scroll viewport. When it drifts outside, we scroll it back to BAND_TOP.
const BAND_TOP = 0.3; // active sentence sits ~⅓ down — context above, room below.
const BAND_BOTTOM = 0.55;

/** Fraction the FIRST sentence sits from the top on scroll-to-start. */
const SCROLL_TOP_FRACTION = 0.14; // ~14% — a little extra headroom on play.

/** Fallback to clear `isAutoScrolling` if the `scrollend` event never fires. */
const AUTO_SCROLL_TIMEOUT_MS = 700;

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
  autoScrollingRef,
}: UseReadAlongArgs): void {
  // Last active sentence index — the forward-scan hint for activeIndexAt and the
  // value we diff against so we only touch classes that actually changed.
  const lastIndexRef = useRef<number>(-1);
  // rAF handle so we can cancel on cleanup.
  const rafRef = useRef<number | null>(null);
  // Once-guard for scroll-to-start (per playback).
  const didScrollRef = useRef<boolean>(false);
  // Raised while a controller-initiated scroll is in flight (for Spec 06 to tell
  // its own scrolls from the user's). Owned here; mirrored to the caller's
  // `autoScrollingRef` when one is provided.
  const ownAutoScrollingRef = useRef<boolean>(false);
  // Fallback timer that clears `isAutoScrolling` if `scrollend` never arrives.
  const autoScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Inert: do nothing and leave the DOM untouched. Equivalent to today.
    if (!active || !audio || !timings || !rowEl || granularity !== 'sentence') {
      return;
    }

    const sentences = timings.sentences;
    const spans = Array.from(rowEl.querySelectorAll<HTMLElement>('[data-s]'));
    // Parallel to `spans` — each span's sentence id, read once up front. Block-
    // structured rendering (DocBlocks) means a span's DOM position no longer
    // always equals its sentence id (list items, future filtered regions), so
    // matching must go by id, not position.
    const spanIds = spans.map((el) => Number(el.dataset.s));

    /** Clear every read-along class from this row's sentence spans. */
    function clearClasses() {
      for (const span of spans) span.classList.remove('s-active', 's-read');
    }

    /** Reflect active sentence id `activeId` onto the spans by `data-s` match. */
    function applyIndex(activeId: number) {
      for (let k = 0; k < spans.length; k++) {
        const sid = spanIds[k];
        const span = spans[k];
        if (sid === activeId) {
          span.classList.add('s-active');
          span.classList.remove('s-read');
        } else if (sid < activeId) {
          span.classList.add('s-read');
          span.classList.remove('s-active');
        } else {
          span.classList.remove('s-active', 's-read');
        }
      }
    }

    /** Set the auto-scroll flag and mirror it to the caller's ref (Spec 06). */
    function setAutoScrolling(value: boolean) {
      ownAutoScrollingRef.current = value;
      if (autoScrollingRef) autoScrollingRef.current = value;
    }

    /** Clear the auto-scroll flag + any pending fallback timer/listener. */
    function clearAutoScroll() {
      setAutoScrolling(false);
      if (autoScrollTimerRef.current != null) {
        clearTimeout(autoScrollTimerRef.current);
        autoScrollTimerRef.current = null;
      }
      scrollEl?.removeEventListener('scrollend', clearAutoScroll);
    }

    /**
     * Tag the scroll we're about to issue as controller-initiated. Cleared on
     * the next `scrollend`, or — for jsdom/older browsers that never fire it,
     * and for `behavior:'auto'` which finishes synchronously — a short timeout.
     */
    function markAutoScroll() {
      setAutoScrolling(true);
      if (autoScrollTimerRef.current != null) clearTimeout(autoScrollTimerRef.current);
      scrollEl?.addEventListener('scrollend', clearAutoScroll, { once: true });
      autoScrollTimerRef.current = setTimeout(clearAutoScroll, AUTO_SCROLL_TIMEOUT_MS);
    }

    /**
     * The band primitive — the ONE code path both scroll-to-start and follow
     * route through. Measures `span`'s top within the scroll viewport; if it
     * lands outside the band, scrolls so it sits at `topFraction`. Otherwise
     * does nothing (no jitter). At most one `scrollTo` per call.
     *
     * @param span        the span element to place.
     * @param topFraction where the span lands when we DO scroll (band's top).
     * @param bottomFraction lower edge of the "leave it alone" band.
     * @param reduceFloor when reduced-motion is on, only correct if the span has
     *        drifted past this fraction (threshold-only — lightest correction).
     * @param always when true, skip the in-band check and always reposition.
     *        Scroll-to-start uses this to guarantee one scroll per playback even
     *        when the span already sits near the top (and so the test harness's
     *        zero-height jsdom layout still produces the scroll Spec 04 asserts).
     */
    function scrollSpanIntoBand(
      span: HTMLElement | undefined,
      topFraction: number,
      bottomFraction: number,
      reduceFloor: number,
      always = false,
    ) {
      if (!scrollEl) return;
      if (!span) return;

      const reduce = prefersReducedMotion();
      const h = scrollEl.clientHeight;
      // Span top relative to the scroll viewport's top edge.
      const containerTop = scrollEl.getBoundingClientRect().top;
      const spanTop = span.getBoundingClientRect().top - containerTop;

      // Inside the band → leave it alone (prevents micro-jitter). Under
      // reduced-motion, widen the "leave alone" zone to a threshold so we only
      // move when the sentence would otherwise be (near) off-screen.
      const lower = (reduce ? 0 : topFraction) * h;
      const upper = (reduce ? reduceFloor : bottomFraction) * h;
      if (!always && spanTop >= lower && spanTop <= upper) return;

      // Where we want the span: at `topFraction` down from the container top.
      // Convert that viewport-relative target into an absolute scrollTop, then
      // clamp to real content bounds so we never over-scroll past the thread.
      const desiredScrollTop = scrollEl.scrollTop + spanTop - h * topFraction;
      const maxScrollTop = Math.max(0, scrollEl.scrollHeight - h);
      const top = Math.max(0, Math.min(desiredScrollTop, maxScrollTop));

      const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth';
      markAutoScroll();
      scrollEl.scrollTo({ top, behavior });
    }

    /** Scroll the row's first `[data-s]` toward the top once, on play. */
    function scrollToStart() {
      if (didScrollRef.current) return;
      didScrollRef.current = true;
      // Same band primitive, with the smaller top fraction for play headroom.
      // `always` so the first sentence is brought to the start once per playback
      // regardless of where it currently sits.
      scrollSpanIntoBand(spans[0], SCROLL_TOP_FRACTION, BAND_BOTTOM, BAND_BOTTOM, true);
    }

    /** Keep the active sentence in the band — runs on sentence change only. */
    function followToBand(activeId: number) {
      if (activeId < 0) return;
      const span = spans[spanIds.indexOf(activeId)];
      if (!span) return; // no rendered span for this id (filtered/unwrapped sentence)
      scrollSpanIntoBand(span, BAND_TOP, BAND_BOTTOM, BAND_BOTTOM);
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
        const activeId = i >= 0 ? sentences[i].id : -1;
        applyIndex(activeId);
        lastIndexRef.current = i;
        // Follow on sentence change only — never per frame (cadence + no jitter).
        followToBand(activeId);
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    /** Start (or restart) tracking + scroll-to-start. */
    function onPlay() {
      scrollToStart();
      // Prime the highlight immediately, then run the loop.
      const i = activeIndexAt(sentences, audio?.currentTime ?? 0, lastIndexRef.current);
      if (i !== lastIndexRef.current) {
        const activeId = i >= 0 ? sentences[i].id : -1;
        applyIndex(activeId);
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
      clearAutoScroll();
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
  }, [active, audio, timings, rowEl, scrollEl, granularity, autoScrollingRef]);
}

export default useReadAlong;
