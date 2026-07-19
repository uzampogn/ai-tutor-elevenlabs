# Spec 07 — Word-level highlight (Solution 3)

**Series:** [Read-Along TTS](./00-overview.md) · **Milestone:** Solution 3
**Status:** 📋 Proposed · **Date:** 2026-06-14
**Depends on:** `01`–`06` · **Unblocks:** `08` (optional)
**User-visible change:** behind `readAlong:'word'`, the **exact word** being spoken lights up (karaoke), within a softly-emphasized active sentence; degrades to sentence-level on reduced-motion/small screens.

---

## Goal

Upgrade the highlight from sentence to **word** granularity using the per-word timings that Spec 03 already computes. This is the premium "Immersive Reader / Audible Captions" tier. The infrastructure (timings, controller, follow-scroll, override, spans) all exist — this spec adds word tracking, flicker control, sub-sentence emphasis, and graceful degradation.

---

## Context

- `ReadAlongTimings.words` is already produced by Spec 03 (computed, unused until now).
- `[data-w]` word spans already exist in the DOM from Spec 01.
- The controller `useReadAlong` (Specs 04–06) already runs a rAF loop, owns the active **sentence**, does follow-scroll, and honors user override. This spec extends it with a `granularity:'word'` path.
- `ReadAlongTimings` may be flagged `estimated:true` (Spec 03 fallback) when char alignment was unavailable — word-level must **not** engage on estimated timings (too jittery); fall back to sentence.

---

## Design

### Word tracking
- When `granularity:'word'` and timings are **not** estimated: each rAF frame, compute `wi = activeIndexAt(timings.words, currentTime, lastWi)` and toggle `.w-active` on word `wi`, `.w-read` on words `< wi` (within already-read sentences or earlier in the current one).
- **Keep the sentence layer too:** the active sentence retains a softer `.s-active` (context band) while the active **word** gets the strong emphasis. This dual layer is what makes word-karaoke readable rather than a lone jumping highlight.

### Flicker / jitter control (the make-or-break detail)
- **Class toggles only**, never text re-render (a11y + perf, per overview).
- **Minimum on-screen duration:** very short words (articles, ~60–90ms) can flash. Enforce a floor (e.g. don't advance `.w-active` faster than ~70ms) or visually merge sub-threshold words into the next — tune by feel. Avoid animating the highlight position; a discrete background/weight change reads calmer than a sliding bar at word speed.
- **rAF, not `timeupdate`** (already the case from Spec 04) — `timeupdate`'s ~4Hz is far too coarse for words.
- Only mutate the DOM when `wi` actually changes (track `lastWi`); never touch all spans every frame.

### Follow-scroll keys to the sentence, not the word
- Reuse Spec 05's band logic **at sentence granularity** — scroll when the active **sentence** changes, never per word. Per-word scrolling would be nauseating. (No change to the scroll cadence from 05.)

### Degradation (required)
Fall back to **sentence-level** (Spec 04 behavior) when any of:
- `prefers-reduced-motion: reduce` (word flicker is motion-fatiguing),
- viewport ≤ 880px / coarse pointer (mobile — small text + word flicker is unpleasant; matches the app's existing 880px breakpoint),
- `timings.estimated === true` (no real char alignment),
- timings missing.
In these cases `.w-active` is never applied; the sentence highlight from Specs 04–05 carries the experience. This makes Solution 3 strictly additive over a solid 3.5 baseline.

### Styling (Aurora Mist locked — reuse tokens)
- `.w-active` — strongest emphasis: e.g. `--ink` weight bump or `--accent`/`--accent-2` background at higher alpha than `.s-active`. Must **not reflow** (no width-changing weight without `font-variation`/reserved space — prefer background + color, or `text-decoration`).
- `.w-read` — neutral/de-emphasized, consistent with `.s-read`.
- `.s-active` softens relative to Spec 04 so the word stands out within it (tune the two together).
- Transitions only under `no-preference`.

---

## Test plan

### Component — `useReadAlong.test.tsx` (extend, fake audio clock)
| Assert | Detail |
|---|---|
| Word tracking | At `currentTime` inside word k's window, `[data-w=k]` has `.w-active`; earlier words `.w-read`; the owning sentence has `.s-active`. |
| Advance | Stepping time advances `.w-active` one word at a time; only the changed spans are mutated (`lastWi` honored). |
| Min-duration | A sub-threshold word does not produce a 1-frame flash (the floor/merge behaves as specified). |
| Scroll cadence | Scroll fires on **sentence** change only, never per word (reuse Spec 05 assertions). |
| Degrade: reduced-motion | Reduce mock → no `.w-active` ever; sentence highlight active. |
| Degrade: small screen | `max-width:880px` matchMedia → sentence-level only. |
| Degrade: estimated | `timings.estimated=true` → sentence-level only. |
| Inherit override | User-scroll pause (Spec 06) still pauses follow while words keep highlighting. |

### Token regression — `globals.tokens.test.ts`
- `.w-active` / `.w-read` present; palette intact; no new accent hex.

### Manual / Playwright
- `readAlong:'word'` on desktop, motion allowed: the spoken word lights up smoothly within the active sentence; no flicker on small words; scrolling still steps by sentence. Toggle reduced-motion → reverts to sentence highlight. Resize ≤880px → sentence highlight.

---

## Definition of Done
- Word highlight tracks `audio.currentTime` accurately with no perceptible flicker; sentence context layer retained; follow-scroll stays sentence-paced.
- Degrades cleanly to sentence-level on reduced-motion, ≤880px, estimated, or missing timings.
- Inherits Spec 06 override unchanged. Token lock + a11y honored. `test:run` / `tsc` / `build` green.

---

## Files touched
- **Modified:** `src/components/main/useReadAlong.ts` (word path + flicker control + degradation gates), `src/components/main/useReadAlong.test.tsx`, `src/components/AppShell.tsx` (allow `readAlong:'word'`), `src/app/globals.css` (`.w-active`, `.w-read`; soften `.s-active`), `src/app/globals.tokens.test.ts`.

---

## Out of scope
- Streaming/progressive audio start — Spec `08`.
- Per-word follow-scroll (intentionally excluded — sentence-paced only).
