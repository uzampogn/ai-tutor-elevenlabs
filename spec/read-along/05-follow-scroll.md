# Spec 05 — Follow-scroll (keep the active sentence in a reading band)

**Series:** [Read-Along TTS](./00-overview.md) · **Milestone:** Solution 3.5 (completes it)
**Status:** 📋 Proposed · **Date:** 2026-06-14
**Depends on:** `04` · **Unblocks:** `06`
**User-visible change:** the view now **follows** the voice — as the spoken sentence moves down the answer, the page scrolls to keep it in a comfortable reading band.

---

## Goal

Extend the Spec 04 controller from "scroll once to the start" to "**continuously follow**": as `.s-active` advances through a long answer, smoothly scroll `.scroll` so the active sentence stays in a stable reading band (~⅓ down the viewport) instead of drifting off-screen. This completes **Solution 3.5**.

---

## Context

- Spec 04 gives us: the active sentence index per frame, the speaking `rowEl`, and the `.scroll` container (`globals.css:225`). Scroll-to-start already fires on play.
- We must avoid two failure modes that make follow-scroll feel bad: **jitter** (re-scrolling every few px) and **fighting the user** (the user-override that resolves this is Spec 06; this spec must at least not scroll *constantly*).

---

## Design

### Reading band
Define a target band as a fraction of the `.scroll` viewport height:
- `BAND_TOP ≈ 0.30`, `BAND_BOTTOM ≈ 0.55` (active sentence comfortable in the upper-middle, with context above and room below).
- Each time `.s-active` **changes** (not every frame), measure the active span's position within `.scroll`. If its top is **outside** the band, scroll so it lands at `BAND_TOP`. If it's already inside the band, **do nothing** (prevents micro-jitter on every sentence).

```
desiredScrollTop = activeSpan.offsetTop(relative to .scroll content) - scrollEl.clientHeight * BAND_TOP
scroll only if current position puts the span outside [BAND_TOP, BAND_BOTTOM]
```

### Smoothness & cadence
- Scroll on **sentence change only**, not per rAF frame — sentences are the natural cadence and this is inherently gentle.
- `behavior:'smooth'` under `no-preference`; `'auto'` (instant) under reduced-motion. Under reduced-motion, prefer the lightest correction — or only re-center when the active sentence would otherwise be fully off-screen (avoid motion the user opted out of).
- Long sentences (taller than the band) → align their **top** to `BAND_TOP`; never try to fit a too-tall sentence fully.
- Respect the end: when the last sentences are near the bottom of the thread, allow natural bottoming-out (don't over-scroll past content).

### Coordinate with scroll-to-start
- Scroll-to-start (Spec 04) is just the band logic applied to sentence 0 with a smaller top fraction (overview headroom). Unify them: scroll-to-start = "ensure sentence 0 is at the start band"; follow = "keep sentence k in the band." Same primitive, one code path.

### Programmatic-scroll bookkeeping (sets up Spec 06)
- Tag every scroll this controller initiates (e.g. set `isAutoScrolling=true` for the duration of the smooth scroll, cleared on `scrollend` or a short timeout). Spec 06 uses this to tell *its own* scrolls apart from the *user's*. Implement the flag here even though nothing reads it yet — it makes Spec 06 a clean addition.

---

## Test plan

### Component — `useReadAlong.test.tsx` (extend Spec 04's harness)
Mock `scrollEl` with controllable `clientHeight`/`scrollTop` and active-span `offsetTop` (via stubbed `getBoundingClientRect`/layout).
| Assert | Detail |
|---|---|
| Follows on change | When the active sentence moves and its position is below the band, `scrollEl` scrolls so the span lands at ~`BAND_TOP`. |
| No jitter | When the next active sentence is already within the band, **no** scroll call is made. |
| Scroll cadence | At most one scroll per sentence change (not per frame). |
| Reduced-motion | `behavior:'auto'`; minimal/threshold-only correction under the reduce mock. |
| End-of-thread | Near the bottom, no over-scroll past content. |
| Auto-scroll flag | `isAutoScrolling` is set during a controller scroll and cleared after (asserted for Spec 06's benefit). |

### Manual / Playwright
- Long answer: as TTS reads, the highlighted sentence stays in the upper-middle band; scrolling is stepwise and smooth, not jittery; reduced-motion makes it instant/minimal. Short answer that fits one screen: no scrolling occurs at all after the initial start.

---

## Definition of Done
- Active sentence stays within the reading band throughout a long answer; no per-frame jitter; one scroll per sentence-change max.
- Scroll-to-start and follow share one band primitive.
- Reduced-motion honored; `isAutoScrolling` flag in place for Spec 06.
- **Solution 3.5 is feature-complete** behind `readAlong:'sentence'`. `test:run` / `tsc` / `build` green.

---

## Files touched
- **Modified:** `src/components/main/useReadAlong.ts` (band logic + `isAutoScrolling` flag, unify with scroll-to-start), `src/components/main/useReadAlong.test.tsx`.
- (No new files; this is a focused extension of the Spec 04 controller.)

---

## Out of scope
- Detecting/honoring **user** scrolling (pausing follow, resume affordance) — Spec `06`.
- Word-level granularity — Spec `07`.
