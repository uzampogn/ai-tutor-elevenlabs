# Spec 03 — Timing map (character alignment → sentence/word time windows)

**Series:** [Read-Along TTS](./00-overview.md) · **Milestone:** Solution 3.5
**Status:** 📋 Proposed · **Date:** 2026-06-14
**Depends on:** `01` (`SpokenDoc` offsets) + `02` (`alignment`) · **Unblocks:** `04`, `07`
**User-visible change:** **none** (pure logic; the heart of synchronization)

---

## Goal

A single **pure function** that combines the `SpokenDoc` (Spec 01, which knows each sentence/word's `charStart/charEnd`) with the stitched `alignment` (Spec 02, which knows each character's start/end time) to produce **per-sentence and per-word `[startSec, endSec]` windows**. Specs 04/05 consume the **sentence** windows; Spec 07 consumes the **word** windows (computed now, used later).

This is the logical core of the feature and is testable in complete isolation with no DOM or network.

---

## Context — why this is clean now

Because Spec 01 guarantees `spokenText.slice(word.charStart, word.charEnd) === word.text`, and Spec 02 guarantees `alignment.chars.join('') === spokenText`, the character index `k` in `alignment` corresponds **directly** to character `k` of `spokenText`. So a token spanning `[charStart, charEnd)` simply takes:
- `startSec = alignment.charStartTimesSec[charStart]`
- `endSec   = alignment.charEndTimesSec[charEnd - 1]`

No fuzzy matching needed — the two invariants from `01` and `02` do the heavy lifting. This spec is mostly careful edge handling.

---

## Design

```ts
// src/lib/readAlong/timingMap.ts
export function buildTimings(doc: SpokenDoc, alignment: SpeakResult['alignment']): ReadAlongTimings
```
(Types: see [`00-overview.md` → Shared data contracts](./00-overview.md#shared-data-contracts).)

Rules:
- **Word window:** `start = charStartTimesSec[w.charStart]`, `end = charEndTimesSec[w.charEnd - 1]`. Clamp indices to `[0, N-1]`.
- **Sentence window:** `start = min(start of its words)` = `charStartTimesSec[s.charStart]`; `end = charEndTimesSec[s.charEnd - 1]`. Equivalent to first-word-start → last-word-end.
- **Monotonicity guarantee:** enforce `end ≥ start` and that successive sentences are non-decreasing in `start` (ElevenLabs is monotonic, but clamp defensively so a bad value can't make the highlight jump backward).
- **`totalSec`:** `max(charEndTimesSec)` (or last sentence end).
- **Trailing-silence / leading-padding:** windows come straight from char times; do not pad. (Spec 04 decides the "active" predicate, e.g. small look-ahead — not here.)

### Robustness (read-along must never crash playback)
- **Length mismatch** (`alignment.chars.length !== spokenText.length`, e.g. an upstream normalization slipped through): fall back to **proportional** timing — distribute `totalSec` across tokens weighted by `text.length`. Mark the result `estimated: true` (optional field) so Spec 04 can choose to still show sentence highlight (estimation is fine at sentence granularity) but Spec 07 can suppress word-level (too jittery when estimated). This makes Solution 2's heuristic a built-in graceful-degradation path, not a separate code base.
- **Empty doc / empty alignment:** return `{ sentences: [], words: [], totalSec: 0 }`.
- **Out-of-range offsets:** clamp; never index `undefined`.

### Lookup helper (consumed by 04/07)
Provide a tiny helper so the playback driver doesn't re-scan arrays every frame:

```ts
// returns the index of the active sentence (or word) at time t, or -1
export function activeIndexAt(timings: Timing[], t: number, fromHint?: number): number
```
- Linear/forward scan from `fromHint` (the previous active index) since playback time is monotonic — O(1) amortized per frame. Binary search as a fallback for seeks.

---

## Test plan

### Unit — `src/lib/readAlong/timingMap.test.ts` (pure)
| Assert | Detail |
|---|---|
| Exact mapping | Hand-built `doc` + `alignment` → expected sentence/word windows (golden values). |
| Boundary chars | First word starts at `charStartTimesSec[0]`; last word ends at `charEndTimesSec[N-1]`. |
| Sentence = span of words | Sentence window equals `[firstWord.start, lastWord.end]`. |
| Monotonic & clamped | Injected backward/negative time → output still non-decreasing, `end ≥ start`. |
| Proportional fallback | `chars.length` mismatch → estimated windows summing to `totalSec`, weighted by length, `estimated:true`. |
| Empty/degenerate | Empty doc/alignment → empty timings; single-word doc works. |
| `activeIndexAt` | Correct index across boundaries, before-first (`-1` or 0 per defined contract), after-last; `fromHint` forward-scan matches a fresh search; handles a backward seek. |

No component or manual tests — this spec has no UI.

---

## Definition of Done
- `buildTimings` + `activeIndexAt` in `src/lib/readAlong/timingMap.ts`, fully unit-tested incl. the proportional fallback and clamps.
- Returns both sentence and word windows from one pass.
- `test:run` / `tsc` green (no build/UI impact).

---

## Files touched
- **New:** `src/lib/readAlong/timingMap.ts`, `src/lib/readAlong/timingMap.test.ts`.
- **Modified:** none (pure addition; wired into the UI in Spec 04).

---

## Out of scope
- Any DOM, class toggling, or scrolling — Spec `04`.
- Deciding the "active" predicate / look-ahead tuning — Spec `04` (sentence) and `07` (word).
- Streaming/progressive timing as chunks arrive — Spec `08` (this spec assumes the full stitched alignment from `02`).
