# Read-Along TTS — Spec Series Overview

**Project:** AI News Tutor (`Projects/ai-tutor`, Next.js 14 + TS + Tailwind + Vitest)
**Branch base:** `main`
**Status:** 📋 Proposed (not yet implemented)
**Date:** 2026-06-14
**Visual system:** Aurora Mist — **locked** (no palette/font/radius/shadow/`@keyframes` changes; new *classes* are allowed, new accent *hex values* are not)
**Backlog item:** `spec/feature-backlog.md` — _"Once the text is generated and the voice starts, scroll up to the beginning of the text, follow the text as the voice reads the text."_

---

## What this series delivers

When ElevenLabs TTS reads an answer, the app should **scroll to the start of the answer**, **highlight the part being spoken**, and **follow along** as the voice progresses — synchronizing on-screen text with the audio. This series implements that in shippable, independently-testable chunks, in three milestones:

| Milestone | Specs | Outcome |
|---|---|---|
| **Solution 3.5** — sentence-level read-along with *real* ElevenLabs timestamps | `01` → `05` | Accurate sentence karaoke + follow-scroll; the `slice(0, 1200)` truncation bug is fixed along the way |
| **User override** | `06` | Manual scroll pauses auto-follow and shows a "Resume following" affordance |
| **Solution 3** — word-level read-along | `07` (+ optional `08`) | Word-accurate karaoke; optional streaming for long-answer latency |

Each spec is a PR-sized unit with its own test plan and Definition of Done. Build them **in numeric order** — each depends only on the ones before it.

```
01 spoken-document-model ──┬─> 02 tts-timestamps-chunking ──┐
   (canonical tokens)      │      (audio + alignment)        │
                           └──────────────┬──────────────────┘
                                          v
                              03 timing-map (pure)
                                          v
                              04 sentence-highlight + scroll-to-start   ← first visible read-along
                                          v
                              05 follow-scroll (reading band)           ← Solution 3.5 complete
                                          v
                              06 user-scroll-override                    ← override
                                          v
                              07 word-level-highlight                    ← Solution 3
                                          v
                              08 streaming-timestamps (optional)        ← latency polish
```

---

## Why this ordering (the engineering crux)

The hard part is **not** the highlight — it's that **the spoken text ≠ the rendered text**. Today `/api/speak/route.ts:43` sends `stripMarkdown(text).slice(0, 1200)` to ElevenLabs, while the screen renders *full* markdown (bold, lists, the separate **Impact card**, source chips). ElevenLabs returns timing keyed to the stripped string; the DOM shows the rendered one. To map one onto the other we need **one tokenization that is the single source of truth for both** what we send to TTS and what we render as addressable spans. Spec `01` builds exactly that, before anything else can sync.

---

## Shared data contracts

These types are defined once here and referenced by every spec. Proposed home: `src/lib/readAlong/` (pure, framework-free, unit-testable — same ethos as `src/lib/parseAnswer.ts`).

### Canonical spoken document — produced by Spec `01`

```ts
// src/lib/readAlong/spokenDoc.ts
export type Emphasis = 'strong' | 'em' | undefined;

export interface SpokenWord {
  id: number;          // stable global index; becomes data-w on the rendered span
  sentenceId: number;  // owning sentence
  text: string;        // spoken text of this word, markdown removed
  charStart: number;   // inclusive offset into SpokenDoc.spokenText
  charEnd: number;     // exclusive
  emphasis: Emphasis;  // markdown emphasis to preserve when rendering (bold/italic)
}

export interface SpokenSentence {
  id: number;          // stable global index; becomes data-s on the rendered span
  wordIds: number[];
  charStart: number;   // inclusive offset into SpokenDoc.spokenText
  charEnd: number;     // exclusive
  region: 'body' | 'impact';  // body paragraphs vs the Business Impact card
}

export interface SpokenDoc {
  /** The EXACT string sent to ElevenLabs. Contract: equals today's
   *  stripMarkdown(fullAnswer) (minus the 1200 cap) so audio is unchanged. */
  spokenText: string;
  sentences: SpokenSentence[];
  words: SpokenWord[];
}
```

### TTS result with alignment — produced by Spec `02`

```ts
// returned by POST /api/speak
export interface SpeakResult {
  audioBase64: string;         // full stitched MP3 (base64), no length cap
  alignment: {
    chars: string[];           // length N; chars.join('') === SpokenDoc.spokenText
    charStartTimesSec: number[]; // length N, monotonic non-decreasing
    charEndTimesSec: number[];   // length N
  };
}
```

### Read-along timings — produced by Spec `03`

```ts
// src/lib/readAlong/timingMap.ts
export interface Timing { id: number; startSec: number; endSec: number; }
export interface ReadAlongTimings {
  sentences: Timing[]; // consumed by Specs 04/05 (Solution 3.5)
  words: Timing[];     // consumed by Spec 07 (Solution 3) — computed now, used later
  totalSec: number;
}
```

> **Contract invariant:** `chars.join('') === spokenDoc.spokenText`. Specs `01` and `02` are each verified against this independently, so the timing map in `03` can assume char offsets line up exactly. If a future ElevenLabs `normalized_alignment` diverges from the input, Spec `02` reconciles it before returning (see `02` §Normalization).

---

## Cross-cutting requirements (apply to every spec)

### Feature flag — `readAlong`
A single client setting gates the visible behavior so each spec ships dark and is reversible:

```ts
type ReadAlongMode = 'off' | 'sentence' | 'word';
```
- Specs `01`–`03` ship with **no** user-visible change regardless of flag (plumbing only).
- Specs `04`/`05` activate at `'sentence'`. Spec `07` activates at `'word'` (and degrades to `'sentence'`).
- Default during development: `'off'`. Flip to `'sentence'` as the rollout default once `05` lands.
- Proposed location: a constant/context in `AppShell.tsx` (no env var needed; it's a UX preference). A user-facing toggle is **out of scope** for this series — note it as a follow-up.

### Accessibility (non-negotiable)
- The answer container keeps `aria-live="polite"` (`AiRow.tsx:46`). Highlighting **must** be done by toggling CSS classes on **stable** pre-rendered spans — never by re-rendering or re-ordering text nodes — so screen readers are not spammed with the same content repeatedly.
- `prefers-reduced-motion: reduce` → no smooth scrolling (use `scrollTo({behavior:'auto'})` / snap), and **no word-level flicker** (degrade to sentence-level). The highlight itself (a color/weight change) is allowed under reduced motion because it is not animation. The repo already gates motion at `globals.css:714`.
- Read-along is an enhancement, never a blocker: if timings are missing/short, audio still plays and the answer is fully readable.

### Visual system (Aurora Mist locked)
- Highlight styling **must reuse existing tokens** (`--accent #8AB4FF`, `--accent-2 #C9B8FF`, `--line-2 #EEF2FB`, `--ink`, `--ink-soft`). **No new accent hex** — `globals.tokens.test.ts` forbids it (e.g. asserts old `#c75b39` absent and locks the palette table).
- New CSS **classes** (e.g. `.is-reading`, `.s-active`, `.w-active`, `.follow-resume`) are allowed; add them to the token test's "present" assertions where that test checks structure.

### Voice-first mode
The app opens in **voice mode** with the orb docked (`VoiceDock.tsx`); the thread still scrolls above it. Read-along operates on the **thread** in both Voice and Text modes — the orb is unaffected. No mode auto-switching in this series (note as a possible follow-up).

### Truncation bug (tracked in Spec `02`)
`/api/speak/route.ts:43` caps spoken text at 1200 chars, so long answers already cut off in audio today. Read-along makes this visible (highlight would outrun the audio). Spec `02` removes the cap and chunks instead — this is a **required** part of Solution 3.5, called out explicitly in the milestone.

---

## Current architecture (what each spec touches)

| Area | File | Today |
|---|---|---|
| TTS proxy | `src/app/api/speak/route.ts` | Strips markdown, `slice(0,1200)`, calls `…/{voice}/stream`, returns raw `audio/mpeg`. **No timing.** |
| Playback | `src/components/AppShell.tsx` | `playVoice` (`:54`) and `readAloud` (`:145`) fetch audio as a blob, `new Audio(url)`, `setSpeakingContent` (`:17`). Auto-plays after the full stream (`:114`). |
| Answer render | `src/components/AiRow.tsx` | `parseBlocks` → `<p class="ai-para">`/lists → `InlineMarkdown`; renders the separate `ImpactCard` (`:98`); `speaking` flag drives the Read-aloud button only. |
| Inline tokens | `src/components/InlineMarkdown.tsx` + `src/lib/parseAnswer.ts` | Already tokenizes into text/strong/em runs (`parseInline`) and block structure (`parseBlocks`). **Reused/extended by Spec 01.** |
| Impact card | `src/components/ImpactCard.tsx` | `.impact` > `.impact-label` + `.impact-text` (InlineMarkdown). Part of the spoken text. |
| Scroll | `src/components/main/Thread.tsx` | `.scroll` is the scroll container (`globals.css:225`); `bottomRef.scrollIntoView` on every `messages` change (`:22`) — **always pins to bottom**. Read-along needs to override this during playback. |

---

## Definition of Done for the series

- Specs `01`–`05` merged → Solution 3.5 live behind `readAlong:'sentence'`; long answers read fully (truncation gone); sentence highlight tracks the voice; view follows; reduced-motion + a11y honored.
- Spec `06` merged → manual scroll pauses follow with a resume affordance.
- Spec `07` merged → word-level highlight behind `readAlong:'word'`, degrading to sentence on reduced-motion/small screens.
- `08` optional → streaming reduces time-to-first-audio on long answers.
- Every milestone keeps `npm run test:run`, `npx tsc --noEmit`, and `npm run build` green.
