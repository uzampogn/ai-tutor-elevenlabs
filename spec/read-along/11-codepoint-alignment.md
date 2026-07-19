# Spec 11 — Code-point → UTF-16 alignment expansion

**Series:** [Read-Along TTS](./00-overview.md) · **Milestone:** Desync fix (root-cause B)
**Status:** 📋 Proposed · **Date:** 2026-07-18
**Depends on:** `02`, `03` · **Unblocks:** —
**User-visible change:** answers containing any emoji (including the standard
`💼 Business Impact` heading) get **measured** word/sentence timings again instead of the
drifting proportional estimate.

---

## Why (root-cause analysis, 2026-07-18)

`buildTimings` gates the measured path on `chars.length === doc.spokenText.length`
(timingMap.ts:103). Alignment `chars` count **code points** (ElevenLabs' per-character
arrays, and this repo's own `Array.from(text)` in `reconcileAlignment`, chunking.ts:230),
while `spokenText.length` counts **UTF-16 units**. Any astral character (💼 = 2 UTF-16
units, 1 code point) makes the lengths differ, so accurate timestamps are silently
discarded for the whole answer and replaced by the proportional fallback — whose drift
grows with audio length. Confirmed by simulation: an answer with 🚀/💼 produced
`chars=68` vs `spokenText.length=70` → `FALLBACK(proportional)`.

Since answers conventionally carry the 💼 heading, most real answers run on estimated
timings today.

---

## Goal

When the alignment's characters reconstruct `spokenText` exactly but are code-point
indexed, expand it to UTF-16 indexing and take the measured path. Behavior for genuinely
mismatched alignments (normalization drift) is unchanged: proportional fallback.

---

## Design

New pure helper in `src/lib/readAlong/timingMap.ts`:

```ts
/** Expand a code-point-indexed alignment to UTF-16 indexing over `text`.
 *  Each alignment char's [start, end] times are repeated across the char's
 *  UTF-16 width (1 for BMP, 2 for astral). Returns null unless
 *  chars.join('') === text. */
function expandToUtf16(text: string, a: Alignment): Alignment | null;
```

`buildTimings` gate becomes:

1. `chars.length === spokenText.length` → measured (unchanged fast path);
2. else `expandToUtf16(spokenText, alignment)` succeeds → measured over the expanded
   arrays (`n = spokenText.length`);
3. else → proportional fallback (unchanged).

Notes:
- Join equality is the correctness condition — it proves char *k* of the alignment maps
  to a known UTF-16 span of `spokenText`; only the index base changes.
- The join comparison is O(n) on a few-KB string once per playback — no caching needed.
- Server (`reconcileAlignment`, stitching) is untouched; its arrays remain code-point
  indexed and `chars.join('') === text` remains its invariant, which is exactly what the
  expansion consumes. Multi-code-point graphemes (flags, ZWJ sequences) need no special
  handling: expansion is per code point, and a grapheme's code points are adjacent so
  word windows stay correct.

---

## Test plan (`timingMap.test.ts`)

| Assert | Detail |
|---|---|
| Emoji → measured | Alignment built as `Array.from(spokenText)` (code points) with synthetic times: `estimated` is falsy; windows around the emoji word are correct; totalSec unchanged. |
| Astral positions | Emoji at start / middle / end of text; multiple emoji; ZWJ sequence — expansion length always `=== spokenText.length`, times non-decreasing. |
| BMP no-op | Pure-BMP alignment takes path 1 and results are byte-identical to today. |
| True mismatch | `chars.join('') !== spokenText` (dropped char) → proportional fallback with `estimated: true`, exactly as today. |
| Empty/degenerate | Empty alignment, empty doc — unchanged behavior. |

Quality gate: `npm run lint && npm run typecheck && npm run test:run`.
