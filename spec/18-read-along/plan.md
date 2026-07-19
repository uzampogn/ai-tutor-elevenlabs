# Read-Along Desync Fix — Implementation Plan (Specs 09–12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make read-along highlighting correct for long / markdown-heavy / emoji-bearing answers by rendering the answer from the canonical SpokenDoc (one tokenization), restoring measured timings for astral characters, and instrumenting chunk-seam drift.

**Architecture:** `spokenText` stays `stripMarkdown(fullAnswer)` (TTS unchanged). Spec 09 adds a block-structure overlay to `buildSpokenDoc` (same forward-cursor technique as the emphasis overlay) plus boundary-aware emphasis stripping. Spec 10 renders the answer from that doc (`DocBlocks` component) and matches highlight spans by `data-s` id. Spec 11 expands code-point-indexed alignments to UTF-16 in `buildTimings`. Spec 12 adds drift diagnostics only.

**Tech Stack:** Next.js 14, React 18, TypeScript 5, Vitest (+ RTL/jsdom for components). Node 24 (`nvm use`).

## Global Constraints

- Quality gate before every push: `npm run lint && npm run typecheck && npm run test:run` (project CLAUDE.md).
- `buildSpokenDoc` must never throw on partial/streaming input (spokenDoc.ts contract).
- `spokenText === stripMarkdown(fullAnswer)` stays true (audio path unchanged by 09/10).
- `stripMarkdown` must stay idempotent: `strip(strip(x)) === strip(x)` (`/api/speak` re-strips defensively, route.ts:68).
- Branches per workspace workflow: `feat/09-doc-blocks-overlay` off `main`; `feat/10-doc-driven-render` **stacked on 09's branch**; `feat/11-codepoint-alignment` and `feat/12-seam-instrumentation` off `main`, independent. Work in a git worktree (superpowers:using-git-worktrees). Push + open PR (`gh pr create`) as soon as each spec's verification passes — 09's PR targets `main`, 10's PR targets 09's branch, 11/12 target `main`.
- Specs live beside this plan: `spec/read-along/09..12-*.md`. Read the task's spec section before implementing.

---

## Spec 09 — branch `feat/09-doc-blocks-overlay`

### Task 1: Boundary-aware emphasis stripping in `stripMarkdown`

**Files:**
- Modify: `src/lib/readAlong/stripMarkdown.ts`
- Test: `src/lib/readAlong/stripMarkdown.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `stripMarkdown(text: string): string` (same signature); intra-word `_`/`*` now survive; emphasis no longer pairs across lines.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/readAlong/stripMarkdown.test.ts
import { describe, it, expect } from 'vitest';
import { stripMarkdown } from './stripMarkdown';

describe('stripMarkdown emphasis flanking', () => {
  it('strips real emphasis markers', () => {
    expect(stripMarkdown('a **bold** word')).toBe('a bold word');
    expect(stripMarkdown('a __bold__ word')).toBe('a bold word');
    expect(stripMarkdown('an *em* word')).toBe('an em word');
    expect(stripMarkdown('an _em_ word')).toBe('an em word');
    expect(stripMarkdown('(*note*) and _x_')).toBe('(note) and x');
  });

  it('keeps intra-word underscores and asterisks', () => {
    expect(stripMarkdown('The user_id and auth_token fields.')).toBe(
      'The user_id and auth_token fields.',
    );
    expect(stripMarkdown('snake_case_name stays')).toBe('snake_case_name stays');
    expect(stripMarkdown('compute a*b*c fast')).toBe('compute a*b*c fast');
  });

  it('does not pair stray markers across whitespace/lines', () => {
    expect(stripMarkdown('5 * 3 and 4 * 2')).toBe('5 * 3 and 4 * 2');
    expect(stripMarkdown('one _\ntwo _ three')).toBe('one _\ntwo _ three');
  });

  it('is idempotent on every fixture', () => {
    const fixtures = [
      'a **bold** word', 'The user_id and auth_token fields.', '5 * 3 and 4 * 2',
      '## H\n\n- item one\n  - nested\n\n> quote\n\n---\n\n`code` and [t](u) 💼',
    ];
    for (const f of fixtures) {
      const once = stripMarkdown(f);
      expect(stripMarkdown(once)).toBe(once);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/readAlong/stripMarkdown.test.ts`. Expected: intra-word / stray-marker cases FAIL (current regexes strip them).

- [ ] **Step 3: Implement** — replace the two emphasis lines in `stripMarkdown.ts`:

```ts
    // OLD:
    // .replace(/(\*\*|__)([\s\S]*?)\1/g, '$2')
    // .replace(/(\*|_)([\s\S]*?)\1/g, '$2')
    // NEW — flanking-aware, single-line inner, marker-free inner:
    .replace(/\*\*(?!\s)([^*\n]*?\S)\*\*/g, '$1')
    .replace(/(?<!\w)__(?!\s)([^_\n]*?\S)__(?!\w)/g, '$1')
    .replace(/(?<![\w*])\*(?!\s)([^*\n]*?\S)\*(?![\w*])/g, '$1')
    .replace(/(?<!\w)_(?!\s)([^_\n]*?\S)_(?!\w)/g, '$1')
```

Order stays: after inline-code handling, before image/link stripping (same slot as the old two lines). Single-char inner works (`[^…]*?` may be empty; the `\S` is the char).

- [ ] **Step 4: Run tests** — same command. Expected: PASS. Also run `npx vitest run src/lib/readAlong src/app/api/speak` — existing spokenDoc/chunking/route tests must still pass (none of their fixtures use intra-word markers; if one asserts the old mangling, update that fixture's expectation and note it in the commit).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "fix(read-along): boundary-aware emphasis stripping keeps intra-word _ and *"`

### Task 2: Align `buildEmphasisOverlay`'s pattern with the new flanking rules

**Files:**
- Modify: `src/lib/readAlong/spokenDoc.ts:71` (`EMPHASIS_PATTERN`)
- Test: `src/lib/readAlong/spokenDoc.test.ts`

**Interfaces:**
- Produces: unchanged API; `SpokenWord.emphasis` now only set for genuinely flanked runs.

- [ ] **Step 1: Write the failing test** (append to `spokenDoc.test.ts`):

```ts
describe('emphasis overlay flanking (Spec 09)', () => {
  it('does not tag snake_case as emphasis', () => {
    const doc = buildSpokenDoc('The user_id maps to auth_token here.');
    expect(doc.words.every((w) => w.emphasis === undefined)).toBe(true);
    expect(doc.spokenText).toContain('user_id');
  });

  it('still tags real strong/em', () => {
    const doc = buildSpokenDoc('a **bold** and _soft_ word');
    const byText = (t: string) => doc.words.find((w) => w.text === t)!;
    expect(byText('bold').emphasis).toBe('strong');
    expect(byText('soft').emphasis).toBe('em');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/readAlong/spokenDoc.test.ts`. Expected: snake_case test FAILS (old pattern tags `_case_`… and/or spokenText lacks `user_id` before Task 1; after Task 1 the overlay pattern is the remaining offender).

- [ ] **Step 3: Implement** — replace `EMPHASIS_PATTERN` with the flanking-aware equivalent (group numbers preserved so `m[2]/m[4]/m[6]/m[8]` usage at spokenDoc.ts:90-91 is unchanged):

```ts
const EMPHASIS_PATTERN =
  /(\*\*(?!\s)([^*\n]*?\S)\*\*)|(?<!\w)(__(?!\s)([^_\n]*?\S)__)(?!\w)|(?<![\w*])(\*(?!\s)([^*\n]*?\S)\*)(?![\w*])|(?<!\w)(_(?!\s)([^_\n]*?\S)_)(?!\w)/g;
```

- [ ] **Step 4: Run tests** — `npx vitest run src/lib/readAlong`. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(read-along): emphasis overlay uses the same flanking rules as stripMarkdown"`

### Task 3: `parseBlocks` learns fences, images, bullets variants, blockquotes, hrules

**Files:**
- Modify: `src/lib/parseAnswer.ts` (Block type, UL/OL regexes, `parseBlocks`)
- Test: `src/lib/parseAnswer.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Block =
    | { type: 'paragraph'; text: string }
    | { type: 'ul'; items: string[] }
    | { type: 'ol'; items: string[] }
    | { type: 'code'; raw: string }
    | { type: 'image'; alt: string };
  ```
  `parseBlocks(body: string): Block[]` — same name/signature. Task 4 and Spec 10 consume the new variants.

- [ ] **Step 1: Write the failing tests** (append to `parseAnswer.test.ts`):

```ts
describe('parseBlocks extensions (Spec 09)', () => {
  it('extracts fenced code (fences may contain blank lines)', () => {
    const blocks = parseBlocks('Intro:\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter.');
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'Intro:' },
      { type: 'code', raw: 'const a = 1;\n\nconst b = 2;' },
      { type: 'paragraph', text: 'After.' },
    ]);
  });

  it('treats an unterminated fence tail as an open code block', () => {
    const blocks = parseBlocks('Text.\n\n```py\nprint(1)');
    expect(blocks[1]).toEqual({ type: 'code', raw: 'print(1)' });
  });

  it('recognizes indented and + bullets', () => {
    const blocks = parseBlocks('- top\n  - nested\n+ plus');
    expect(blocks).toEqual([{ type: 'ul', items: ['top', 'nested', 'plus'] }]);
  });

  it('recognizes indented ordered items', () => {
    expect(parseBlocks('1. one\n  2. two')).toEqual([{ type: 'ol', items: ['one', 'two'] }]);
  });

  it('strips blockquote markers into the paragraph', () => {
    expect(parseBlocks('> quoted line\n> second')).toEqual([
      { type: 'paragraph', text: 'quoted line\nsecond' },
    ]);
  });

  it('drops horizontal rules and lifts image-only lines', () => {
    expect(parseBlocks('Before.\n\n---\n\n![diagram](https://x/y.png)\n\nAfter.')).toEqual([
      { type: 'paragraph', text: 'Before.' },
      { type: 'image', alt: 'diagram' },
      { type: 'paragraph', text: 'After.' },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/parseAnswer.test.ts`. Expected: new cases FAIL.

- [ ] **Step 3: Implement** in `parseAnswer.ts`:

```ts
const UL_LINE = /^\s*[-*+] /;
const OL_LINE = /^\s*\d+\. /;
const HR_LINE = /^\s*[-*_]{3,}\s*$/;
const IMAGE_LINE = /^\s*!\[([^\]]*)\]\([^)]*\)\s*$/;
const FENCE_LINE = /^\s*```/;

/** Split markdown into alternating prose / fenced-code segments (line-based). */
function splitFences(markdown: string): Array<{ code: boolean; text: string }> {
  const segments: Array<{ code: boolean; text: string }> = [];
  let buf: string[] = [];
  let inCode = false;
  const flush = () => {
    if (buf.length || inCode) segments.push({ code: inCode, text: buf.join('\n') });
    buf = [];
  };
  for (const line of markdown.split('\n')) {
    if (FENCE_LINE.test(line)) { flush(); inCode = !inCode; continue; }
    buf.push(line);
  }
  // Unterminated fence while streaming: tail stays an (open) code segment.
  if (buf.length) segments.push({ code: inCode, text: buf.join('\n') });
  return segments;
}
```

`parseBlocks` becomes a wrapper: for each `splitFences` segment, code segments emit `{ type: 'code', raw: text }` (skip if `text.trim()` is empty); prose segments run the existing chunk/run logic with three line-level additions inside the loop over `lines`:

```ts
      if (HR_LINE.test(line)) { flush(); continue; }
      const img = IMAGE_LINE.exec(line);
      if (img) { flush(); blocks.push({ type: 'image', alt: img[1] }); continue; }
```

and paragraph flush strips quote markers: `run.lines.map((l) => l.replace(/^\s*>\s+/, '')).join('\n').trim()`. Note `HR_LINE` must be tested BEFORE `lineKind` (a `- ` needs a space, but `***` would otherwise be noise), and `lineKind`'s UL/OL use the widened regexes above; item extraction keeps `l.replace(UL_LINE, '')` / `l.replace(OL_LINE, '')`.

- [ ] **Step 4: Run tests** — `npx vitest run src/lib/parseAnswer.test.ts src/components`. Expected: PASS, including existing parseBlocks/AiRow tests (renderer still handles only `paragraph|ul|ol` until Spec 10 — add a temporary exhaustive-switch default in `AiRow.tsx` returning `null` for `code`/`image` if typecheck complains).
- [ ] **Step 5: Commit** — `git commit -am "feat(parse): parseBlocks recognizes fences, images, bullet variants, blockquotes, hrules"`

### Task 4: Block overlay on `SpokenDoc`

**Files:**
- Modify: `src/lib/readAlong/spokenDoc.ts`
- Test: `src/lib/readAlong/spokenDoc.test.ts`

**Interfaces:**
- Produces (consumed by Spec 10's `DocBlocks`):
  ```ts
  export type DocBlockItem = { wordIds: number[] };
  export type DocBlock =
    | { type: 'paragraph'; region: 'body' | 'impact'; wordIds: number[] }
    | { type: 'ul' | 'ol'; region: 'body' | 'impact'; items: DocBlockItem[] }
    | { type: 'code'; region: 'body' | 'impact'; raw: string }
    | { type: 'image'; region: 'body' | 'impact'; alt: string };
  export interface SpokenDoc { spokenText: string; sentences: SpokenSentence[]; words: SpokenWord[]; blocks: DocBlock[]; }
  ```

- [ ] **Step 1: Write the failing tests** (append to `spokenDoc.test.ts`):

```ts
/** Flatten block word ids in document order. */
function flatIds(doc: SpokenDoc): number[] {
  const out: number[] = [];
  for (const b of doc.blocks) {
    if (b.type === 'paragraph') out.push(...b.wordIds);
    else if (b.type === 'ul' || b.type === 'ol') for (const it of b.items) out.push(...it.wordIds);
  }
  return out;
}

const RCA_FIXTURES: Record<string, string> = {
  heading: '## Key Takeaways\n\nModels improved a lot this year.',
  codeFence: 'Here is how:\n\n```js\nconst x = 1;\n```\n\nThat prints one.',
  inlineCode: 'Use the `claude-fable-5` model id for this.',
  snakeCase: 'The field user_id maps to the auth_token record.',
  bullets: 'Points:\n\n- Top level\n  - Nested here\n+ Plus item',
  blockquote: '> Quoted line here.\n\nRegular paragraph.',
  hrule: 'Before the rule.\n\n---\n\nAfter the rule.',
  image: 'See this: works.\n\n![alt text](https://example.com/i.png)\n\nDone now.',
  link: 'Read [the announcement](https://claude.com/blog/post) today.',
  doubleUnder: 'This is __really bold__ text.',
  emoji: 'Great results 🚀 this quarter.\n\n💼 Business Impact\n\nRevenue grew fast.',
  ordered: 'Steps:\n\n1. First do this\n2. Then that',
};

describe('block overlay (Spec 09)', () => {
  it('partitions words exactly, in order, for every fixture', () => {
    for (const [name, md] of Object.entries(RCA_FIXTURES)) {
      const doc = buildSpokenDoc(md);
      expect(flatIds(doc), name).toEqual(doc.words.map((w) => w.id));
    }
  });

  it('produces the expected block shapes', () => {
    const doc = buildSpokenDoc(RCA_FIXTURES.codeFence);
    expect(doc.blocks.map((b) => b.type)).toEqual(['paragraph', 'code', 'paragraph']);
    const code = doc.blocks[1] as Extract<DocBlock, { type: 'code' }>;
    expect(code.raw).toBe('const x = 1;');
    const lists = buildSpokenDoc(RCA_FIXTURES.bullets).blocks;
    expect(lists.map((b) => b.type)).toEqual(['paragraph', 'ul']);
    expect((lists[1] as Extract<DocBlock, { type: 'ul' }>).items).toHaveLength(3);
  });

  it('tags impact-region blocks', () => {
    const doc = buildSpokenDoc(RCA_FIXTURES.emoji);
    const regions = doc.blocks.map((b) => b.region);
    expect(regions).toEqual(['body', 'impact']);
  });

  it('never throws and keeps the partition on every streaming prefix', () => {
    const full = Object.values(RCA_FIXTURES).join('\n\n');
    for (let i = 0; i <= full.length; i++) {
      const doc = buildSpokenDoc(full.slice(0, i));
      expect(flatIds(doc)).toEqual(doc.words.map((w) => w.id));
    }
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/readAlong/spokenDoc.test.ts`. Expected: FAIL (`blocks` undefined).

- [ ] **Step 3: Implement** — add the types above and a `buildBlocks` section at the end of `buildSpokenDoc` (after `words`/`sentences` are final; empty doc returns `blocks: []`):

```ts
function buildBlocks(
  fullAnswer: string,
  spokenText: string,
  words: SpokenWord[],
  sentences: SpokenSentence[],
): DocBlock[] {
  const out: DocBlock[] = [];
  let cursor = 0; // forward char cursor into spokenText
  let wordIdx = 0; // next unassigned word (words are in document order)

  /** Locate a block's spoken form in spokenText from the cursor; advance on hit. */
  const locate = (raw: string): { start: number; end: number } | null => {
    const spoken = stripMarkdown(raw);
    if (!spoken) return null;
    const at = spokenText.indexOf(spoken, cursor);
    if (at === -1) return null;
    cursor = at + spoken.length;
    return { start: at, end: at + spoken.length };
  };

  /** Consume, in order, the words fully inside [start, end). */
  const takeWords = (start: number, end: number): number[] => {
    const ids: number[] = [];
    while (
      wordIdx < words.length &&
      words[wordIdx].charStart >= start &&
      words[wordIdx].charEnd <= end
    ) {
      ids.push(words[wordIdx].id);
      wordIdx += 1;
    }
    return ids;
  };

  const emit = (region: 'body' | 'impact', raw: string) => {
    for (const block of parseBlocks(raw)) {
      if (block.type === 'code') {
        if (block.raw.trim()) out.push({ type: 'code', region, raw: block.raw });
      } else if (block.type === 'image') {
        out.push({ type: 'image', region, alt: block.alt });
      } else if (block.type === 'paragraph') {
        const loc = locate(block.text);
        const wordIds = loc ? takeWords(loc.start, loc.end) : [];
        if (wordIds.length) out.push({ type: 'paragraph', region, wordIds });
      } else {
        const items: DocBlockItem[] = [];
        for (const item of block.items) {
          const loc = locate(item);
          const wordIds = loc ? takeWords(loc.start, loc.end) : [];
          if (wordIds.length) items.push({ wordIds });
        }
        if (items.length) out.push({ type: block.type, region, items });
      }
    }
  };

  const { body, impact } = parseAnswer(fullAnswer);
  emit('body', body);
  if (impact) emit('impact', impact);

  // Degrade, never drop: any unassigned words land in trailing paragraphs.
  if (wordIdx < words.length) {
    const rest: Record<'body' | 'impact', number[]> = { body: [], impact: [] };
    for (; wordIdx < words.length; wordIdx += 1) {
      const w = words[wordIdx];
      rest[sentences[w.sentenceId]?.region ?? 'body'].push(w.id);
    }
    if (rest.body.length) out.push({ type: 'paragraph', region: 'body', wordIds: rest.body });
    if (rest.impact.length) out.push({ type: 'paragraph', region: 'impact', wordIds: rest.impact });
  }

  return out;
}
```

Wire it: `return { spokenText, sentences, words, blocks: buildBlocks(fullAnswer, spokenText, words, sentences) };` (and `blocks: []` in the empty-doc early return).

- [ ] **Step 4: Run tests** — `npx vitest run src/lib`. Expected: PASS. The streaming-prefix loop is the load-bearing check — if a prefix fails the partition, fix `locate`/`takeWords` degradation (falling through to the trailing paragraph is always acceptable; wrong/duplicated ids are not).
- [ ] **Step 5: Full gate + PR** — `npm run lint && npm run typecheck && npm run test:run`. Then `git push -u origin feat/09-doc-blocks-overlay && gh pr create --base main --title "Spec 09: block overlay on the canonical spoken doc" --body "..."` (body: spec link + RCA summary).

---

## Spec 10 — branch `feat/10-doc-driven-render` (stacked on 09)

### Task 5: `DocBlocks` renderer

**Files:**
- Create: `src/components/DocBlocks.tsx`
- Test: `src/components/DocBlocks.test.tsx`
- Modify: `src/app/globals.css` (one `.ai-code` rule, existing tokens only)

**Interfaces:**
- Consumes: `SpokenDoc` incl. `blocks` (Task 4), `SpokenWord.emphasis`.
- Produces: `<DocBlocks doc={doc} region={'body'|'impact'} streaming={boolean} />` — emits the exact span contract the controller expects: `<span|strong|em class="w" data-w>` words grouped under `<span class="s" data-s>`, boundary whitespace outside `.s` spans.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/DocBlocks.test.tsx
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { buildSpokenDoc } from '@/lib/readAlong/spokenDoc';
import DocBlocks from './DocBlocks';

const wordsIn = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('[data-w]')).map((s) => ({
    id: Number((s as HTMLElement).dataset.w),
    text: s.textContent,
  }));

describe('DocBlocks', () => {
  it('renders exactly the doc words, ids in order (RCA composite)', () => {
    const md =
      '## Key Takeaways\n\nUse `claude-fable-5` with user_id routing — it is **fast**.\n\n- Top level\n  - Nested here\n\n```js\nconst x = 1;\n```\n\n> Quoted.\n\nDone now.';
    const doc = buildSpokenDoc(md);
    const { container } = render(<DocBlocks doc={doc} region="body" />);
    expect(wordsIn(container)).toEqual(doc.words.map((w) => ({ id: w.id, text: w.text })));
  });

  it('one [data-s] span per sentence, ids matching the doc', () => {
    const doc = buildSpokenDoc('First sentence here. Second one!\n\nThird paragraph.');
    const { container } = render(<DocBlocks doc={doc} region="body" />);
    const ids = Array.from(container.querySelectorAll('[data-s]')).map((s) =>
      Number((s as HTMLElement).dataset.s),
    );
    expect(ids).toEqual(doc.sentences.map((s) => s.id));
  });

  it('renders code blocks as <pre> with no word spans inside', () => {
    const doc = buildSpokenDoc('Before.\n\n```js\nconst x = 1;\n```\n\nAfter.');
    const { container } = render(<DocBlocks doc={doc} region="body" />);
    const pre = container.querySelector('pre.ai-code')!;
    expect(pre.textContent).toBe('const x = 1;');
    expect(pre.querySelectorAll('[data-w]')).toHaveLength(0);
  });

  it('wraps emphasized words in strong/em carrying .w and data-w', () => {
    const doc = buildSpokenDoc('a **bold** and _soft_ word');
    const { container } = render(<DocBlocks doc={doc} region="body" />);
    expect(container.querySelector('strong.w[data-w]')!.textContent).toBe('bold');
    expect(container.querySelector('em.w[data-w]')!.textContent).toBe('soft');
  });

  it('renders only the requested region', () => {
    const doc = buildSpokenDoc('Body text here.\n\n💼 Business Impact\n\nImpact text here.');
    const { container } = render(<DocBlocks doc={doc} region="impact" />);
    expect(container.textContent).not.toContain('Body');
    expect(container.textContent).toContain('Impact text');
  });

  it('shows the caret only while streaming', () => {
    const doc = buildSpokenDoc('Partial answer tex');
    const on = render(<DocBlocks doc={doc} region="body" streaming />);
    expect(on.container.querySelector('.caret')).not.toBeNull();
    const off = render(<DocBlocks doc={doc} region="body" />);
    expect(off.container.querySelector('.caret')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/DocBlocks.test.tsx`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```tsx
// src/components/DocBlocks.tsx
// Doc-driven answer renderer (Spec 10). Renders a SpokenDoc region's blocks;
// every spoken word is a spokenText slice wrapped in an addressable span, so
// the DOM word sequence equals doc.words BY CONSTRUCTION (the Spec 01
// invariant the old parallel markdown re-tokenization could not guarantee).

import { Fragment } from 'react';
import type { ReactNode } from 'react';
import type { DocBlock, SpokenDoc, SpokenWord } from '@/lib/readAlong/spokenDoc';

interface DocBlocksProps {
  doc: SpokenDoc;
  region: 'body' | 'impact';
  /** Append the streaming caret after the region's last rendered word. */
  streaming?: boolean;
}

/** Render one item's words: sentence-grouped spans, gaps from spokenText. */
function renderWords(doc: SpokenDoc, wordIds: number[], keyBase: string): ReactNode[] {
  const words = wordIds.map((id) => doc.words[id]).filter(Boolean) as SpokenWord[];
  // Group contiguous same-sentence words (ids are document-ordered).
  const groups: SpokenWord[][] = [];
  for (const w of words) {
    const g = groups[groups.length - 1];
    if (g && g[g.length - 1].sentenceId === w.sentenceId) g.push(w);
    else groups.push([w]);
  }

  const out: ReactNode[] = [];
  groups.forEach((group, gi) => {
    // Whitespace between sentence groups stays OUTSIDE the .s span.
    if (gi > 0) {
      const prev = groups[gi - 1][groups[gi - 1].length - 1];
      const gap = doc.spokenText.slice(prev.charEnd, group[0].charStart);
      if (gap) out.push(<Fragment key={`${keyBase}-gap-${gi}`}>{gap}</Fragment>);
    }
    out.push(
      <span key={`${keyBase}-s-${gi}`} className="s" data-s={group[0].sentenceId}>
        {group.map((w, wi) => {
          const text = doc.spokenText.slice(w.charStart, w.charEnd);
          const gap = wi > 0 ? doc.spokenText.slice(group[wi - 1].charEnd, w.charStart) : '';
          const Tag = w.emphasis === 'strong' ? 'strong' : w.emphasis === 'em' ? 'em' : 'span';
          return (
            <Fragment key={w.id}>
              {gap}
              <Tag className="w" data-w={w.id}>
                {text}
              </Tag>
            </Fragment>
          );
        })}
      </span>,
    );
  });
  return out;
}

export default function DocBlocks({ doc, region, streaming }: DocBlocksProps) {
  const blocks = doc.blocks.filter((b) => b.region === region);
  const caret = streaming ? <span className="caret" /> : null;

  return (
    <>
      {blocks.map((block: DocBlock, i) => {
        const isLast = i === blocks.length - 1;
        if (block.type === 'code') {
          return (
            <pre key={i} className="ai-code">
              <code>{block.raw}</code>
            </pre>
          );
        }
        if (block.type === 'image') return null; // v1: images render nothing
        if (block.type === 'paragraph') {
          return (
            <p key={i} className="ai-para">
              {renderWords(doc, block.wordIds, `b${i}`)}
              {isLast && caret}
            </p>
          );
        }
        const List = block.type === 'ul' ? 'ul' : 'ol';
        return (
          <List key={i} className="ai-list">
            {block.items.map((item, j) => (
              <li key={j} className="ai-list-item">
                {renderWords(doc, item.wordIds, `b${i}-i${j}`)}
                {isLast && j === block.items.length - 1 && caret}
              </li>
            ))}
          </List>
        );
      })}
      {blocks.length === 0 && caret}
    </>
  );
}
```

globals.css addition (near the other `.ai-*` rules; existing tokens only):

```css
.ai-code { background: var(--panel-2, var(--panel)); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; overflow-x: auto; font-size: 0.85em; }
```

(Check the file's real token names before committing — use whatever the neighboring rules use for surface/border; no new hex values.)

- [ ] **Step 4: Run tests** — `npx vitest run src/components/DocBlocks.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(read-along): DocBlocks renders answers from the canonical spoken doc"`

### Task 6: Swap `AiRow` + `ImpactCard` onto `DocBlocks`; retire the cursor path

**Files:**
- Modify: `src/components/AiRow.tsx`, `src/components/ImpactCard.tsx`, `src/components/InlineMarkdown.tsx`, `src/lib/readAlong/spokenDoc.ts` (delete `makeWordCursor`/`WordCursor`)
- Test: `src/components/AiRow.test.tsx`, `src/components/ImpactCard.test.tsx`, `src/components/InlineMarkdown.test.tsx`, `src/lib/readAlong/spokenDoc.test.ts`

**Interfaces:**
- Consumes: `DocBlocks` (Task 5).
- Produces: `ImpactCard` props become `{ doc: SpokenDoc }`; `InlineMarkdown` props become `{ text: string }` (plain path only — still used by `ScoreCard` and `ImpactCard`'s label-free body is gone).

- [ ] **Step 1: Update the tests first.** In `AiRow.test.tsx`: word/sentence-span assertions now expect doc-driven output — for a markdown-heavy fixture assert `[data-w]` texts equal `buildSpokenDoc(content).words` texts (reuse the `wordsIn` helper shape from `DocBlocks.test.tsx`) and that literal `##`/`>`/`---` do NOT appear in `container.textContent`. In `ImpactCard.test.tsx`: render with `doc={buildSpokenDoc('Body.\n\n💼 Business Impact\n\nImpact words here.')}` and assert the card shows the impact words with `[data-s]` spans and the label stays span-free. In `InlineMarkdown.test.tsx`: delete the cursor-path describe blocks (their coverage moved to `DocBlocks.test.tsx`); keep plain-path cases.
- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components`. Expected: updated cases FAIL against current components.
- [ ] **Step 3: Implement.**
  - `AiRow.tsx`: keep `doc` memo, `parseAnswer` (for `impact !== null` gating + sources), actions. Replace the whole `blocks.map(...)` body render with `<DocBlocks doc={doc} region="body" streaming={streaming && impact === null} />`; impact card becomes `{impact !== null && impact.length > 0 && <ImpactCard doc={doc} />}`. Remove `parseBlocks`/`makeWordCursor`/cursor imports and the `bodyWords`/`impactWords` memos.
  - `ImpactCard.tsx`: `{ doc: SpokenDoc }`; body `<p className="impact-text">` → `<div className="impact-text"><DocBlocks doc={doc} region="impact" /></div>` (impact can contain lists; keep the `💼 Business Impact` label markup untouched).
  - `InlineMarkdown.tsx`: delete the `cursor` prop, `Piece` type, and grouping loop — restore the pre-cursor component (tokens → text/strong/em nodes).
  - `spokenDoc.ts`: delete `makeWordCursor`, `WordCursor`, and their tests.
- [ ] **Step 4: Run** — `npx vitest run src/components src/lib && npm run typecheck`. Expected: PASS, no dangling `WordCursor` references (grep `makeWordCursor\|WordCursor` returns nothing).
- [ ] **Step 5: Commit** — `git commit -am "feat(read-along): AiRow/ImpactCard render doc-driven; retire WordCursor"`

### Task 7: `useReadAlong` matches spans by `data-s` id

**Files:**
- Modify: `src/components/main/useReadAlong.ts` (`applyIndex`, span collection, `tick`/`onPlay`)
- Test: `src/components/main/useReadAlong.test.tsx`

**Interfaces:**
- Consumes: `timings.sentences[i].id` (already present in `Timing`).
- Produces: unchanged hook API.

- [ ] **Step 1: Write the failing test** (append): render fixture spans with a deliberate id gap `data-s="0"`, `data-s="2"` and timings for ids 0 and 2; drive `currentTime` into the second window; assert the `data-s="2"` span (position 1) gets `.s-active` and `data-s="0"` gets `.s-read` — position-based mapping would mark position 2 (nonexistent) active.
- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/main/useReadAlong.test.tsx`.
- [ ] **Step 3: Implement.** Where spans are collected (useReadAlong.ts:113) also read ids: `const spanIds = spans.map((el) => Number(el.dataset.s));`. Change `applyIndex(i: number)` to `applyIndex(activeId: number)`:

```ts
    function applyIndex(activeId: number) {
      for (let k = 0; k < spans.length; k++) {
        const sid = spanIds[k];
        const span = spans[k];
        if (sid === activeId) {
          span.classList.add('s-active');
          span.classList.remove('s-read');
        } else if (sid < activeId) {
          span.classList.add('s-read');
          span.classList.remove('s-active');
        } else {
          span.classList.remove('s-active', 's-read');
        }
      }
    }
```

Callers translate index → id: in `tick` and `onPlay`, after `const i = activeIndexAt(...)`, use `const activeId = i >= 0 ? sentences[i].id : -1;` then `applyIndex(activeId)`; `followToBand(i)` keeps the positional index for `spans[i]` — change it to look up the span by id instead: `const span = spans[spanIds.indexOf(activeId)]` (bail if `-1`).
- [ ] **Step 4: Run** — `npx vitest run src/components/main/useReadAlong.test.tsx`. Expected: PASS (existing cases too — sequential ids behave identically).
- [ ] **Step 5: Full gate + PR** — `npm run lint && npm run typecheck && npm run test:run`, then push and `gh pr create --base feat/09-doc-blocks-overlay --title "Spec 10: doc-driven rendering + id-based highlight matching"`.

---

## Spec 11 — branch `feat/11-codepoint-alignment` (off `main`, independent)

### Task 8: `expandToUtf16` + measured-path gate

**Files:**
- Modify: `src/lib/readAlong/timingMap.ts`
- Test: `src/lib/readAlong/timingMap.test.ts`

**Interfaces:**
- Produces: `buildTimings` signature unchanged; internal `expandToUtf16(text: string, a: Alignment): Alignment | null` (exported for tests).

- [ ] **Step 1: Write the failing tests** (append):

```ts
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
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/readAlong/timingMap.test.ts`. Expected: first two FAIL (`estimated: true` today).

- [ ] **Step 3: Implement** in `timingMap.ts`:

```ts
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
```

Gate change in `buildTimings` (timingMap.ts:103):

```ts
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
```

- [ ] **Step 4: Run** — `npx vitest run src/lib/readAlong/timingMap.test.ts`. Expected: PASS (all pre-existing cases too — BMP-only paths are untouched).
- [ ] **Step 5: Full gate + PR** — quality gate, push, `gh pr create --base main --title "Spec 11: expand code-point alignments to UTF-16 (measured timings for emoji answers)"`.

---

## Spec 12 — branch `feat/12-seam-instrumentation` (off `main`, independent)

### Task 9: `chunkMeta` in `/api/speak`

**Files:**
- Modify: `src/app/api/speak/route.ts`
- Test: `src/app/api/speak/route.test.ts`

**Interfaces:**
- Produces: response JSON gains `chunkMeta: { count: number; charLengths: number[]; alignSecs: number[] }` (additive; Task 10 consumes it client-side).

- [ ] **Step 1: Write the failing test** (append to `route.test.ts`, following its existing mocked-ElevenLabs pattern): long input forcing N ≥ 2 chunks → response has `chunkMeta.count === N`, `charLengths[i]` equal to each chunk's text length, `alignSecs[i]` equal to each mocked chunk's `max(character_end_times_seconds)`. Plus: first-chunk-fails case keeps returning 500 (unchanged), later-chunk-fails case returns `chunkMeta` covering only the synthesized prefix.
- [ ] **Step 2: Run to verify failure** — `npx vitest run src/app/api/speak/route.test.ts`.
- [ ] **Step 3: Implement** — in the chunk loop record `alignSecs.push(reconciled.charEndTimesSec.length ? Math.max(...reconciled.charEndTimesSec) : 0)` and `charLengths.push(chunk.length)`; response becomes `NextResponse.json({ audioBase64, alignment, chunkMeta: { count: perChunkAlignments.length, charLengths, alignSecs } }, …)`; add `console.log('[speak] chunks:', JSON.stringify({ count, charLengths, alignSecs }))` before returning.
- [ ] **Step 4: Run** — same test file. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(speak): return per-chunk lengths and alignment durations (chunkMeta)"`

### Task 10: Client drift check

**Files:**
- Create: `src/lib/readAlong/driftCheck.ts`
- Test: `src/lib/readAlong/driftCheck.test.ts`
- Modify: `src/components/AppShell.tsx` (`SpeakResult` interface at :32, both `playVoice` and `readAloud` audio setup)

**Interfaces:**
- Produces:
  ```ts
  export interface ChunkMeta { count: number; charLengths: number[]; alignSecs: number[] }
  export function driftCheck(audioSec: number, alignmentSec: number, meta: ChunkMeta | undefined):
    { level: 'debug' | 'warn'; message: string }
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/readAlong/driftCheck.test.ts
import { describe, it, expect } from 'vitest';
import { driftCheck } from './driftCheck';

describe('driftCheck', () => {
  const meta = { count: 3, charLengths: [700, 700, 400], alignSecs: [40, 41, 22] };
  it('debug under the threshold', () => {
    expect(driftCheck(103.1, 103.0, meta).level).toBe('debug');
  });
  it('warn past 0.25s drift, message carries the numbers', () => {
    const r = driftCheck(104.0, 103.0, meta);
    expect(r.level).toBe('warn');
    expect(r.message).toContain('delta=1.00s');
    expect(r.message).toContain('chunks=3');
  });
  it('tolerates missing meta (single-chunk / old response)', () => {
    expect(driftCheck(10.2, 10.0, undefined).level).toBe('debug');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/readAlong/driftCheck.test.ts`.
- [ ] **Step 3: Implement**

```ts
// src/lib/readAlong/driftCheck.ts
// Spec 12 — diagnostics only. Quantifies chunk-seam drift (root-cause C,
// suspected): stitched alignment total vs real audio duration.

export interface ChunkMeta { count: number; charLengths: number[]; alignSecs: number[] }

const WARN_DRIFT_SEC = 0.25;

export function driftCheck(
  audioSec: number,
  alignmentSec: number,
  meta: ChunkMeta | undefined,
): { level: 'debug' | 'warn'; message: string } {
  const delta = audioSec - alignmentSec;
  const chunks = meta?.count ?? 1;
  const level = Math.abs(delta) > WARN_DRIFT_SEC ? 'warn' : 'debug';
  const message =
    `[read-along] drift check: audio=${audioSec.toFixed(2)}s, ` +
    `alignment=${alignmentSec.toFixed(2)}s, delta=${delta.toFixed(2)}s, ` +
    `chunks=${chunks}, perChunk=[${(meta?.alignSecs ?? []).map((s) => s.toFixed(1)).join(',')}]`;
  return { level, message };
}
```

Wire in `AppShell.tsx`: extend the `SpeakResult` interface with `chunkMeta?: ChunkMeta`; in BOTH `playVoice` and `readAloud`, after constructing `audio`, add:

```ts
        audio.addEventListener('loadedmetadata', () => {
          const totalSec = alignment?.charEndTimesSec.length
            ? Math.max(...alignment.charEndTimesSec)
            : 0;
          const { level, message } = driftCheck(audio.duration, totalSec, chunkMeta);
          console[level](message);
        }, { once: true });
```

(destructure `chunkMeta` from the response beside `audioBase64, alignment`).
- [ ] **Step 4: Run** — `npx vitest run src/lib/readAlong/driftCheck.test.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Full gate + PR** — quality gate, push, `gh pr create --base main --title "Spec 12: chunk-seam drift instrumentation"`.

---

## Integration order

1. Merge PR 09 → `main`; rebase 10 onto `main` (or merge its PR into 09's branch first, then 09→main per the stacked-PR flow) — 10 must land only with/after 09.
2. PRs 11 and 12 merge independently in any order.
3. After all merges: play a long (>2000-char), markdown-heavy answer with 💼 impact in dev — highlight must track every sentence to the end; check the drift log to confirm/refute root-cause C and file the follow-up spec only if it warns.
