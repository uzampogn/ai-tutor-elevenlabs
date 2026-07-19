# Spec 04 — Sentence highlight + scroll-to-start

**Series:** [Read-Along TTS](./00-overview.md) · **Milestone:** Solution 3.5
**Status:** 📋 Proposed · **Date:** 2026-06-14
**Depends on:** `01`, `02`, `03` · **Unblocks:** `05`, `07`
**User-visible change:** **first visible read-along** — when voice starts, the view jumps to the answer's first line and the spoken sentence highlights, advancing with the audio.

---

## Goal

Wire the timing map into playback so that, behind `readAlong:'sentence'`:
1. **On playback start**, the thread scrolls so the **first line of the answer being read** sits near the top of the viewport (the literal "scroll up to the beginning of the text" requirement).
2. **As audio plays**, the sentence currently being spoken gets a highlight; already-spoken sentences get a subtle "read" treatment; upcoming ones are normal. The highlight advances in lockstep with `audio.currentTime`.

Continuous follow-scroll (keeping the active sentence in a reading band as it moves down the page) is the **next** spec (`05`); this spec only does the one-time scroll-to-start so it's shippable and testable on its own.

---

## Context

- The speaking message is identified today by `speakingContent === msg.content` (`Thread.tsx:41`). We now also have, in state (Spec 02), the `alignment` for that message, and can build `ReadAlongTimings` (Spec 03).
- The scroll container is `.scroll` (`globals.css:225`, `overflow-y:auto`); the answer lives in `.thread` (`:232`). `Thread.tsx:22` currently force-scrolls to `bottomRef` on every `messages` change — **this fights scroll-to-start** and must be suppressed while a read-along is active.
- Sentence/word spans (`[data-s]`, `[data-w]`) already exist in the DOM from Spec 01.
- Reduced-motion is gated at `globals.css:714`; honor it.

---

## Design

### The read-along controller (new hook)

```ts
// src/components/main/useReadAlong.ts (client hook)
useReadAlong({
  active: boolean,                 // readAlong !== 'off' && this message is speaking
  audio: HTMLAudioElement | null,  // the element AppShell created
  timings: ReadAlongTimings | null,
  rowEl: HTMLElement | null,       // the speaking AiRow
  scrollEl: HTMLElement | null,    // the .scroll container
  granularity: 'sentence',         // 'word' added in Spec 07
})
```

Responsibilities:
- **Drive the clock.** Use a `requestAnimationFrame` loop while `!audio.paused` (preferred over `timeupdate`, which fires only ~4×/s — too coarse for smooth highlight). Each frame: `i = activeIndexAt(timings.sentences, audio.currentTime, lastI)`.
- **Toggle classes** on the sentence spans within `rowEl`: add `.s-active` to sentence `i`, `.s-read` to sentences `< i`, clear the rest. Toggle via `classList` on the existing spans — **no React re-render of text** (a11y + perf; see overview).
- **Scroll-to-start once.** On the first frame where audio is playing (or on `audio.onplay`), scroll `scrollEl` so the **first** `[data-s]` of `rowEl` is near the top (e.g. ~12–16% down, leaving a little headroom). Use `behavior:'smooth'` normally, `'auto'` under reduced-motion. Guard so it fires once per playback, not every frame.
- **Cleanup.** On `audio.onended`/`onpause`/unmount or when `active` flips false: cancel the rAF, clear all `.s-active`/`.s-read`. (Mirror the existing `onended`/`onpause` resets at `AppShell.tsx:69`/`165`.)

### Suppress the bottom-pin during read-along
`Thread.tsx:22` must **not** scroll-to-bottom while a read-along is active. Gate it: only auto-scroll to `bottomRef` when no message is actively being read (or when the user is already near the bottom). Simplest: pass an `isReading` flag into `Thread` and skip the effect when true. The post-stream jump-to-bottom still happens for the user's own message and the start of streaming; read-along then takes over scroll on `onplay`.

### Highlight styling (Aurora Mist locked — reuse tokens)
Add classes to `globals.css` (new classes allowed; **no new accent hex**):
- `.s-active` — the spoken sentence. Soft highlight using existing tokens, e.g. a low-alpha `--accent`/`--accent-2` background wash and/or slightly stronger `--ink` text. Must stay legible on the white `--panel` and not shift layout (no font-size/weight change that reflows — use background/color, or a non-reflowing underline).
- `.s-read` — already-spoken: very subtle (e.g. `--ink-soft`), signaling progress without distracting.
- Transition: a short `background-color`/`color` transition under `@media (prefers-reduced-motion: no-preference)` only.
- `.w` spans stay unstyled here (word styling is Spec 07).

### Flag plumbing
- Add `readAlong: ReadAlongMode` (overview) in `AppShell`; thread `'sentence'` as the dev default once this lands. When `'off'`, the controller is inert and **nothing** changes vs. today.

---

## Test plan

### Component — `src/components/main/useReadAlong.test.tsx` (RTL + a fake audio clock)
Mock an `HTMLAudioElement` whose `currentTime` is advanced manually (and `paused` toggled); render a small fixture row with `[data-s]` spans + known `timings`.
| Assert | Detail |
|---|---|
| Active tracking | At `currentTime` inside sentence k's window, span k has `.s-active`, spans `<k` have `.s-read`, others have neither. |
| Advance | Stepping `currentTime` forward moves `.s-active` forward by exactly one boundary at a time. |
| Scroll-to-start once | On first play, `scrollEl.scrollTo`/`scrollIntoView` is called targeting the first `[data-s]`; not called again on subsequent frames. |
| Reduced-motion | With the `matchMedia` reduce mock (testing-strategy §5), scroll uses `behavior:'auto'`. |
| Cleanup | On `ended`/`pause`, all `.s-active`/`.s-read` cleared and rAF cancelled. |
| Off mode | `active:false` → no classes touched, no scroll. |

### Component — `Thread.test.tsx`
| Assert | Detail |
|---|---|
| Bottom-pin suppressed | With `isReading=true`, the `messages`-change effect does **not** scroll to `bottomRef`. With `isReading=false`, today's behavior is intact. |

### Token regression — `globals.tokens.test.ts`
- `.s-active` / `.s-read` present; palette table unchanged; **no new accent hex** introduced (assert the locked tokens still hold and no foreign hex appears in the new rules).

### Manual / Playwright
- Ask a question; when the voice starts, the thread **scrolls up to the answer's first line** and the **spoken sentence is highlighted**, advancing with the audio; on end, highlight clears. Reduced-motion: highlight still shows, scroll is instant.

---

## Definition of Done
- `useReadAlong` drives sentence highlight from `audio.currentTime` via rAF; scroll-to-start fires once per playback.
- Bottom-pin no longer fights read-along.
- Highlight uses only existing Aurora Mist tokens; reduced-motion honored; a11y preserved (class toggles on stable spans, `aria-live` intact).
- Behind `readAlong:'sentence'`; `'off'` is a no-op. `test:run` / `tsc` / `build` green.

---

## Files touched
- **New:** `src/components/main/useReadAlong.ts`, `src/components/main/useReadAlong.test.tsx`.
- **Modified:** `src/components/AppShell.tsx` (build timings on play, pass `readAlong` + refs down, `isReading` state), `src/components/main/Thread.tsx` (suppress bottom-pin while reading; forward refs/flags), `src/components/AiRow.tsx` (expose row ref / accept controller wiring), `src/app/globals.css` (`.s-active`, `.s-read`), `src/components/main/Thread.test.tsx`, `src/app/globals.tokens.test.ts`.

---

## Out of scope
- Continuous follow-scroll (reading band) — Spec `05`.
- User-scroll override — Spec `06`.
- Word-level highlight — Spec `07`.
