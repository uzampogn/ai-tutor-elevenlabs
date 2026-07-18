// Spec 03 — Timing map (character alignment → sentence/word time windows).
//
// A single PURE function that combines:
//   - the SpokenDoc (Spec 01) — each sentence/word's charStart/charEnd, and
//   - the stitched alignment (Spec 02) — each character's start/end time,
// into per-sentence and per-word [startSec, endSec] windows.
//
// Because Spec 01 guarantees spokenText.slice(w.charStart, w.charEnd) === w.text
// and Spec 02 guarantees alignment.chars.join('') === spokenText, character
// index k in the alignment corresponds directly to character k of spokenText —
// so a token spanning [charStart, charEnd) takes:
//   startSec = charStartTimesSec[charStart]
//   endSec   = charEndTimesSec[charEnd - 1]
// No fuzzy matching; this module is careful edge handling only.
//
// Pure / framework-free / no DOM / no network — same ethos as spokenDoc.ts.
// Specs 04/05 consume the sentence windows; Spec 07 consumes the word windows.

import type { SpokenDoc } from './spokenDoc';

export interface Timing {
  id: number;
  startSec: number;
  endSec: number;
}

export interface ReadAlongTimings {
  sentences: Timing[]; // consumed by Specs 04/05 (Solution 3.5)
  words: Timing[]; // consumed by Spec 07 (Solution 3) — computed now, used later
  totalSec: number;
  /** True when windows were estimated (proportional fallback), not measured. */
  estimated?: boolean;
}

/** The alignment shape produced by Spec 02 (matches SpeakResult['alignment']). */
export interface Alignment {
  chars: string[];
  charStartTimesSec: number[];
  charEndTimesSec: number[];
}

const EMPTY: ReadAlongTimings = { sentences: [], words: [], totalSec: 0 };

/** Clamp an index into [0, n-1]; returns 0 for an empty array length. */
function clampIndex(i: number, n: number): number {
  if (n <= 0) return 0;
  if (i < 0) return 0;
  if (i > n - 1) return n - 1;
  return i;
}

/** Largest finite value in `xs`, or 0 if none. */
function maxOf(xs: number[]): number {
  let max = 0;
  let seen = false;
  for (const x of xs) {
    if (!Number.isFinite(x)) continue;
    if (!seen || x > max) {
      max = x;
      seen = true;
    }
  }
  return seen ? max : 0;
}

/** Expand a code-point-indexed alignment to UTF-16 indexing over `text`.
 *  Each alignment char's [start, end] repeats across its UTF-16 width.
 *  Returns null unless chars.join('') === text (the correctness condition). */
export function expandToUtf16(text: string, a: Alignment): Alignment | null {
  if (a.chars.join('') !== text) return null;
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < a.chars.length; i++) {
    const width = a.chars[i].length;
    for (let k = 0; k < width; k++) {
      const s = a.charStartTimesSec[i] ?? 0;
      starts.push(s);
      ends.push(a.charEndTimesSec[i] ?? s);
    }
  }
  return { chars: Array.from(text), charStartTimesSec: starts, charEndTimesSec: ends };
}

/**
 * Turn a SpokenDoc + character alignment into per-sentence and per-word time
 * windows.
 *
 * Word window:  start = charStartTimesSec[w.charStart]
 *               end   = charEndTimesSec[w.charEnd - 1]   (indices clamped)
 * Sentence:     [charStartTimesSec[s.charStart], charEndTimesSec[s.charEnd - 1]]
 *               = first-word-start → last-word-end.
 *
 * Defensive guarantees (read-along must never crash playback or jump backward):
 *   - every window has end >= start;
 *   - successive sentences (and words) are non-decreasing in start.
 *
 * Robustness:
 *   - alignment.chars.length !== spokenText.length → proportional fallback that
 *     distributes totalSec across tokens by text.length, with estimated:true;
 *   - empty doc / empty alignment → { sentences: [], words: [], totalSec: 0 }.
 */
export function buildTimings(doc: SpokenDoc, alignment: Alignment): ReadAlongTimings {
  if (!doc || (doc.words.length === 0 && doc.sentences.length === 0)) {
    return { ...EMPTY };
  }

  const chars = alignment?.chars ?? [];
  const starts = alignment?.charStartTimesSec ?? [];
  const ends = alignment?.charEndTimesSec ?? [];
  const n = Math.min(starts.length, ends.length);

  // No usable alignment at all → estimate over a zero total (windows collapse to
  // 0 but the structure is still well-formed and non-decreasing).
  if (n === 0) {
    return buildProportional(doc, 0);
  }

  // Length mismatch (e.g. a normalization slipped through upstream) → we can no
  // longer trust char-index → time. Try to expand from code-point to UTF-16
  // indexing first; if that succeeds, use measured timings. Otherwise fall back
  // to proportional.
  if (chars.length !== doc.spokenText.length) {
    const expanded = expandToUtf16(doc.spokenText, { chars, charStartTimesSec: starts, charEndTimesSec: ends });
    if (!expanded) return buildProportional(doc, maxOf(ends));
    return buildMeasured(
      doc,
      expanded.charStartTimesSec,
      expanded.charEndTimesSec,
      doc.spokenText.length,
    );
  }

  return buildMeasured(doc, starts, ends, n);
}

/** Direct char-index → time mapping (the happy path). */
function buildMeasured(
  doc: SpokenDoc,
  starts: number[],
  ends: number[],
  n: number,
): ReadAlongTimings {
  const startAt = (charStart: number): number => starts[clampIndex(charStart, n)] ?? 0;
  const endAt = (charEnd: number): number => ends[clampIndex(charEnd - 1, n)] ?? 0;

  const words = monotonic(
    doc.words.map((w) => ({
      id: w.id,
      startSec: startAt(w.charStart),
      endSec: endAt(w.charEnd),
    })),
  );

  const sentences = monotonic(
    doc.sentences.map((s) => ({
      id: s.id,
      startSec: startAt(s.charStart),
      endSec: endAt(s.charEnd),
    })),
  );

  const totalSec = maxOf(ends);

  return { sentences, words, totalSec };
}

/**
 * Proportional fallback: distribute `totalSec` across tokens weighted by
 * text.length, in document order. Sentences and words are timed on independent
 * passes (each summing to totalSec) so both granularities span the full audio.
 */
function buildProportional(doc: SpokenDoc, totalSec: number): ReadAlongTimings {
  const total = Number.isFinite(totalSec) && totalSec > 0 ? totalSec : 0;

  const words = proportionalPass(
    doc.words.map((w) => ({ id: w.id, weight: w.text.length })),
    total,
  );

  // A sentence's weight is the sum of its words' lengths (falls back to its char
  // span if it has no words, which shouldn't happen for a well-formed doc).
  const wordLen = new Map<number, number>();
  for (const w of doc.words) wordLen.set(w.id, w.text.length);
  const sentences = proportionalPass(
    doc.sentences.map((s) => {
      let weight = s.wordIds.reduce((sum, id) => sum + (wordLen.get(id) ?? 0), 0);
      if (weight === 0) weight = Math.max(0, s.charEnd - s.charStart);
      return { id: s.id, weight };
    }),
    total,
  );

  return { sentences, words, totalSec: total, estimated: true };
}

/** Lay tokens end-to-end across [0, total], proportional to their weight. */
function proportionalPass(tokens: { id: number; weight: number }[], total: number): Timing[] {
  const sumWeight = tokens.reduce((acc, t) => acc + Math.max(0, t.weight), 0);
  if (tokens.length === 0) return [];

  // Degenerate weights (all zero) → spread evenly so windows still advance.
  const useEven = sumWeight <= 0;
  const evenStep = useEven ? total / tokens.length : 0;

  const out: Timing[] = [];
  let cursor = 0;
  for (let i = 0; i < tokens.length; i++) {
    const start = cursor;
    let end: number;
    if (i === tokens.length - 1) {
      end = total; // last token absorbs rounding so the sum equals total exactly
    } else if (useEven) {
      end = start + evenStep;
    } else {
      const frac = Math.max(0, tokens[i].weight) / sumWeight;
      end = start + frac * total;
    }
    if (end < start) end = start;
    out.push({ id: tokens[i].id, startSec: start, endSec: end });
    cursor = end;
  }
  return out;
}

/**
 * Enforce, in place, that each window has end >= start and that starts are
 * non-decreasing across the list (a bad upstream value must never make the
 * highlight jump backward). Ends are also kept non-decreasing.
 */
function monotonic(timings: Timing[]): Timing[] {
  let prevStart = -Infinity;
  let prevEnd = -Infinity;
  for (const t of timings) {
    if (!Number.isFinite(t.startSec)) t.startSec = prevStart === -Infinity ? 0 : prevStart;
    if (!Number.isFinite(t.endSec)) t.endSec = t.startSec;
    if (t.startSec < prevStart) t.startSec = prevStart;
    if (t.endSec < t.startSec) t.endSec = t.startSec;
    if (t.endSec < prevEnd) t.endSec = prevEnd;
    prevStart = t.startSec;
    prevEnd = t.endSec;
  }
  return timings;
}

/**
 * Index of the active timing window at time `t`, or -1.
 *
 * Contract:
 *   - before the first window's start → -1
 *   - at/after the last window's start → last index (never past the end)
 *   - inside window k (startSec[k] <= t) → the greatest such k
 *
 * `fromHint` (the previous active index) lets the caller amortize to O(1) per
 * frame during monotonic playback: we forward-scan from the hint. For a backward
 * seek (t before the hint window) we binary-search instead. The result is
 * identical to a fresh search either way.
 */
export function activeIndexAt(timings: Timing[], t: number, fromHint?: number): number {
  const len = timings.length;
  if (len === 0) return -1;
  if (t < timings[0].startSec) return -1;

  const hint = fromHint != null && fromHint >= 0 && fromHint < len ? fromHint : 0;

  // Forward path: hint is still valid (we haven't moved before its window).
  if (t >= timings[hint].startSec) {
    let i = hint;
    while (i + 1 < len && timings[i + 1].startSec <= t) i++;
    return i;
  }

  // Backward seek → binary search for the greatest index with start <= t.
  let lo = 0;
  let hi = len - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timings[mid].startSec <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
