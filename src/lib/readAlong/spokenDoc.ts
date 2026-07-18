// Canonical spoken-document model for read-along TTS.
//
// buildSpokenDoc(fullAnswer) produces ONE tokenization that is the single
// source of truth for both (a) the exact string sent to ElevenLabs and (b) the
// addressable spans rendered in the DOM. It is built "canonical-first": the
// spokenText IS stripMarkdown(fullAnswer) verbatim, and words/sentences are
// scanned out of that exact string — so the two load-bearing invariants hold
// by construction:
//   - spokenText === stripMarkdown(fullAnswer)            (audio unchanged)
//   - spokenText.slice(word.charStart, word.charEnd) === word.text
//
// Pure / framework-free / no DOM — same ethos as src/lib/parseAnswer.ts.

import { parseAnswer } from '../parseAnswer';
import { stripMarkdown } from './stripMarkdown';

export type Emphasis = 'strong' | 'em' | undefined;

export interface SpokenWord {
  id: number; // stable global index; becomes data-w on the rendered span
  sentenceId: number; // owning sentence
  text: string; // spoken text of this word, markdown removed
  charStart: number; // inclusive offset into SpokenDoc.spokenText
  charEnd: number; // exclusive
  emphasis: Emphasis; // markdown emphasis to preserve when rendering
}

export interface SpokenSentence {
  id: number; // stable global index; becomes data-s on the rendered span
  wordIds: number[];
  charStart: number; // inclusive offset into SpokenDoc.spokenText
  charEnd: number; // exclusive
  region: 'body' | 'impact'; // body paragraphs vs the Business Impact card
}

export interface SpokenDoc {
  /** The EXACT string sent to ElevenLabs. Equals stripMarkdown(fullAnswer). */
  spokenText: string;
  sentences: SpokenSentence[];
  words: SpokenWord[];
}

// --- Word cursor (shared by the addressable render path) ---------------------

export interface WordCursor {
  /** Consume and return the next word in this region, or null if exhausted. */
  next(): SpokenWord | null;
}

/**
 * Build a cursor over a region's words (body or impact), in document order.
 *
 * A region is rendered from the SAME text that produced its slice of doc.words,
 * so the visible word sequence matches doc.words 1:1. The cursor hands out the
 * next word each time the renderer emits a non-whitespace run, letting the
 * components wrap words in <span data-w> and group them under <span data-s>
 * without needing to know character offsets.
 */
export function makeWordCursor(words: SpokenWord[]): WordCursor {
  let i = 0;
  return {
    next() {
      return i < words.length ? words[i++] : null;
    },
  };
}

// --- Emphasis overlay --------------------------------------------------------

// Same precedence as parseInline: **bold**/__bold__ first, then *em*/_em_.
// Flanking-aware: intra-word delimiters don't trigger emphasis (e.g., snake_case).
const EMPHASIS_PATTERN =
  /(\*\*(?!\s)([^*\n]*?\S)\*\*)|(?<!\w)(__(?!\s)([^_\n]*?\S)__)(?!\w)|(?<![\w*])(\*(?!\s)([^*\n]*?\S)\*)(?![\w*])|(?<!\w)(_(?!\s)([^_\n]*?\S)_)(?!\w)/g;

/**
 * Build a per-character emphasis overlay aligned to spokenText.
 *
 * We scan the ORIGINAL markdown for emphasis runs (in source order), strip the
 * inner text the same way stripMarkdown would, then locate that inner text in
 * spokenText from a forward-moving cursor (so duplicate phrases map in order).
 * Any character covered by a run is tagged 'strong' or 'em'.
 */
function buildEmphasisOverlay(fullAnswer: string, spokenText: string): Emphasis[] {
  const overlay: Emphasis[] = new Array(spokenText.length).fill(undefined);
  if (!fullAnswer || !spokenText) return overlay;

  let cursor = 0;
  let m: RegExpExecArray | null;
  const pattern = new RegExp(EMPHASIS_PATTERN.source, 'g');

  while ((m = pattern.exec(fullAnswer)) !== null) {
    const isStrong = m[2] !== undefined || m[4] !== undefined;
    const inner = m[2] ?? m[4] ?? m[6] ?? m[8];
    if (inner === undefined) continue;

    // Strip markdown from the inner run so it matches what's in spokenText.
    const spokenInner = stripMarkdown(inner);
    if (!spokenInner) continue;

    const at = spokenText.indexOf(spokenInner, cursor);
    if (at === -1) continue; // emphasis didn't survive stripping (rare) — skip

    const emph: Emphasis = isStrong ? 'strong' : 'em';
    for (let i = at; i < at + spokenInner.length; i++) {
      // First writer wins for overlapping runs (outermost bold dominates).
      if (overlay[i] === undefined) overlay[i] = emph;
    }
    cursor = at + spokenInner.length;
  }

  return overlay;
}

// --- Sentence-boundary detection --------------------------------------------

// Lowercased abbreviations whose trailing "." must NOT end a sentence.
const ABBREVIATIONS = new Set([
  'e.g.',
  'i.e.',
  'mr.',
  'mrs.',
  'ms.',
  'dr.',
  'vs.',
  'etc.',
  'st.',
  'jr.',
  'sr.',
  'fig.',
  'no.',
  'u.s.',
  'u.k.',
  'a.m.',
  'p.m.',
]);

/**
 * Does `word` end a sentence on its own (terminal punctuation), accounting for
 * decimals (4.6), single-letter initials, and common abbreviations?
 */
function endsSentence(word: string): boolean {
  // Strip trailing closing brackets/quotes so `done.)` or `done."` still count.
  const trimmed = word.replace(/["')\]]+$/, '');
  const last = trimmed[trimmed.length - 1];
  if (last !== '.' && last !== '!' && last !== '?') return false;

  // `!` and `?` are unambiguous terminals.
  if (last === '!' || last === '?') return true;

  // From here `last === '.'`.
  // Decimal like "4.6" — digit on both sides of an interior dot, no terminal.
  if (/\d\.\d/.test(trimmed)) {
    // Only a true terminal if the dot is final AND not part of a decimal.
    // e.g. "4.6." would terminate, but "4.6" would not.
    if (!trimmed.endsWith('.') || /\d$/.test(trimmed)) return false;
  }

  const lower = trimmed.toLowerCase();

  // Known abbreviation (e.g., U.S., e.g., Mr.).
  if (ABBREVIATIONS.has(lower)) return false;

  // Single-letter initial like "A." (and we already cover U.S. via the set).
  if (/^[a-z]\.$/.test(lower)) return false;

  return true;
}

// --- Word scanning -----------------------------------------------------------

interface RawWord {
  text: string;
  charStart: number;
  charEnd: number;
  region: 'body' | 'impact';
  emphasis: Emphasis;
}

/**
 * Scan maximal non-whitespace runs out of spokenText, drop any that fall inside
 * the heading range, and tag region + emphasis. Offsets are exact by
 * construction (we index directly into spokenText).
 */
function scanWords(
  spokenText: string,
  headingStart: number,
  headingEnd: number,
  impactStart: number,
  overlay: Emphasis[],
): RawWord[] {
  const words: RawWord[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(spokenText)) !== null) {
    const start = m.index;
    const end = start + m[0].length;

    // Drop words that overlap the heading range (the "Business Impact" label).
    if (start < headingEnd && end > headingStart) continue;

    const region: 'body' | 'impact' = start >= impactStart ? 'impact' : 'body';
    words.push({
      text: m[0],
      charStart: start,
      charEnd: end,
      region,
      emphasis: overlay[start],
    });
  }

  return words;
}

// --- Public API --------------------------------------------------------------

/**
 * Turn a full markdown answer into a SpokenDoc: ordered sentences + words, each
 * carrying exact character offsets into a canonical spokenText string.
 *
 * Streaming-safe: partial/empty/markdown-fragment input never throws. An empty
 * or whitespace-only answer yields an empty doc.
 */
export function buildSpokenDoc(fullAnswer: string): SpokenDoc {
  const spokenText = stripMarkdown(fullAnswer ?? '');

  if (!spokenText) {
    return { spokenText: '', sentences: [], words: [] };
  }

  // Region split — body is the prefix, impact (if any) is the suffix.
  const { body, impact } = parseAnswer(fullAnswer);
  const bodyText = stripMarkdown(body);
  const impactText = impact != null ? stripMarkdown(impact) : null;

  // Locate region boundaries inside spokenText. Guard so a whitespace hiccup
  // degrades to "all body" rather than throwing or mis-tagging.
  const bodyEnd = bodyText.length <= spokenText.length ? bodyText.length : spokenText.length;
  let impactStart = spokenText.length;
  if (impactText) {
    const found = spokenText.lastIndexOf(impactText);
    impactStart = found >= 0 ? found : spokenText.length;
  }
  // Heading range = the gap between body end and impact start (the label line).
  const headingStart = Math.min(bodyEnd, impactStart);
  const headingEnd = impactStart;

  const overlay = buildEmphasisOverlay(fullAnswer, spokenText);
  const rawWords = scanWords(spokenText, headingStart, headingEnd, impactStart, overlay);

  const words: SpokenWord[] = [];
  const sentences: SpokenSentence[] = [];

  let sentenceId = -1;
  let prevWord: RawWord | null = null;

  for (const raw of rawWords) {
    let startNewSentence = false;

    if (prevWord === null) {
      startNewSentence = true;
    } else if (prevWord.region !== raw.region) {
      // Region change always starts a new sentence.
      startNewSentence = true;
    } else if (endsSentence(prevWord.text)) {
      // Previous word terminated a sentence.
      startNewSentence = true;
    } else {
      // A newline sitting in the gap before this word (list item / line break)
      // makes this word the start of a fresh sentence.
      const gap = spokenText.slice(prevWord.charEnd, raw.charStart);
      if (gap.includes('\n')) startNewSentence = true;
    }

    if (startNewSentence) {
      sentenceId += 1;
      sentences.push({
        id: sentenceId,
        wordIds: [],
        charStart: raw.charStart,
        charEnd: raw.charEnd,
        region: raw.region,
      });
    }

    const wordId = words.length;
    const sentence = sentences[sentenceId];
    sentence.wordIds.push(wordId);
    sentence.charEnd = raw.charEnd; // trim sentence to word bounds → contiguity

    words.push({
      id: wordId,
      sentenceId,
      text: raw.text,
      charStart: raw.charStart,
      charEnd: raw.charEnd,
      emphasis: raw.emphasis,
    });

    prevWord = raw;
  }

  return { spokenText, sentences, words };
}
