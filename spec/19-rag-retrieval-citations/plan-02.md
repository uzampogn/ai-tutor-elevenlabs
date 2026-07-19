# Inline `[n]` Citations (Spec 02) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The model cites claims with `[n]` markers tied to the retrieved sources; the frontend renders them as superscript links plus a numbered footnote list, and read-aloud neither speaks a marker nor loses word-highlight alignment.

**Architecture:** The chat route's retrieved block instructs numbered markers. On the display side, markers are **glued to the preceding word** with sentinel brackets (`⟦n⟧`) before block parsing, so a marker never becomes its own word-run; `InlineMarkdown` renders sentinels as superscript links. On the speech side, `stripMarkdown` deletes the same glued markers. Both sides use the **same guarded regex** — that identity is the alignment invariant, and it is tested directly.

**Tech Stack:** Next.js 14, TypeScript 5, React 18, Vitest (+ Testing Library for component tests).

## Global Constraints

- Node 24+ (`nvm use`). Quality gate after every task: `npm run lint && npm run typecheck && npm run test:run`.
- Branch `feat/rag-02-inline-citations` **stacked on** `feat/rag-01-retrieval` (`git checkout -b feat/rag-02-inline-citations feat/rag-01-retrieval`), in a git worktree. PR base: `feat/rag-01-retrieval` (or `main` if 01 already merged).
- **Alignment invariant:** the display glue regex and the speech strip regex share the pattern `/(\S)[ \t]*\[(\d{1,2})\]/` applied in a loop until stable. A marker with no preceding non-space (start of line) is left as literal text on BOTH sides.
- **Read-along invariant:** for any answer, the number of rendered word spans (`[data-w]`) equals `buildSpokenDoc(content).words.length`. Citations render outside the word flow.
- Retrieval-off turns get no marker instruction and render exactly as spec 01 (chips fallback via `resolveSources`).
- Sentinel characters are `⟦` (U+27E6) and `⟧` (U+27E7) — never produced by the model, never shown to the user.

---

### Task 1: Marker instruction in the retrieved block

**Files:**
- Modify: `src/app/api/chat/route.ts` (`buildRetrievedBlock` only)
- Test: `src/app/api/chat/route.test.ts`

**Interfaces:**
- Consumes: plan-01 Task 5's `buildRetrievedBlock` + `X-Sources` header (numbering = header order: marker `n` ⇔ `sources[n-1]`).
- Produces: retrieved block text containing the marker instruction; block 1 and the no-retrieval path untouched.

- [ ] **Step 1: Write the failing tests** — append to the RAG describe block in `src/app/api/chat/route.test.ts`:

```ts
it('retrieved block instructs inline [n] markers keyed to source numbers', async () => {
  retrieveArticlesMock.mockResolvedValue([retrieved('post-a')]);
  await post([{ role: 'user', content: 'q' }]);
  const sysArg = streamMock.mock.calls[0][0].system;
  expect(sysArg[1].text).toContain('inline marker like [1]');
  expect(sysArg[1].text).not.toContain('write its article title EXACTLY');
});

it('no retrieval → no marker instruction anywhere new (single block)', async () => {
  await post([{ role: 'user', content: 'q' }]);
  const sysArg = streamMock.mock.calls[0][0].system;
  expect(sysArg).toHaveLength(1);
  expect(sysArg[0].text).not.toContain('inline marker like [1]');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/chat/route.test.ts`
Expected: first new case FAILS (block still says "title EXACTLY").

- [ ] **Step 3: Implement** — in `buildRetrievedBlock`, replace the header sentence (`RETRIEVED SOURCES — ... write its article title EXACTLY as given.`) with:

```ts
  return `RETRIEVED SOURCES — full articles most relevant to the user's latest question, numbered for citation. Prefer these for depth and specifics; the knowledge base above holds only short summaries.
Cite claims drawn from a retrieved source with an inline marker like [1], placed directly after the claim it supports, where the number matches the source number below. Use markers ONLY for these numbered sources — never invent a number. Not every sentence needs one; cite where grounding matters.

${blocks.join('\n\n---\n\n')}`;
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/app/api/chat/route.test.ts`
Expected: PASS (all cases, including plan-01's).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/route.ts src/app/api/chat/route.test.ts
git commit -m "feat(citations): instruct numbered inline markers in retrieved block"
```

---

### Task 2: Citation glue + targets in `parseAnswer.ts`

**Files:**
- Modify: `src/lib/parseAnswer.ts`
- Test: `src/lib/parseAnswer.test.ts`

**Interfaces:**
- Consumes: `articleSlug` (plan-01 Task 6).
- Produces (used by Task 4):
  - `glueCitations(text: string): string` — `claim [1].` → `claim⟦1⟧.`
  - `CITATION_SENTINEL_RE = /⟦(\d{1,2})⟧/` (exported for `InlineMarkdown`)
  - `citationTargets(slugs: string[] | undefined, articles: Article[]): (Article | undefined)[]` — positional, holes preserved so numbering never shifts when an article is missing.

- [ ] **Step 1: Write the failing tests** — append to `src/lib/parseAnswer.test.ts`:

```ts
import { glueCitations, citationTargets } from './parseAnswer'; // merge into the existing import

describe('glueCitations', () => {
  it('glues a marker to the preceding word, eating the space', () => {
    expect(glueCitations('A claim [1]. Next.')).toBe('A claim⟦1⟧. Next.');
  });
  it('handles adjacent markers', () => {
    expect(glueCitations('Fast [1][2]. Done.')).toBe('Fast⟦1⟧⟦2⟧. Done.');
  });
  it('leaves a start-of-line marker as literal text', () => {
    expect(glueCitations('[1] leads the line')).toBe('[1] leads the line');
  });
  it('ignores 3+ digit brackets and non-numeric brackets', () => {
    expect(glueCitations('see [123] and [note]')).toBe('see [123] and [note]');
  });
});

describe('citationTargets', () => {
  const art = (slug: string): Article => ({
    title: `Title ${slug}`, url: `https://claude.com/blog/${slug}`, pubDate: '',
    description: '', body: '', summary: '', heroImage: '',
  });
  it('maps positionally and preserves holes for unknown slugs', () => {
    const out = citationTargets(['ghost', 'b'], [art('a'), art('b')]);
    expect(out[0]).toBeUndefined();
    expect(out[1]?.title).toBe('Title b'); // [2] still points at source 2
  });
  it('returns [] without slugs', () => {
    expect(citationTargets(undefined, [art('a')])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/parseAnswer.test.ts`
Expected: FAIL — `glueCitations is not a function`.

- [ ] **Step 3: Implement** — append to `src/lib/parseAnswer.ts`:

```ts
// --- Inline citations (spec/rag-retrieval-citations 02) -------------------
// Display side: markers are glued to the preceding word with sentinel brackets
// (⟦n⟧, U+27E6/7 — never model-emitted) BEFORE block parsing, so a marker never
// becomes its own word-run and read-along word counts stay aligned with the
// spoken doc. Speech side: stripMarkdown deletes the same glued markers with
// the SAME guarded pattern. Keep the two regexes identical.

/** Matches one glued sentinel; capture group 1 = the source number. */
export const CITATION_SENTINEL_RE = /⟦(\d{1,2})⟧/;

/** Glue [n] markers to the preceding word: "claim [1]." → "claim⟦1⟧.". */
export function glueCitations(text: string): string {
  if (!text) return text;
  let out = text;
  let prev: string;
  do {
    prev = out;
    out = out.replace(/(\S)[ \t]*\[(\d{1,2})\]/g, '$1⟦$2⟧');
  } while (out !== prev); // loop handles adjacent markers "[1][2]"
  return out;
}

/**
 * Positional marker targets: marker [n] → result[n-1]. Holes (undefined) are
 * preserved for unknown slugs so numbering never shifts; the renderer shows
 * out-of-range / unresolvable markers as literal text.
 */
export function citationTargets(
  slugs: string[] | undefined,
  articles: Article[],
): (Article | undefined)[] {
  if (!slugs || slugs.length === 0) return [];
  const bySlug = new Map(articles.map((a) => [articleSlug(a.url), a]));
  return slugs.map((s) => bySlug.get(s));
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/parseAnswer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/parseAnswer.ts src/lib/parseAnswer.test.ts
git commit -m "feat(citations): glueCitations sentinel transform + positional targets"
```

---

### Task 3: Speech side — strip markers in `stripMarkdown`

**Files:**
- Modify: `src/lib/readAlong/stripMarkdown.ts`
- Test (create): `src/lib/readAlong/stripMarkdown.test.ts`
- Test (extend): `src/lib/readAlong/spokenDoc.test.ts`

**Interfaces:**
- Consumes/produces: `stripMarkdown(text)` contract unchanged for non-citation input; glued `[n]` markers now removed. `buildSpokenDoc` needs **no change** — it already builds from `stripMarkdown(fullAnswer)`.

- [ ] **Step 1: Write the failing tests** — create `src/lib/readAlong/stripMarkdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stripMarkdown } from './stripMarkdown';

describe('stripMarkdown — citation markers (spec/rag-retrieval-citations 02)', () => {
  it('removes a glued marker and its preceding space', () => {
    expect(stripMarkdown('A claim [1]. Next.')).toBe('A claim. Next.');
  });
  it('removes adjacent markers', () => {
    expect(stripMarkdown('Fast [1][2]. Done.')).toBe('Fast. Done.');
  });
  it('keeps a start-of-line marker (same guard as the display side)', () => {
    expect(stripMarkdown('[1] leads the line')).toBe('[1] leads the line');
  });
  it('does not touch 3+ digit brackets', () => {
    expect(stripMarkdown('see [123] here')).toBe('see [123] here');
  });
  it('markdown links still resolve to their text (existing rule wins)', () => {
    expect(stripMarkdown('read [this](https://x.y) now')).toBe('read this now');
  });
});
```

And append to `src/lib/readAlong/spokenDoc.test.ts`:

```ts
describe('buildSpokenDoc — citation markers are invisible (alignment invariant)', () => {
  it('marked and unmarked answers produce identical spoken docs', () => {
    const marked = buildSpokenDoc('Claude shipped it [1]. Fast [2][3]. Done.');
    const clean = buildSpokenDoc('Claude shipped it. Fast. Done.');
    expect(marked.spokenText).toBe(clean.spokenText);
    expect(marked.words.length).toBe(clean.words.length);
  });
});
```

(Reuse the file's existing import of `buildSpokenDoc`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/readAlong`
Expected: new cases FAIL (`A claim [1]. Next.` currently keeps the marker).

- [ ] **Step 3: Implement** — rewrite `src/lib/readAlong/stripMarkdown.ts` as:

```ts
// Relocated from src/app/api/speak/route.ts (byte-identical behavior).
// Defines the canonical spoken string: markdown markers removed so the text
// reads naturally to ElevenLabs TTS. This is the single source of truth that
// both the API route and buildSpokenDoc (read-along) share.

export function stripMarkdown(text: string): string {
  let out = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, (m) => m.replace(/`/g, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)([\s\S]*?)\1/g, '$2')
    .replace(/(\*|_)([\s\S]*?)\1/g, '$2')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // Inline citation markers (spec/rag-retrieval-citations 02): delete glued
  // "[n]" so TTS never speaks them. MUST mirror glueCitations in parseAnswer.ts
  // — same guarded pattern, same until-stable loop (adjacent "[1][2]") — or
  // read-along word alignment breaks. Start-of-line markers are kept on both
  // sides (literal there too).
  let prev: string;
  do {
    prev = out;
    out = out.replace(/(\S)[ \t]*\[\d{1,2}\]/g, '$1');
  } while (out !== prev);

  return out
    .replace(/^>\s+/gm, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

- [ ] **Step 4: Run to verify pass** — including the pre-existing speak/spokenDoc suites:

Run: `npm run test:run`
Expected: PASS. (The marker rule sits after the link rule, so `[text](url)` is unaffected; ordered-list markers at line starts are protected by the `(\S)` guard.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/readAlong/stripMarkdown.ts src/lib/readAlong/stripMarkdown.test.ts src/lib/readAlong/spokenDoc.test.ts
git commit -m "feat(citations): strip glued [n] markers from spoken text"
```

---

### Task 4: Render — superscript links, numbered chips, wiring

**Files:**
- Modify: `src/components/InlineMarkdown.tsx`
- Modify: `src/components/ImpactCard.tsx`
- Modify: `src/components/AiRow.tsx`
- Modify: `src/components/SourceChips.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/AiRow.test.tsx`

**Interfaces:**
- Consumes: `glueCitations`, `citationTargets`, `CITATION_SENTINEL_RE` (Task 2); `sourceSlugs` prop + `resolveSources` (plan-01 Task 6).
- Produces: `InlineMarkdown` prop `citeTargets?: (Article | undefined)[]`; `ImpactCard` prop `citeTargets?` (pass-through); `SourceChips` prop `numbered?: boolean`.

- [ ] **Step 1: Write the failing tests** — append to `src/components/AiRow.test.tsx`:

```tsx
describe('inline citations (spec/rag-retrieval-citations 02)', () => {
  const articles = [
    { title: 'Alpha', url: 'https://claude.com/blog/alpha', pubDate: '', description: '', body: '', summary: '', heroImage: '' },
    { title: 'Beta', url: 'https://claude.com/blog/beta', pubDate: '', description: '', body: '', summary: '', heroImage: '' },
  ];
  const baseProps = {
    streaming: false, articles, speaking: false,
    onReadAloud: () => {}, onStopAudio: () => {},
  };

  it('renders [n] as a superscript link to the nth retrieved source', () => {
    const { container } = render(
      <AiRow {...baseProps} content="One two [2]." sourceSlugs={['alpha', 'beta']} />,
    );
    const sup = container.querySelector('sup.cite a') as HTMLAnchorElement;
    expect(sup).not.toBeNull();
    expect(sup.getAttribute('href')).toBe('https://claude.com/blog/beta');
    expect(sup.textContent).toBe('[2]');
  });

  it('keeps read-along word spans aligned (marker adds no [data-w] span)', () => {
    const { container } = render(
      <AiRow {...baseProps} content="One two [1]. Three four." sourceSlugs={['alpha']} />,
    );
    // stripMarkdown('One two [1]. Three four.') = 'One two. Three four.' → 4 words.
    expect(container.querySelectorAll('[data-w]')).toHaveLength(4);
  });

  it('renders an out-of-range marker as literal text', () => {
    const { container } = render(
      <AiRow {...baseProps} content="Claim [7] here." sourceSlugs={['alpha']} />,
    );
    expect(container.querySelector('sup.cite')).toBeNull();
    expect(container.textContent).toContain('[7]');
  });

  it('numbers the source chips when retrieval slugs are present', () => {
    const { container } = render(
      <AiRow {...baseProps} content="Grounded answer [1]." sourceSlugs={['alpha', 'beta']} />,
    );
    const nums = Array.from(container.querySelectorAll('.source-chip-num')).map((n) => n.textContent);
    expect(nums).toEqual(['1', '2']);
  });
});
```

(Reuse the file's existing `render`/`screen` imports.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/AiRow.test.tsx`
Expected: new cases FAIL (no `sup.cite`, no `.source-chip-num`; the alignment case fails because `[1].` consumes a word span today).

- [ ] **Step 3: Implement `InlineMarkdown.tsx`** — add the citation renderer and use it for every emitted text value.

Add imports and prop:

```tsx
import type { Article } from '@/lib/types';
import { CITATION_SENTINEL_RE } from '@/lib/parseAnswer';

interface InlineMarkdownProps {
  text: string;
  /** Optional read-along cursor; when present, emit addressable spans. */
  cursor?: WordCursor;
  /** Positional citation targets: sentinel ⟦n⟧ links to citeTargets[n-1]. */
  citeTargets?: (Article | undefined)[];
}
```

Add above the component:

```tsx
const SENTINEL_SPLIT_RE = /(⟦\d{1,2}⟧)/g;

/**
 * Render a text run, replacing ⟦n⟧ sentinels with superscript source links.
 * Unresolvable sentinels (no target / out of range) render as literal "[n]".
 * Citations are NOT spoken words: they live inside the surrounding word's
 * node, so they never consume a WordCursor entry.
 */
function renderCited(
  text: string,
  citeTargets: (Article | undefined)[] | undefined,
  keyBase: string,
): ReactNode {
  if (!CITATION_SENTINEL_RE.test(text)) return text;
  return text.split(SENTINEL_SPLIT_RE).filter((p) => p !== '').map((part, j) => {
    const m = part.match(/^⟦(\d{1,2})⟧$/);
    if (!m) return <Fragment key={`${keyBase}c${j}`}>{part}</Fragment>;
    const n = Number(m[1]);
    const target = citeTargets?.[n - 1];
    if (!target) return <Fragment key={`${keyBase}c${j}`}>[{n}]</Fragment>;
    return (
      <sup key={`${keyBase}c${j}`} className="cite">
        <a href={target.url} target="_blank" rel="noopener noreferrer" title={target.title}>
          [{n}]
        </a>
      </sup>
    );
  });
}
```

Destructure `citeTargets` in the component signature. In the **legacy path**, replace the three token renders:

```tsx
        {tokens.map((t, i) => {
          if (t.type === 'strong') return <strong key={i}>{renderCited(t.value, citeTargets, `t${i}`)}</strong>;
          if (t.type === 'em') return <em key={i}>{renderCited(t.value, citeTargets, `t${i}`)}</em>;
          return <Fragment key={i}>{renderCited(t.value, citeTargets, `t${i}`)}</Fragment>;
        })}
```

In the **cursor path**, replace the three `{inner}` usages (inside `<strong>`, `<em>`, `<span>`) with `{renderCited(inner, citeTargets, `w${word.id}`)}`. Nothing else changes: a glued run like `claim⟦1⟧.` is still ONE non-whitespace run consuming ONE cursor word; the sup renders inside that word's span.

- [ ] **Step 4: Implement `ImpactCard.tsx`** — pass-through prop:

```tsx
import type { Article } from '@/lib/types';

interface ImpactCardProps {
  text: string;
  /** Optional read-along cursor over the impact region's words. */
  cursor?: WordCursor;
  /** Positional citation targets, forwarded to InlineMarkdown. */
  citeTargets?: (Article | undefined)[];
}

export default function ImpactCard({ text, cursor, citeTargets }: ImpactCardProps) {
  ...
        <InlineMarkdown text={text} cursor={cursor} citeTargets={citeTargets} />
  ...
```

- [ ] **Step 5: Implement `AiRow.tsx`** — glue the display text and thread targets:

Change the parse lines (`glueCitations`/`citationTargets` join the existing `@/lib/parseAnswer` import):

```ts
  const { body, impact } = parseAnswer(glueCitations(content));
  const sources = resolveSources(sourceSlugs, content, articles);
  const citeTargets = citationTargets(sourceSlugs, articles);
```

`buildSpokenDoc(content)` stays on the RAW content (stripMarkdown now removes markers — Task 3). Pass `citeTargets={citeTargets}` to all three `<InlineMarkdown ...>` call sites (ul items, ol items, paragraph) and to `<ImpactCard ...>`. Change the chips line:

```tsx
        <SourceChips sources={sources} numbered={Boolean(sourceSlugs?.length)} />
```

- [ ] **Step 6: Implement `SourceChips.tsx`:**

```tsx
export default function SourceChips({ sources, numbered = false }: { sources: Article[]; numbered?: boolean }) {
  if (sources.length === 0) return null;
  return (
    <div className="sources">
      <div className="sources-label">Sources</div>
      <div className="sources-row">
        {sources.map((article, i) => (
          <a
            key={article.url}
            className="source-chip"
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {numbered ? <span className="source-chip-num">{i + 1}</span> : <LinkIcon />}
            <span className="source-chip-title">{article.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Styles** — append to `src/app/globals.css` (match the file's existing custom-property conventions if they differ):

```css
/* Inline citation superscripts + numbered source chips (spec/rag-retrieval-citations 02) */
.cite { font-size: 0.72em; line-height: 0; }
.cite a { color: inherit; opacity: 0.65; text-decoration: none; }
.cite a:hover, .cite a:focus-visible { opacity: 1; text-decoration: underline; }
.source-chip-num { font-size: 11px; font-variant-numeric: tabular-nums; opacity: 0.7; }
```

- [ ] **Step 8: Run the full gate**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green — including the pre-existing AiRow/read-along suites (the alignment invariant test from Step 1 is the canary).

- [ ] **Step 9: Impeccable pass** — run `/impeccable audit` (or `polish`) on the citation UI and apply any surfaced fixes to the `.cite` / chip styles.

- [ ] **Step 10: Commit**

```bash
git add src/components/InlineMarkdown.tsx src/components/ImpactCard.tsx src/components/AiRow.tsx src/components/SourceChips.tsx src/app/globals.css src/components/AiRow.test.tsx
git commit -m "feat(citations): superscript [n] links + numbered source chips"
```

---

### Task 5: Retirement note, gate, PR

**Files:**
- Modify: `src/lib/parseAnswer.ts` (comment only)

- [ ] **Step 1:** Above `matchSources`, add:

```ts
// TODO(rag-02): retire once retrieval has been on in prod for a while —
// matchSources now only serves the retrieval-off fallback path (resolveSources).
```

- [ ] **Step 2: Full gate, push, PR**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green. Then:

```bash
git add src/lib/parseAnswer.ts
git commit -m "chore(citations): mark matchSources as fallback-only"
git push -u origin feat/rag-02-inline-citations
gh pr create --base feat/rag-01-retrieval --title "Inline [n] citations (spec 02)" \
  --body "Implements spec/rag-retrieval-citations/02-inline-citations.md: numbered [n] marker instruction in the retrieved block, glue-sentinel display transform + matching stripMarkdown rule (read-along alignment invariant tested), superscript source links, numbered source chips. Retrieval-off turns render exactly as spec 01. Includes manual verification results (see checklist in plan-02.md Task 5)."
```

(If `feat/rag-01-retrieval` has already merged, use `--base main`.)

- [ ] **Step 3: Manual verification (needs `VOYAGE_API_KEY` + `DATABASE_URL`)**

1. Topical question → answer shows superscript `[1]`-style links; clicking opens the right article; chips are numbered and match the marker numbers.
2. Read aloud a cited answer → no "bracket one"/"one" spoken for markers; sentence highlighting stays in sync past every citation.
3. Question with no retrieval (e.g. "hello!") → no markers, un-numbered chips (or none), identical to spec 01 behavior.
4. Copy button → copied text contains the original `[1]` markers (raw content), not sentinels.

---

## Definition of Done (plan 02)

All tasks committed; quality gate green; Impeccable pass done; PR open (stacked on 01); manual verification 1–4 recorded in the PR description.
