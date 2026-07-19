# Spec 10 — Doc-driven rendering (+ id-based highlight matching)

**Series:** [Read-Along TTS](./00-overview.md) · **Milestone:** Desync fix (root-cause A)
**Status:** 📋 Proposed · **Date:** 2026-07-18
**Depends on:** `09` · **Unblocks:** —
**User-visible change:** read-along highlight stays correct through long, markdown-heavy
answers; answers stop showing literal `##`, `>`, `---` and raw code-fence markup; code
blocks render as styled code.

---

## Goal

Render the answer **from the SpokenDoc** (Spec 09's `doc.blocks`) instead of re-tokenizing
raw markdown in parallel. The DOM word sequence then equals `doc.words` **by construction**,
killing the blind-positional `WordCursor` desync class entirely. Harden `useReadAlong` to
match sentence spans by `data-s` id instead of array position (defense in depth).

---

## Design

### 1. New renderer: `DocBlocks` (`src/components/DocBlocks.tsx`)

Props: `{ doc: SpokenDoc; region: 'body' | 'impact'; streaming?: boolean }`. Renders the
doc's blocks for that region:

- `paragraph` → `<p className="ai-para">`, `ul`/`ol` → `<ul|ol className="ai-list">` with
  `<li className="ai-list-item">` per item;
- `code` → `<pre className="ai-code"><code>{raw}</code></pre>` (new minimal styling in
  `globals.css`, existing tokens only) — **no word spans**, highlight skips it;
- `image` → renders nothing (v1; answers essentially never contain images);
- each spoken word renders as `spokenText.slice(w.charStart, w.charEnd)` in a
  `<span|strong|em className="w" data-w={w.id}>` (element per `w.emphasis`, exactly the
  markup `InlineMarkdown`'s cursor path emits today);
- inter-word whitespace inside an item comes verbatim from the `spokenText` gap
  (`slice(prev.charEnd, next.charStart)`);
- contiguous words sharing a `sentenceId` group under `<span className="s" data-s={id}>`,
  boundary whitespace outside the span — the same grouping contract as today
  (`InlineMarkdown.tsx:91-141`), so existing CSS and the controller keep working;
- `streaming` → caret `<span className="caret" />` after the last rendered word (same
  placement semantics AiRow has today: only while streaming and impact not yet present).

Links note: `stripMarkdown` keeps only the link text, so linked words render as plain
addressed words (no `<a>` — unchanged vs today, future work).

### 2. Call-site swaps

- **`AiRow.tsx`**: drop `parseBlocks`/`makeWordCursor`/per-block `InlineMarkdown`; body
  becomes `<DocBlocks doc={doc} region="body" streaming={streaming} />`. `parseAnswer`
  stays only for `impact !== null` (whether to show the card) and source resolution.
- **`ImpactCard.tsx`**: takes `doc` instead of `text` + `cursor`; the card body becomes
  `<DocBlocks doc={doc} region="impact" />` (impact regions can contain lists/paragraphs;
  today's single-`<p>` flattening goes away). The decorative `💼 Business Impact` label is
  unchanged and stays span-free.
- **`InlineMarkdown.tsx`**: delete the cursor path (`WordCursor` prop, `Piece` machinery,
  sentence grouping). The plain path remains for `ScoreCard` and any non-answer text.
  `makeWordCursor`/`WordCursor` in `spokenDoc.ts` are deleted with their tests.

### 3. `useReadAlong` id-based matching (`src/components/main/useReadAlong.ts`)

`applyIndex(i)` currently classifies `spans[k]` by array position (`k === i` → active).
Replace with id-based classification: read `Number(span.dataset.s)` once when spans are
collected; a span is active iff `sid === activeId`, read iff `sid < activeId` (sentence
ids are sequential in document order, so ordering by id is ordering by position). The
active TIMING index still comes from `activeIndexAt` — only the DOM mapping changes.
Handles duplicate/missing `data-s` gracefully (all spans with the id toggle together).

---

## Test plan

### `DocBlocks.test.tsx` (RTL, new)
| Assert | Detail |
|---|---|
| Word identity | For each RCA fixture (Spec 09 list): rendered `[data-w]` texts+ids, in DOM order, equal the region's `doc.words` exactly. |
| Sentence spans | One `[data-s]` per region sentence, ids matching `doc.sentences`; textContent of a span equals its sentence's `spokenText` slice (modulo boundary whitespace). |
| Code block | Fenced fixture renders `<pre>` with raw code, zero `[data-w]` inside. |
| Emphasis | `**bold**`/`_em_` words render as `strong`/`em` with `.w` + `data-w`. |
| Streaming | Prefix renders never throw; caret present only while `streaming`. |

### Updated tests
- `AiRow` snapshot/behavior tests → doc-driven markup (no more literal `##`/`>`/`---`).
- `ImpactCard.test` → new props.
- `InlineMarkdown.test` → cursor-path cases move to `DocBlocks.test`; plain path unchanged.
- `useReadAlong.test` → fixture spans get explicit `data-s` ids; add a case with a span
  id gap (e.g. ids 0,2) asserting classification follows ids, not positions.

Quality gate: `npm run lint && npm run typecheck && npm run test:run`.
