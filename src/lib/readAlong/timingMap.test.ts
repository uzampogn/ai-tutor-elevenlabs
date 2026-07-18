// Spec 03 — pure unit tests for the timing map. No DOM, no network.

import { describe, it, expect } from 'vitest';
import { buildTimings, activeIndexAt, type Alignment, type Timing } from './timingMap';
import { buildSpokenDoc, type SpokenDoc, type SpokenWord, type SpokenSentence } from './spokenDoc';

// --- Fixture helpers ---------------------------------------------------------

/**
 * Build a hand-made SpokenDoc directly from a list of {text, sentenceId}, laying
 * words out over a spokenText with single spaces between them. Char offsets are
 * computed by construction so spokenText.slice(charStart,charEnd) === text.
 */
function makeDoc(tokens: { text: string; sentenceId: number }[]): SpokenDoc {
  const words: SpokenWord[] = [];
  const sentenceMap = new Map<number, SpokenSentence>();
  let cursor = 0;
  const pieces: string[] = [];

  tokens.forEach((tok, i) => {
    if (i > 0) {
      pieces.push(' ');
      cursor += 1;
    }
    const charStart = cursor;
    const charEnd = cursor + tok.text.length;
    pieces.push(tok.text);
    cursor = charEnd;

    const word: SpokenWord = {
      id: i,
      sentenceId: tok.sentenceId,
      text: tok.text,
      charStart,
      charEnd,
      emphasis: undefined,
    };
    words.push(word);

    let sentence = sentenceMap.get(tok.sentenceId);
    if (!sentence) {
      sentence = {
        id: tok.sentenceId,
        wordIds: [],
        charStart,
        charEnd,
        region: 'body',
      };
      sentenceMap.set(tok.sentenceId, sentence);
    }
    sentence.wordIds.push(word.id);
    sentence.charEnd = charEnd;
  });

  const spokenText = pieces.join('');
  const sentences = Array.from(sentenceMap.values()).sort((a, b) => a.id - b.id);
  return { spokenText, sentences, words, blocks: [] };
}

/**
 * Build a per-character alignment for `spokenText` where each character i gets
 * [i*step, (i+1)*step]. Length matches spokenText.length by construction.
 */
function makeAlignment(spokenText: string, step = 1): Alignment {
  const chars = Array.from(spokenText);
  const charStartTimesSec = chars.map((_, i) => i * step);
  const charEndTimesSec = chars.map((_, i) => (i + 1) * step);
  return { chars, charStartTimesSec, charEndTimesSec };
}

// --- Exact mapping -----------------------------------------------------------

describe('buildTimings — exact mapping', () => {
  it('maps hand-built doc+alignment to golden sentence/word windows', () => {
    // "ab cd ef" → words ab[0,2) cd[3,5) ef[6,8); sentences: {ab,cd}=0, {ef}=1
    const doc = makeDoc([
      { text: 'ab', sentenceId: 0 },
      { text: 'cd', sentenceId: 0 },
      { text: 'ef', sentenceId: 1 },
    ]);
    expect(doc.spokenText).toBe('ab cd ef');
    const align = makeAlignment(doc.spokenText, 1); // 1s per char

    const t = buildTimings(doc, align);
    expect(t.estimated).toBeUndefined();

    // Words: start = charStartTimesSec[charStart], end = charEndTimesSec[charEnd-1]
    expect(t.words).toEqual<Timing[]>([
      { id: 0, startSec: 0, endSec: 2 }, // ab: chars 0,1 → start[0]=0, end[1]=2
      { id: 1, startSec: 3, endSec: 5 }, // cd: chars 3,4 → start[3]=3, end[4]=5
      { id: 2, startSec: 6, endSec: 8 }, // ef: chars 6,7 → start[6]=6, end[7]=8
    ]);

    // Sentences: [firstWord.start, lastWord.end]
    expect(t.sentences).toEqual<Timing[]>([
      { id: 0, startSec: 0, endSec: 5 }, // ab..cd
      { id: 1, startSec: 6, endSec: 8 }, // ef
    ]);

    expect(t.totalSec).toBe(8); // max(charEndTimesSec)
  });

  it('honors a non-unit time step', () => {
    const doc = makeDoc([
      { text: 'go', sentenceId: 0 },
      { text: 'on', sentenceId: 0 },
    ]);
    const align = makeAlignment(doc.spokenText, 0.5); // "go on", 5 chars
    const t = buildTimings(doc, align);
    expect(t.words[0]).toEqual({ id: 0, startSec: 0, endSec: 1 }); // go: end[1]=2*0.5
    expect(t.words[1]).toEqual({ id: 1, startSec: 1.5, endSec: 2.5 }); // on: start[3]=1.5
    expect(t.totalSec).toBeCloseTo(2.5, 10);
  });
});

// --- Boundary chars ----------------------------------------------------------

describe('buildTimings — boundaries', () => {
  it('first word starts at charStartTimesSec[0]; last word ends at charEndTimesSec[N-1]', () => {
    const doc = makeDoc([
      { text: 'one', sentenceId: 0 },
      { text: 'two', sentenceId: 1 },
      { text: 'three', sentenceId: 2 },
    ]);
    const align = makeAlignment(doc.spokenText, 1);
    const N = align.charStartTimesSec.length;
    const t = buildTimings(doc, align);

    expect(t.words[0].startSec).toBe(align.charStartTimesSec[0]);
    expect(t.words[t.words.length - 1].endSec).toBe(align.charEndTimesSec[N - 1]);
  });

  it('sentence window equals [firstWord.start, lastWord.end]', () => {
    const doc = makeDoc([
      { text: 'aa', sentenceId: 0 },
      { text: 'bb', sentenceId: 0 },
      { text: 'cc', sentenceId: 0 },
    ]);
    const align = makeAlignment(doc.spokenText, 2);
    const t = buildTimings(doc, align);
    const first = t.words[0];
    const last = t.words[t.words.length - 1];
    expect(t.sentences[0]).toEqual({ id: 0, startSec: first.startSec, endSec: last.endSec });
  });
});

// --- Monotonic & clamped -----------------------------------------------------

describe('buildTimings — monotonic & clamped', () => {
  it('forces end >= start when a char window is inverted', () => {
    const doc = makeDoc([{ text: 'x', sentenceId: 0 }]);
    // Single char "x"; make end < start to invert the window.
    const align: Alignment = {
      chars: ['x'],
      charStartTimesSec: [5],
      charEndTimesSec: [3], // end before start
    };
    const t = buildTimings(doc, align);
    expect(t.words[0].endSec).toBeGreaterThanOrEqual(t.words[0].startSec);
  });

  it('keeps sentence starts non-decreasing despite a backward upstream time', () => {
    const doc = makeDoc([
      { text: 'aa', sentenceId: 0 },
      { text: 'bb', sentenceId: 1 },
      { text: 'cc', sentenceId: 2 },
    ]);
    // "aa bb cc" → 8 chars. Corrupt so sentence 1's start is earlier than 0's.
    const align = makeAlignment(doc.spokenText, 1);
    // bb starts at char index 3 → drag its start time way back (negative).
    align.charStartTimesSec[3] = -100;
    const t = buildTimings(doc, align);

    for (let i = 1; i < t.sentences.length; i++) {
      expect(t.sentences[i].startSec).toBeGreaterThanOrEqual(t.sentences[i - 1].startSec);
    }
    for (const s of t.sentences) {
      expect(s.endSec).toBeGreaterThanOrEqual(s.startSec);
    }
  });

  it('keeps word starts non-decreasing too', () => {
    const doc = makeDoc([
      { text: 'aa', sentenceId: 0 },
      { text: 'bb', sentenceId: 0 },
      { text: 'cc', sentenceId: 0 },
    ]);
    const align = makeAlignment(doc.spokenText, 1);
    align.charStartTimesSec[3] = -5; // bb dragged backward
    const t = buildTimings(doc, align);
    for (let i = 1; i < t.words.length; i++) {
      expect(t.words[i].startSec).toBeGreaterThanOrEqual(t.words[i - 1].startSec);
    }
  });

  it('clamps out-of-range char offsets instead of indexing undefined', () => {
    // Doc claims a word past the alignment's end; should clamp to N-1.
    const doc: SpokenDoc = {
      spokenText: 'abcd',
      words: [{ id: 0, sentenceId: 0, text: 'abcd', charStart: 0, charEnd: 99, emphasis: undefined }],
      sentences: [{ id: 0, wordIds: [0], charStart: 0, charEnd: 99, region: 'body' }],
      blocks: [],
    };
    const align = makeAlignment('abcd', 1); // N=4
    const t = buildTimings(doc, align);
    expect(Number.isFinite(t.words[0].endSec)).toBe(true);
    expect(t.words[0].endSec).toBe(align.charEndTimesSec[3]); // clamped to last
  });
});

// --- Proportional fallback ---------------------------------------------------

describe('buildTimings — proportional fallback', () => {
  it('estimates windows by text.length on a length mismatch, summing to totalSec', () => {
    const doc = makeDoc([
      { text: 'aa', sentenceId: 0 }, // len 2
      { text: 'bbbb', sentenceId: 1 }, // len 4
    ]);
    // Length mismatch: alignment chars count differs from spokenText length, but
    // carries real timing so we can derive totalSec from it (= 12).
    const align: Alignment = {
      chars: ['mismatch'], // length 1, but spokenText.length is 7 ("aa bbbb")
      charStartTimesSec: [0],
      charEndTimesSec: [12],
    };
    const t = buildTimings(doc, align);

    expect(t.estimated).toBe(true);
    expect(t.totalSec).toBe(12);

    // Words: weights 2 and 4 → 1/3 and 2/3 of 12 → [0,4] and [4,12].
    expect(t.words[0].startSec).toBe(0);
    expect(t.words[0].endSec).toBeCloseTo(4, 10);
    expect(t.words[1].startSec).toBeCloseTo(4, 10);
    expect(t.words[1].endSec).toBe(12);

    // Words tile [0, totalSec] contiguously.
    expect(t.words[0].startSec).toBe(0);
    expect(t.words[t.words.length - 1].endSec).toBeCloseTo(t.totalSec, 10);
    for (let i = 1; i < t.words.length; i++) {
      expect(t.words[i].startSec).toBeCloseTo(t.words[i - 1].endSec, 10);
    }

    // Sentences likewise sum to totalSec (weights = sum of their words' lengths).
    expect(t.sentences[0].startSec).toBe(0);
    expect(t.sentences[t.sentences.length - 1].endSec).toBeCloseTo(t.totalSec, 10);
  });

  it('uses totalSec 0 when a mismatched alignment carries no timing', () => {
    const doc = makeDoc([{ text: 'hello', sentenceId: 0 }]);
    const align: Alignment = { chars: ['x', 'y'], charStartTimesSec: [], charEndTimesSec: [] };
    const t = buildTimings(doc, align);
    expect(t.estimated).toBe(true);
    expect(t.totalSec).toBe(0);
    expect(t.words[0]).toEqual({ id: 0, startSec: 0, endSec: 0 });
  });

  it('produces non-decreasing, end>=start windows in the proportional path', () => {
    const doc = makeDoc([
      { text: 'a', sentenceId: 0 },
      { text: 'bb', sentenceId: 0 },
      { text: 'ccc', sentenceId: 1 },
    ]);
    const align: Alignment = { chars: ['z'], charStartTimesSec: [0], charEndTimesSec: [9] };
    const t = buildTimings(doc, align);
    for (const list of [t.words, t.sentences]) {
      for (let i = 0; i < list.length; i++) {
        expect(list[i].endSec).toBeGreaterThanOrEqual(list[i].startSec);
        if (i > 0) expect(list[i].startSec).toBeGreaterThanOrEqual(list[i - 1].startSec);
      }
    }
  });
});

// --- Empty / degenerate ------------------------------------------------------

describe('buildTimings — empty / degenerate', () => {
  it('empty doc → empty timings', () => {
    const doc: SpokenDoc = { spokenText: '', words: [], sentences: [], blocks: [] };
    const align = makeAlignment('abc', 1);
    expect(buildTimings(doc, align)).toEqual({ sentences: [], words: [], totalSec: 0 });
  });

  it('empty alignment + non-empty doc → estimated, totalSec 0, zero windows', () => {
    const doc = makeDoc([{ text: 'hi', sentenceId: 0 }]);
    const empty: Alignment = { chars: [], charStartTimesSec: [], charEndTimesSec: [] };
    const t = buildTimings(doc, empty);
    expect(t.totalSec).toBe(0);
    expect(t.estimated).toBe(true);
    expect(t.words[0]).toEqual({ id: 0, startSec: 0, endSec: 0 });
    expect(t.sentences[0]).toEqual({ id: 0, startSec: 0, endSec: 0 });
  });

  it('single-word doc works', () => {
    const doc = makeDoc([{ text: 'solo', sentenceId: 0 }]);
    const align = makeAlignment(doc.spokenText, 1); // 4 chars
    const t = buildTimings(doc, align);
    expect(t.words).toEqual([{ id: 0, startSec: 0, endSec: 4 }]);
    expect(t.sentences).toEqual([{ id: 0, startSec: 0, endSec: 4 }]);
    expect(t.totalSec).toBe(4);
  });
});

// --- Integration with buildSpokenDoc ----------------------------------------

describe('buildTimings — with a real buildSpokenDoc', () => {
  it('maps a parsed answer with a length-matched alignment (no estimation)', () => {
    const doc = buildSpokenDoc('Hello world. This is fine.');
    const align = makeAlignment(doc.spokenText, 1);
    expect(align.chars.length).toBe(doc.spokenText.length); // invariant precondition

    const t = buildTimings(doc, align);
    expect(t.estimated).toBeUndefined();
    expect(t.words.length).toBe(doc.words.length);
    expect(t.sentences.length).toBe(doc.sentences.length);

    // Every word window matches its char offsets directly.
    doc.words.forEach((w, i) => {
      expect(t.words[i].startSec).toBe(align.charStartTimesSec[w.charStart]);
      expect(t.words[i].endSec).toBe(align.charEndTimesSec[w.charEnd - 1]);
    });
    // totalSec is the max end.
    expect(t.totalSec).toBe(Math.max(...align.charEndTimesSec));
  });
});

// --- activeIndexAt -----------------------------------------------------------

describe('activeIndexAt', () => {
  // Three windows: [0,2], [2,4], [4,6] (back-to-back).
  const windows: Timing[] = [
    { id: 0, startSec: 0, endSec: 2 },
    { id: 1, startSec: 2, endSec: 4 },
    { id: 2, startSec: 4, endSec: 6 },
  ];

  it('returns -1 before the first window', () => {
    expect(activeIndexAt(windows, -1)).toBe(-1);
  });

  it('returns the active index inside each window', () => {
    expect(activeIndexAt(windows, 0)).toBe(0);
    expect(activeIndexAt(windows, 1)).toBe(0);
    expect(activeIndexAt(windows, 2)).toBe(1); // boundary belongs to next window's start
    expect(activeIndexAt(windows, 3)).toBe(1);
    expect(activeIndexAt(windows, 4)).toBe(2);
  });

  it('returns the last index at/after the last window', () => {
    expect(activeIndexAt(windows, 5)).toBe(2);
    expect(activeIndexAt(windows, 999)).toBe(2);
  });

  it('returns -1 for an empty list', () => {
    expect(activeIndexAt([], 3)).toBe(-1);
  });

  it('fromHint forward-scan equals a fresh search across the whole timeline', () => {
    let hint = -1;
    for (let t = -1; t <= 7; t += 0.25) {
      const fresh = activeIndexAt(windows, t);
      const hinted = activeIndexAt(windows, t, hint < 0 ? undefined : hint);
      expect(hinted).toBe(fresh);
      hint = hinted;
    }
  });

  it('handles a backward seek (hint ahead of t) correctly', () => {
    // Pretend we were at index 2, then seek back to t=1 (inside window 0).
    expect(activeIndexAt(windows, 1, 2)).toBe(0);
    // Seek back before the first window.
    expect(activeIndexAt(windows, -5, 2)).toBe(-1);
  });

  it('ignores an out-of-range hint and still returns the correct index', () => {
    expect(activeIndexAt(windows, 3, 99)).toBe(1);
    expect(activeIndexAt(windows, 3, -7)).toBe(1);
  });

  it('forward scan from a stale-but-valid hint advances to the right window', () => {
    // Hint at 0 but time is in window 2.
    expect(activeIndexAt(windows, 5, 0)).toBe(2);
  });
});

describe('code-point alignment expansion (Spec 11)', () => {
  const codePointAlignment = (text: string) => {
    const cps = Array.from(text);
    return {
      chars: cps,
      charStartTimesSec: cps.map((_, i) => i * 0.1),
      charEndTimesSec: cps.map((_, i) => (i + 1) * 0.1),
    };
  };

  it('takes the measured path for emoji answers', () => {
    const doc = buildSpokenDoc('Great results 🚀 today.\n\n💼 Business Impact\n\nRevenue grew.');
    const t = buildTimings(doc, codePointAlignment(doc.spokenText));
    expect(t.estimated).toBeFalsy();
    expect(t.words.length).toBe(doc.words.length);
    for (let i = 1; i < t.words.length; i++) {
      expect(t.words[i].startSec).toBeGreaterThanOrEqual(t.words[i - 1].startSec);
    }
  });

  it('handles astral chars at the edges and ZWJ sequences', () => {
    for (const text of ['🚀 start here', 'end here 🚀', 'mid 👩‍💻 word']) {
      const doc = buildSpokenDoc(text);
      const t = buildTimings(doc, codePointAlignment(doc.spokenText));
      expect(t.estimated, text).toBeFalsy();
    }
  });

  it('still falls back when chars do not reconstruct spokenText', () => {
    const doc = buildSpokenDoc('Plain text answer here. 🚀');
    const a = codePointAlignment(doc.spokenText);
    a.chars = a.chars.slice(1); // drop a char → join mismatch AND length mismatch
    a.charStartTimesSec = a.charStartTimesSec.slice(1);
    a.charEndTimesSec = a.charEndTimesSec.slice(1);
    expect(buildTimings(doc, a).estimated).toBe(true);
  });
});
