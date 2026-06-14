import { describe, it, expect } from 'vitest';
import {
  splitIntoChunks,
  stitchAlignments,
  reconcileAlignment,
  MAX_CHARS,
  MAX_CHUNKS,
  type ChunkAlignment,
} from './chunking';

// --- Helpers -----------------------------------------------------------------

/** Build a sentence of roughly `len` chars ending in a period + space. */
function sentence(word: string, len: number): string {
  let s = '';
  while (s.length < len) s += word + ' ';
  return s.trim() + '. ';
}

/** A simple per-chunk alignment from a string: each char gets 1s of duration. */
function alignmentFor(text: string, startAt = 0): ChunkAlignment {
  const chars = Array.from(text);
  return {
    chars,
    charStartTimesSec: chars.map((_, i) => startAt + i),
    charEndTimesSec: chars.map((_, i) => startAt + i + 1),
  };
}

// --- Reconstruction ----------------------------------------------------------

describe('splitIntoChunks — reconstruction (chunks.join() === spokenText)', () => {
  it('returns the whole string for a short input', () => {
    const text = 'Hello world. This is short.';
    const chunks = splitIntoChunks(text);
    expect(chunks).toEqual([text]);
    expect(chunks.join('')).toBe(text);
  });

  it('returns a single chunk for exactly MAX_CHARS', () => {
    const text = 'a'.repeat(MAX_CHARS);
    const chunks = splitIntoChunks(text);
    expect(chunks.length).toBe(1);
    expect(chunks.join('')).toBe(text);
  });

  it('reconstructs exactly for an input just over MAX_CHARS', () => {
    // 4 sentences of ~700 chars → > 2000 total, multiple chunks.
    const text =
      sentence('alpha', 700) +
      sentence('bravo', 700) +
      sentence('charlie', 700) +
      sentence('delta', 700);
    expect(text.length).toBeGreaterThan(MAX_CHARS);
    const chunks = splitIntoChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(text);
  });

  it('reconstructs a very long multi-sentence document exactly', () => {
    let text = '';
    for (let i = 0; i < 20; i++) text += sentence(`word${i}`, 300);
    const chunks = splitIntoChunks(text);
    expect(chunks.join('')).toBe(text);
  });

  it('handles empty input', () => {
    expect(splitIntoChunks('')).toEqual([]);
  });
});

// --- Sentence-boundary packing, never mid-word, ≤ MAX ------------------------

describe('splitIntoChunks — packing & boundaries', () => {
  it('breaks on sentence ends where possible', () => {
    const text =
      sentence('alpha', 700) + sentence('bravo', 700) + sentence('charlie', 700);
    const chunks = splitIntoChunks(text);
    // Every chunk except possibly the last should end at a sentence boundary
    // (i.e. with terminal punctuation + trailing space, or be the final chunk).
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(/[.!?]+["')\]]*\s+$/.test(chunks[i])).toBe(true);
    }
    expect(chunks.join('')).toBe(text);
  });

  it('never splits mid-word (each chunk boundary lands on whitespace)', () => {
    const text =
      sentence('alpha', 700) + sentence('bravo', 700) + sentence('charlie', 700);
    const chunks = splitIntoChunks(text);
    // Reconstruct cumulative offsets; the char just before each seam must be
    // whitespace OR terminal punctuation (never the middle of a token).
    let pos = 0;
    for (let i = 0; i < chunks.length - 1; i++) {
      pos += chunks[i].length;
      const before = text[pos - 1];
      const after = text[pos];
      // boundary lands after whitespace → previous char is whitespace.
      expect(/\s/.test(before) || before === undefined).toBe(true);
      // and the next char starts a word (non-whitespace) — no split inside a run.
      if (after !== undefined) expect(/\S/.test(after)).toBe(true);
    }
  });

  it('keeps every chunk ≤ MAX_CHARS (except an unavoidable single huge token)', () => {
    const text = '';
    let body = text;
    for (let i = 0; i < 10; i++) body += sentence(`token${i}`, 500);
    const chunks = splitIntoChunks(body);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(MAX_CHARS);
    }
  });

  it('falls back to a word boundary when a sentence is longer than MAX_CHARS', () => {
    // One enormous sentence with no terminal punctuation until the very end.
    const huge = sentence('reallylongclause', 5000); // ~5000 chars, one sentence
    const chunks = splitIntoChunks(huge);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(huge);
    // No chunk (except a possible final remainder under the cap) exceeds MAX.
    for (let i = 0; i < chunks.length; i++) {
      if (i < MAX_CHUNKS - 1) expect(chunks[i].length).toBeLessThanOrEqual(MAX_CHARS);
    }
    // No chunk splits inside the repeated token "reallylongclause".
    let pos = 0;
    for (let i = 0; i < chunks.length - 1; i++) {
      pos += chunks[i].length;
      expect(/\s/.test(huge[pos - 1])).toBe(true);
    }
  });
});

// --- Guardrails --------------------------------------------------------------

describe('splitIntoChunks — guardrails', () => {
  it('never produces more than MAX_CHUNKS chunks', () => {
    // 40 sentences of ~700 chars → would be ~30 chunks if uncapped.
    let text = '';
    for (let i = 0; i < 40; i++) text += sentence(`w${i}`, 700);
    const chunks = splitIntoChunks(text);
    expect(chunks.length).toBeLessThanOrEqual(MAX_CHUNKS);
    // Still lossless even when the final chunk absorbs the remainder.
    expect(chunks.join('')).toBe(text);
  });
});

// --- Stitch continuity -------------------------------------------------------

describe('stitchAlignments — continuity & offset math', () => {
  it('joins chars to the concatenated chunk text', () => {
    const a = alignmentFor('Hello. ');
    const b = alignmentFor('World!');
    const stitched = stitchAlignments([a, b]);
    expect(stitched.chars.join('')).toBe('Hello. World!');
  });

  it('produces monotonic non-decreasing start times across the seam', () => {
    const a = alignmentFor('abc'); // ends at 3s
    const b = alignmentFor('def'); // 0..3 locally
    const stitched = stitchAlignments([a, b]);
    for (let i = 1; i < stitched.charStartTimesSec.length; i++) {
      expect(stitched.charStartTimesSec[i]).toBeGreaterThanOrEqual(
        stitched.charStartTimesSec[i - 1],
      );
    }
  });

  it("offsets chunk 1's times by chunk 0's duration exactly", () => {
    const a = alignmentFor('abc'); // max end = 3
    const b = alignmentFor('def'); // local starts 0,1,2
    const stitched = stitchAlignments([a, b]);
    // chunk b's first char (local start 0) should be shifted by 3.
    expect(stitched.charStartTimesSec[3]).toBe(3);
    expect(stitched.charStartTimesSec[4]).toBe(4);
    expect(stitched.charStartTimesSec[5]).toBe(5);
  });

  it("chunk i+1's first start ≥ chunk i's last end", () => {
    const a = alignmentFor('abc'); // last end = 3
    const b = alignmentFor('def');
    const stitched = stitchAlignments([a, b]);
    const aLastEnd = stitched.charEndTimesSec[2];
    const bFirstStart = stitched.charStartTimesSec[3];
    expect(bFirstStart).toBeGreaterThanOrEqual(aLastEnd);
  });

  it('skips empty chunks without breaking offsets', () => {
    const a = alignmentFor('ab');
    const empty: ChunkAlignment = { chars: [], charStartTimesSec: [], charEndTimesSec: [] };
    const b = alignmentFor('cd');
    const stitched = stitchAlignments([a, empty, b]);
    expect(stitched.chars.join('')).toBe('abcd');
    expect(stitched.charStartTimesSec[2]).toBe(2); // b shifted by a's 2s duration
  });

  it('handles a single chunk identically (offset 0)', () => {
    const a = alignmentFor('solo');
    const stitched = stitchAlignments([a]);
    expect(stitched).toEqual(a);
  });
});

// --- Normalization reconcile -------------------------------------------------

describe('reconcileAlignment — chars.join() always equals request text', () => {
  it('returns alignment verbatim when it already reconstructs the text', () => {
    const text = 'Hello world';
    const a = alignmentFor(text);
    const out = reconcileAlignment(text, a);
    expect(out.chars.join('')).toBe(text);
    expect(out.charStartTimesSec).toEqual(a.charStartTimesSec);
  });

  it('reconciles when normalized ≠ alignment (uses alignment, keyed to input)', () => {
    const text = 'It cost $5.';
    // alignment keyed to input (matches text) vs a normalized variant that
    // expanded "$5" → "five dollars" and dropped the period.
    const alignment = alignmentFor(text);
    const normalized = alignmentFor('It cost five dollars');
    const out = reconcileAlignment(text, alignment, normalized);
    expect(out.chars.join('')).toBe(text);
  });

  it('reconciles onto input text when only a normalized alignment is reliable', () => {
    const text = 'It cost $5 today.';
    // No primary alignment; normalized differs (case + expanded symbol).
    const normalized = alignmentFor('it cost five dollars today.');
    const out = reconcileAlignment(text, undefined, normalized);
    expect(out.chars.join('')).toBe(text);
    expect(out.chars.length).toBe(text.length);
    // Times remain monotonic non-decreasing.
    for (let i = 1; i < out.charStartTimesSec.length; i++) {
      expect(out.charStartTimesSec[i]).toBeGreaterThanOrEqual(
        out.charStartTimesSec[i - 1],
      );
    }
  });

  it('returns zeroed-but-length-matched chars when no timing is available', () => {
    const text = 'No timing here.';
    const out = reconcileAlignment(text, undefined, undefined);
    expect(out.chars.join('')).toBe(text);
    expect(out.chars.length).toBe(text.length);
    expect(out.charStartTimesSec.every((t) => t === 0)).toBe(true);
  });

  it('handles empty source alignment by falling through to text', () => {
    const text = 'fallback';
    const empty: ChunkAlignment = { chars: [], charStartTimesSec: [], charEndTimesSec: [] };
    const out = reconcileAlignment(text, empty, undefined);
    expect(out.chars.join('')).toBe(text);
  });
});
