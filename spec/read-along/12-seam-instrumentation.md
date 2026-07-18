# Spec 12 — Chunk-seam drift instrumentation

**Series:** [Read-Along TTS](./00-overview.md) · **Milestone:** Desync fix (root-cause C — suspected, unverified)
**Status:** 📋 Proposed · **Date:** 2026-07-18
**Depends on:** `02` · **Unblocks:** a future seam-correction spec, only if drift is confirmed
**User-visible change:** none — diagnostics only.

---

## Why

For answers > 2000 chars, `/api/speak` synthesizes per-chunk and `stitchAlignments`
advances each seam's time offset by `max(charEndTimesSec)` of the previous chunk
(chunking.ts:172) — a proxy that ignores any trailing silence in the chunk's actual MP3
audio. If real chunk audio is longer than its alignment max-end, the stitched timeline
runs **ahead** of the audio by a cumulative amount per seam: highlight-leads-voice drift
that only appears in long, chunked answers.

This mechanism is plausible but **unverified** — it needs real ElevenLabs responses, not
simulation. Per systematic debugging, instrument first; design a fix only against
evidence.

---

## Goal

Cheap, always-on diagnostics that let one long-answer playback in dev (or prod devtools)
confirm or refute the drift, quantified per seam. No behavior change.

---

## Design

### 1. Server (`/api/speak/route.ts`)

Response gains a `chunkMeta` field (small, additive — existing clients ignore it):

```ts
chunkMeta: {
  count: number;             // chunks synthesized (1 for short answers)
  charLengths: number[];     // per-chunk text length
  alignSecs: number[];       // per-chunk max(charEndTimesSec) — the seam offsets used
}
```

Plus one `console.log('[speak] chunks:', …)` line with the same numbers.

### 2. Client (`AppShell.tsx`, both `playVoice` and `readAloud`)

On the audio element's `loadedmetadata`, log a single diagnostic comparing the real total
audio duration against the stitched alignment's total:

```
[read-along] drift check: audio=Xs, alignment=Ys, delta=Zs, chunks=N, perChunk=[…]
```

`console.debug` normally; escalate to `console.warn` when `|delta| > 0.25s`. The total
delta IS the accumulated seam error (alignment within one chunk is trusted), and
`delta / (N − 1)` estimates per-seam drift. Logged always (invisible unless devtools is
open); no gating, no state, no UI.

### 3. Explicitly out of scope

Any correction (e.g. decoding real per-chunk durations server-side, or rescaling seam
offsets client-side from `audio.duration`). If the warning fires consistently on long
answers, a follow-up spec designs the fix against the measured numbers.

---

## Test plan

| Assert | Detail |
|---|---|
| `chunkMeta` shape | Route test (mocked ElevenLabs, existing pattern): N chunks → `count === N`, `charLengths` match chunk texts, `alignSecs` match per-chunk max ends. |
| Fail-soft unchanged | Partial chunk failure still returns stitched prefix; `chunkMeta` covers only synthesized chunks. |
| Client log | Unit-light: the drift-check helper (extracted pure: `(audioSec, totalSec, meta) → {level, message}`) returns `warn` past the 0.25s threshold, `debug` under it. |

Quality gate: `npm run lint && npm run typecheck && npm run test:run`.
