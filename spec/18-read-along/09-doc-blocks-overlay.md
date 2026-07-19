# Spec 09 — Block overlay on the canonical doc (+ stripMarkdown hardening)

**Series:** [Read-Along TTS](./00-overview.md) · **Milestone:** Desync fix (root-cause A)
**Status:** 📋 Proposed · **Date:** 2026-07-18
**Depends on:** `01` · **Unblocks:** `10`
**User-visible change:** none on its own (pure lib) — this is the data model Spec 10 renders from.

---

## Why (root-cause analysis, 2026-07-18)

Read-along breaks in long answers because **two tokenizers must produce the identical
word sequence and don't**. `buildSpokenDoc` scans words out of `stripMarkdown(answer)`;
the DOM renders words from the **raw markdown** via `parseBlocks`/`parseInline`, consuming
the shared `WordCursor` blind-positionally (one `next()` per non-whitespace run). Confirmed
divergences (renderer words vs doc words):

| Trigger in the answer | Divergence |
|---|---|
| `## Heading` | renderer emits `##` as an extra word (+1) |
| Code fence ` ``` ` | doc drops it; renderer renders every line (+N) |
| `user_id` / `snake_case` | `stripMarkdown` deletes paired `_` → `userid` (1 word); renderer emits 3 |
| `__bold__` | `parseInline` doesn't handle `__` → stray `_` words (+2) |
| Indented / `+` bullets | doc strips the marker; renderer's `UL_LINE` (`/^[-*] /`) doesn't → literal `-`/`+` words |
| `> quote`, `---`, `![img](url)` | stripped from doc, rendered as words (+1/+2) |

One divergence shifts every subsequent `data-w`/`data-s` id; on a realistic long answer the
doc had 8 sentences but the DOM produced 14 `[data-s]` spans and the cursor exhausted before
the end. `useReadAlong.applyIndex` then highlights the wrong sentences for the rest of the
message. Long answers are simply more likely to contain a trigger.

**Fix direction (approved):** doc-driven rendering — ONE tokenization by construction.
This spec adds the block structure the renderer needs; Spec 10 switches the renderer over.

---

## Goal

1. `buildSpokenDoc` additionally emits `doc.blocks` — paragraph/list/code/image structure
   with each spoken word assigned to exactly one block item — **without changing
   `spokenText`** (still `=== stripMarkdown(fullAnswer)`; audio untouched).
2. Harden `stripMarkdown`'s emphasis stripping so intra-word `_`/`*` survive
   (`user_id` stays `user_id` in audio and DOM).
3. Extend `parseBlocks` to recognize the constructs that today shred into paragraph runs:
   fenced code, image-only lines, blockquotes, horizontal rules, indented/`+` bullets.

---

## Design

### 1. `stripMarkdown` emphasis hardening (`src/lib/readAlong/stripMarkdown.ts`)

Replace the two emphasis rules with word-boundary-aware versions: a `_`/`*` pair is an
emphasis marker only when the opener is preceded by start-of-text/whitespace/punctuation
and the closer is followed by end/whitespace/punctuation (CommonMark-ish flanking, kept
simple). Requirements, expressed as test cases:

- `user_id`, `snake_case_name`, `a*b*c`-style intra-word markers → **unchanged**;
- `_em_`, `*em*`, `__bold__`, `**bold**` → markers stripped, inner kept (as today);
- **idempotency preserved**: `strip(strip(x)) === strip(x)` for all fixtures — the
  `/api/speak` defensive re-strip (route.ts:68) relies on this;
- `buildEmphasisOverlay`'s `EMPHASIS_PATTERN` (spokenDoc.ts:71) must be updated to the
  same flanking rules so overlay matching stays consistent with stripping.

Note: this intentionally changes `spokenText` for snake_case answers (TTS now speaks the
identifier instead of a mangled `userid`). Nothing persists alignments, so no migration.

### 2. `parseBlocks` extensions (`src/lib/parseAnswer.ts`)

New/changed block classification (raw markdown in, same streaming-safe philosophy):

- **`code` block**: lines between ``` fences (fences may contain blank lines — fence scan
  runs BEFORE the `\n{2,}` chunk split). Unterminated fence while streaming → treat the
  tail as an open code block (never throw).
- **`image` line**: a line that is only `![alt](url)` → `{ type: 'image', alt }`.
- **Bullets**: `UL_LINE` accepts optional leading whitespace and `+` (`/^\s*[-*+] /`);
  `OL_LINE` accepts leading whitespace. (Nesting is NOT modeled — a nested item is a
  flat `li`; visual indentation is out of scope.)
- **Blockquote**: leading `> ` stripped, content joins the paragraph run.
- **`---` rule line**: dropped (matches `stripMarkdown`).

Existing exports keep their shapes; `Block` gains the `code`/`image` variants. `AiRow`'s
current usage keeps compiling (it renders paragraphs/lists; new variants are handled in
Spec 10).

### 3. Block overlay (`src/lib/readAlong/spokenDoc.ts`)

New types on `SpokenDoc`:

```ts
export type DocBlockItem = { wordIds: number[] };            // contiguous, document order
export type DocBlock =
  | { type: 'paragraph'; region: 'body' | 'impact'; wordIds: number[] }
  | { type: 'ul' | 'ol'; region: 'body' | 'impact'; items: DocBlockItem[] }
  | { type: 'code'; region: 'body' | 'impact'; raw: string }   // non-spoken
  | { type: 'image'; region: 'body' | 'impact'; alt: string }; // non-spoken

export interface SpokenDoc { /* existing */ blocks: DocBlock[]; }
```

Construction — same forward-cursor overlay technique as `buildEmphasisOverlay`:

1. `parseAnswer(fullAnswer)` → body / impact (existing). Run the extended `parseBlocks`
   on each region's raw markdown.
2. For each spoken block/item: `stripMarkdown(itemRaw)` → locate it in `spokenText` via
   `indexOf` from a forward-moving cursor; the words whose `[charStart, charEnd)` fall
   inside the located range are that item's `wordIds`. Advance the cursor.
3. `code`/`image` blocks contribute no words; record `raw`/`alt` for rendering.
4. **Degradation, never throw** (streaming-safe): if an item can't be located, or any
   words would be left orphaned at the end, emit a trailing
   `{ type: 'paragraph' }` block containing all remaining unassigned words in order.

Invariant (the load-bearing one): **the concatenation of `wordIds` across blocks/items,
in document order, is exactly `doc.words.map(w => w.id)`** — every word in exactly one
item, no gaps, no reordering. The Business Impact heading line stays outside all blocks
(its words are already dropped from `doc.words`).

---

## Test plan (`spokenDoc.test.ts`, `parseAnswer.test.ts`, `stripMarkdown.test.ts` — new file)

| Assert | Detail |
|---|---|
| Partition invariant | For every fixture: flattened block `wordIds` === `words.map(w => w.id)`. |
| RCA fixtures | Heading, code fence, inline code, snake_case, indented/`+` bullets, blockquote, hrule, image, link, `__bold__`, em-dash, abbreviations, emoji — each builds a doc satisfying the partition invariant, with expected block types. |
| `spokenText` unchanged | For fixtures WITHOUT snake_case/intra-word markers: `spokenText` identical to pre-change output. |
| stripMarkdown hardening | Cases in §1, plus idempotency property over all fixtures. |
| Streaming safety | For every prefix (per-char) of a composite fixture: `buildSpokenDoc` doesn't throw and the partition invariant holds. |
| parseBlocks | Fence with blank lines, unterminated fence, image line, `+`/indented bullets, blockquote, `---`. Existing tests keep passing. |

Quality gate: `npm run lint && npm run typecheck && npm run test:run`.
