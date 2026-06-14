// Pure, network-free helpers for Spec 02 (TTS timestamps + chunking).
//
// Three responsibilities, all unit-tested in chunking.test.ts:
//   1. splitIntoChunks  — break spokenText into ≤ MAX_CHARS pieces on sentence
//      boundaries, never mid-word, packing toward a target size. The pieces
//      concatenate back to spokenText EXACTLY (no chars added/dropped at seams),
//      which is the load-bearing invariant for alignment continuity.
//   2. stitchAlignments — offset each per-chunk char-time array by the cumulative
//      duration of prior chunks and append, producing one monotonic alignment
//      over the whole text with chars.join('') === spokenText.
//   3. reconcileAlignment — given an alignment plus an optional normalized one,
//      always return chars whose join equals the requested text.
//
// No DOM, no fetch — same ethos as src/lib/readAlong/*.

/** ElevenLabs guidance: hard ceiling per request. */
export const MAX_CHARS = 2000;
/** Pack target — keeps each request cheap and lowers time-to-first-audio. */
export const TARGET_CHARS = 700;
/** Guardrail: answers are short editorial text, but Claude can ramble. */
export const MAX_CHUNKS = 8;

/** Per-chunk alignment as returned by ElevenLabs (already shaped to our names). */
export interface ChunkAlignment {
  chars: string[];
  charStartTimesSec: number[];
  charEndTimesSec: number[];
}

/** The stitched alignment shape (matches SpeakResult['alignment']). */
export type StitchedAlignment = ChunkAlignment;

// --- Chunking ----------------------------------------------------------------

/**
 * Find sentence-boundary split points in `text`. A boundary is the index just
 * AFTER a terminal punctuation mark ([.!?], allowing trailing quotes/brackets)
 * that is followed by whitespace — i.e. the position where the next sentence
 * begins. Boundaries are character indices into `text`; trailing whitespace
 * stays attached to the sentence it follows so concatenation is lossless.
 */
function sentenceBoundaries(text: string): number[] {
  const boundaries: number[] = [];
  // Terminal punctuation, optional closing quotes/brackets, then whitespace.
  const re = /[.!?]+["')\]]*\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Split AFTER the whitespace so the next chunk starts on a word.
    boundaries.push(m.index + m[0].length);
  }
  return boundaries;
}

/**
 * Find the last whitespace-run boundary at or before `hardLimit` within
 * [start, end). Returns the index just AFTER the whitespace run (so the next
 * chunk begins on a word). Returns -1 if there is no interior whitespace —
 * the caller then falls back to a hard cut at the limit.
 */
function lastWordBoundary(text: string, start: number, hardLimit: number): number {
  // Scan backward from hardLimit for a whitespace char, then walk past the run.
  for (let i = Math.min(hardLimit, text.length) - 1; i > start; i--) {
    if (/\s/.test(text[i])) {
      // Walk forward over the whole whitespace run so we cut after it.
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (j > start && j <= hardLimit) return j;
      // The run extends past the limit; cut right after the first ws char.
      return i + 1 <= hardLimit ? i + 1 : -1;
    }
  }
  return -1;
}

/**
 * Split `spokenText` into chunks that:
 *  - concatenate back to `spokenText` exactly (chunks.join('') === spokenText),
 *  - never exceed MAX_CHARS,
 *  - prefer sentence boundaries, packing toward ~TARGET_CHARS,
 *  - never split mid-word (fall back to a whitespace boundary, then a hard cut
 *    only if a single token somehow exceeds MAX_CHARS),
 *  - number at most MAX_CHUNKS (the final chunk absorbs any remainder, which may
 *    exceed MAX_CHARS in pathological inputs — bounded count beats unbounded).
 */
export function splitIntoChunks(spokenText: string): string[] {
  if (!spokenText) return [];
  if (spokenText.length <= MAX_CHARS) return [spokenText];

  const boundaries = sentenceBoundaries(spokenText);
  const chunks: string[] = [];
  let pos = 0;

  while (pos < spokenText.length) {
    // If we are on the last allowed chunk, take all the rest in one piece.
    if (chunks.length === MAX_CHUNKS - 1) {
      chunks.push(spokenText.slice(pos));
      pos = spokenText.length;
      break;
    }

    const remaining = spokenText.length - pos;
    if (remaining <= MAX_CHARS) {
      chunks.push(spokenText.slice(pos));
      pos = spokenText.length;
      break;
    }

    const hardLimit = pos + MAX_CHARS;
    const targetLimit = pos + TARGET_CHARS;

    // Prefer the furthest sentence boundary that is within the hard ceiling and
    // at or beyond the pack target (so we don't make tiny chunks); if none is
    // past the target, take the furthest boundary still under the ceiling.
    let cut = -1;
    let furthestUnderCeiling = -1;
    for (const b of boundaries) {
      if (b <= pos) continue;
      if (b > hardLimit) break;
      furthestUnderCeiling = b;
      if (b >= targetLimit) {
        cut = b;
        break;
      }
    }
    if (cut === -1) cut = furthestUnderCeiling;

    // No usable sentence boundary in range → fall back to a word boundary.
    if (cut === -1) {
      cut = lastWordBoundary(spokenText, pos, hardLimit);
    }
    // No whitespace at all in range → hard cut at the ceiling (last resort; the
    // input is a single token longer than MAX_CHARS, which never happens for
    // real prose but keeps us from looping forever).
    if (cut === -1 || cut <= pos) {
      cut = hardLimit;
    }

    chunks.push(spokenText.slice(pos, cut));
    pos = cut;
  }

  return chunks;
}

// --- Stitching ---------------------------------------------------------------

/**
 * Stitch per-chunk alignments into one alignment over the whole text. Each
 * chunk's char times are relative to that chunk's own audio; we offset them by
 * the cumulative duration of all prior chunks (offset_{i+1} = offset_i +
 * max(chunk_i.charEndTimesSec)) and append chars verbatim.
 *
 * Result: chars.join('') === concat(inputs' chars); times are monotonic
 * non-decreasing across the seam (chunk i+1's first start ≥ chunk i's last end),
 * given each chunk is itself monotonic.
 */
export function stitchAlignments(perChunk: ChunkAlignment[]): StitchedAlignment {
  const chars: string[] = [];
  const charStartTimesSec: number[] = [];
  const charEndTimesSec: number[] = [];

  let offset = 0;
  for (const chunk of perChunk) {
    if (!chunk || chunk.chars.length === 0) continue;
    for (let i = 0; i < chunk.chars.length; i++) {
      chars.push(chunk.chars[i]);
      charStartTimesSec.push((chunk.charStartTimesSec[i] ?? 0) + offset);
      charEndTimesSec.push((chunk.charEndTimesSec[i] ?? 0) + offset);
    }
    // Advance the offset by this chunk's audio duration. The alignment max-end
    // is the simplest sufficient proxy for the chunk's audio length.
    const maxEnd = chunk.charEndTimesSec.length
      ? Math.max(...chunk.charEndTimesSec)
      : 0;
    offset += maxEnd;
  }

  return { chars, charStartTimesSec, charEndTimesSec };
}

// --- Normalization reconcile -------------------------------------------------

/**
 * Always return an alignment whose `chars.join('')` equals `text`.
 *
 * ElevenLabs returns `alignment` (keyed to the input we sent) and may also
 * return `normalized_alignment` (timing over a normalized variant). We prefer
 * `alignment`. But whichever we use, if its chars don't reconstruct `text`
 * exactly, we two-pointer-reconcile the timing onto `text`'s characters so the
 * load-bearing invariant chars.join('') === request.text always holds.
 *
 * @param text The exact text we requested timing for.
 * @param alignment Primary alignment (keyed to input). May be undefined.
 * @param normalized Fallback alignment (normalized). Used only if `alignment`
 *        is missing/empty.
 */
export function reconcileAlignment(
  text: string,
  alignment: ChunkAlignment | undefined,
  normalized?: ChunkAlignment | undefined,
): StitchedAlignment {
  const source =
    alignment && alignment.chars.length > 0 ? alignment : normalized;

  // No usable timing at all → return chars over `text` with zeroed times. The
  // timing map (Spec 03) treats a length-matched-but-flat alignment fine; an
  // all-zero one will be caught by its proportional fallback.
  if (!source || source.chars.length === 0) {
    const chars = Array.from(text);
    return {
      chars,
      charStartTimesSec: new Array(chars.length).fill(0),
      charEndTimesSec: new Array(chars.length).fill(0),
    };
  }

  // Fast path: the source already reconstructs `text` exactly.
  if (source.chars.join('') === text) {
    return {
      chars: source.chars.slice(),
      charStartTimesSec: source.charStartTimesSec.slice(),
      charEndTimesSec: source.charEndTimesSec.slice(),
    };
  }

  // Reconcile: walk `text` and the source chars together, carrying the source's
  // current start/end times forward across insertions/deletions so every
  // output char gets a plausible, monotonic timing. The output chars are ALWAYS
  // exactly the characters of `text`.
  const outChars = Array.from(text);
  const outStart = new Array<number>(outChars.length);
  const outEnd = new Array<number>(outChars.length);

  let si = 0; // source index
  let lastStart = source.charStartTimesSec[0] ?? 0;
  let lastEnd = source.charEndTimesSec[0] ?? lastStart;

  for (let ti = 0; ti < outChars.length; ti++) {
    const tc = outChars[ti];

    // Try to find a matching source char at or ahead of si, skipping source
    // chars that don't appear in `text` here (whitespace/case/punctuation diffs).
    let matched = false;
    const lookahead = Math.min(source.chars.length, si + 8);
    for (let k = si; k < lookahead; k++) {
      if (equalsLoose(source.chars[k], tc)) {
        si = k + 1;
        lastStart = source.charStartTimesSec[k] ?? lastStart;
        lastEnd = source.charEndTimesSec[k] ?? lastEnd;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // No source match nearby — `text` has an extra char (e.g. whitespace the
      // normalized variant dropped). Carry the last known times forward.
    }

    outStart[ti] = lastStart;
    outEnd[ti] = Math.max(lastEnd, lastStart);
  }

  // Enforce monotonic non-decreasing starts defensively.
  for (let i = 1; i < outStart.length; i++) {
    if (outStart[i] < outStart[i - 1]) outStart[i] = outStart[i - 1];
    if (outEnd[i] < outStart[i]) outEnd[i] = outStart[i];
    if (outEnd[i] < outEnd[i - 1]) outEnd[i] = outEnd[i - 1];
  }

  return { chars: outChars, charStartTimesSec: outStart, charEndTimesSec: outEnd };
}

/** Loose char equality: ignore case and treat any whitespace as equal. */
function equalsLoose(a: string, b: string): boolean {
  if (a === b) return true;
  if (/\s/.test(a) && /\s/.test(b)) return true;
  return a.toLowerCase() === b.toLowerCase();
}
