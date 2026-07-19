# Spec 01 — Spoken-document model + addressable rendering

**Series:** [Read-Along TTS](./00-overview.md) · **Milestone:** Solution 3.5
**Status:** 📋 Proposed · **Date:** 2026-06-14
**Depends on:** nothing (foundation) · **Unblocks:** `02`, `03`, `04`
**User-visible change:** **none** (refactor + plumbing; render output must be pixel-identical)

---

## Goal

Create **one tokenization that is the single source of truth** for (a) the exact string sent to ElevenLabs and (b) the rendered DOM, so that later specs can map audio timing onto on-screen text. Concretely:

1. A pure module that turns a full answer (markdown) into a `SpokenDoc` — an ordered list of **sentences** and **words**, each carrying its character offsets into a canonical `spokenText` string, plus the markdown emphasis to preserve at render time.
2. A refactor of `AiRow` / `InlineMarkdown` / `ImpactCard` to **render from that model**, wrapping each sentence and word in addressable spans (`data-s`, `data-w`) — with **zero visual change**.

This spec ships **no behavior**: no highlighting, no audio change. It exists to de-risk the crux first and is verifiable purely by parity tests.

---

## Context — what we have to reconcile

- **Spoken side:** `src/app/api/speak/route.ts:5` `stripMarkdown()` defines today's canonical spoken string (heading hashes, bold/italic markers, list bullets, links, code fences removed). `playVoice` (`AppShell.tsx:114`) sends the **full** answer (body + "Business Impact" heading + impact text).
- **Rendered side:** `AiRow.tsx:58` renders `parseBlocks(body)` as `<p class="ai-para">`/`<ul|ol class="ai-list">`, each run through `InlineMarkdown` (`parseInline` → text/strong/em). The Impact section renders separately via `ImpactCard` (`AiRow.tsx:98`). Source chips, the "Thinking" status, and the avatar are **not spoken** and must be excluded.
- **Existing tokenizers to reuse:** `parseAnswer.ts` already gives us `parseAnswer` (body/impact split), `parseBlocks` (paragraph/ul/ol), and `parseInline` (text/strong/em). Spec 01 layers sentence + word segmentation on top of these — it does **not** replace them.

---

## Design

### 1. The canonicalizer (`spokenText`)

`buildSpokenDoc(fullAnswer: string): SpokenDoc` must produce a `spokenText` that is **byte-identical to today's `stripMarkdown(fullAnswer)`** (sans the 1200 cap). This guarantees the audio is unchanged by the refactor and that Spec 02's alignment lines up with our offsets.

- Move/extract `stripMarkdown` from the API route into `src/lib/readAlong/` so the **same** function backs both the doc and (after Spec 02) the route. The route currently owns it; this spec relocates it and the route imports it. (No behavior change to the route in this spec.)
- `spokenText` is the concatenation of all sentence texts with the original separators preserved (so character offsets are exact).

### 2. Segmentation model

Build the doc in this layering:

```
fullAnswer
  └─ parseAnswer → { body, impact }
       ├─ body  → parseBlocks → blocks (paragraph | ul | ol)
       │            └─ each block's text → sentence split → word split
       └─ impact → sentence split → word split        (region: 'impact')
```

- **Sentences:** split on sentence-final punctuation (`. ! ?`) followed by whitespace, with guards for common non-breaks (decimals `4.6`, abbreviations, `e.g.`/`U.S.`). A list item is at least one sentence; a heading/label line is its own sentence. Keep it pragmatic — the answer surface is small and editorial.
- **Words:** split each sentence on whitespace; punctuation stays attached to its word (so offsets stay contiguous).
- **Emphasis:** carry `parseInline`'s `strong`/`em` classification down to the word level so render can re-wrap `<strong>`/`<em>` exactly as today. A word fully inside a `**…**` run is `emphasis:'strong'`; partial-overlap words split at the boundary into adjacent words (rare; keep simple).
- **Offsets:** every `SpokenWord.charStart/charEnd` and `SpokenSentence.charStart/charEnd` indexes into `spokenText`. Adjacent words within a sentence are separated by exactly the whitespace present in `spokenText`.

See [`00-overview.md` → Shared data contracts](./00-overview.md#shared-data-contracts) for the exact `SpokenDoc` / `SpokenWord` / `SpokenSentence` types.

### 3. Addressable rendering

Refactor the render path so each sentence and word becomes a span keyed by its model id:

```tsx
// conceptual — final structure mirrors today's blocks/lists/impact exactly
<p className="ai-para">
  <span className="s" data-s={sentence.id}>
    <span className="w" data-w={word.id}>Anthropic</span>{' '}
    <strong className="w" data-w={word2.id}>released</strong>{' '}
    …
  </span>
</p>
```

Requirements:
- **Visual parity:** the rendered output must be indistinguishable from today — same paragraphs, lists, bold/italic, Impact card, spacing. `.s`/`.w` spans are `display:inline` with no styling of their own in this spec (styling arrives in `04`/`07`). Whitespace between words must render identically (no collapsing, no double spaces).
- **Coverage:** body paragraphs, both list types, and the **ImpactCard** text all emit `.s`/`.w` spans (Impact words carry `region:'impact'`). The `.impact-label` ("💼 Business Impact") is **not** spoken → no spans (it is not in `spokenText`).
- **Exclusions:** avatar, "Thinking" status, source chips, and message-action buttons get no spans.
- **Streaming safety:** while `streaming` is true (`AiRow.tsx:39`) the doc may be partial; rendering from a partial doc must not throw. Read-along only activates post-stream (audio starts at `AppShell.tsx:114`), so partial docs never need timing — but the render path must tolerate them (the caret at `AiRow.tsx:93` stays).

### 4. Where the model is built

- `AiRow` builds the `SpokenDoc` once per message via `useMemo(() => buildSpokenDoc(content), [content])` and renders from it. It replaces the current `parseBlocks`/inline path internally but produces the same DOM (plus spans).
- The doc (or just its `spokenText` and sentence/word maps) is also what later specs hand to `/api/speak` and the timing map. Expose it upward (e.g. via a ref or a callback) so `AppShell` can send `spokenText` to TTS in Spec 02. **In this spec, only build and render it** — no upward wiring yet.

---

## Test plan

### Unit — `src/lib/readAlong/spokenDoc.test.ts` (pure, no DOM)
| Assert | Detail |
|---|---|
| **`spokenText` parity** | For a corpus of representative answers, `buildSpokenDoc(a).spokenText === stripMarkdown(a)` (the relocated function). This is the load-bearing contract. |
| Offset integrity | For every word/sentence, `spokenText.slice(charStart, charEnd) === token.text` (modulo the defined whitespace rule). |
| Contiguity | Concatenating words+separators of a sentence reproduces `spokenText.slice(sentence.charStart, sentence.charEnd)`. |
| Monotonic, non-overlapping | `charStart < charEnd`; sentences and words are ordered and non-overlapping. |
| Sentence splitting | Decimals (`Claude 4.6`), `e.g.`, `U.S.`, and `?`/`!` handled; list items and label lines each become sentences. |
| Emphasis carry-through | Words inside `**…**`/`*…*`/`_…_` get the right `emphasis`; plain words get `undefined`. |
| Region tagging | Impact-section sentences are `region:'impact'`; body ones `'body'`; the `💼 Business Impact` label is absent from `spokenText`. |
| Edge cases | Empty/whitespace answer → empty doc; impact-less answer → all `'body'`; partial/streaming markdown does not throw. |

### Component — `src/components/AiRow.test.tsx` (RTL + jsdom)
| Assert | Detail |
|---|---|
| Render parity | Existing `AiRow` assertions still pass (paragraphs, lists, bold, Impact card, source chips, actions). |
| Span coverage | Every spoken word is wrapped in a `[data-w]`; every sentence in a `[data-s]`; counts match `doc.words.length`/`doc.sentences.length`. |
| No spurious spans | `.impact-label`, source chips, and the avatar contain **no** `[data-w]`. |
| Text fidelity | `container.textContent` of the answer body equals today's (no doubled/dropped whitespace from span wrapping). |
| Streaming | With `streaming=true` and partial `content`, renders without throwing and still shows the caret. |

> Follow the conventions in `spec/testing-strategy.md` §2 (RTL, `vi.fn()`, thin render helper, `Composer.test.tsx` as the canonical example).

---

## Definition of Done
- `buildSpokenDoc` + relocated `stripMarkdown` live in `src/lib/readAlong/`, fully unit-tested (incl. the parity contract).
- `AiRow`/`InlineMarkdown`/`ImpactCard` render from the doc with **identical** visual output and complete `data-s`/`data-w` coverage.
- `npm run test:run`, `npx tsc --noEmit`, `npm run build` green.
- Manual: diff the rendered answer against `main` (same fonts, spacing, bold, Impact card) — no visible change.

---

## Files touched
- **New:** `src/lib/readAlong/spokenDoc.ts` (`buildSpokenDoc`, sentence/word segmentation), `src/lib/readAlong/stripMarkdown.ts` (relocated), `src/lib/readAlong/spokenDoc.test.ts`.
- **Modified:** `src/components/AiRow.tsx` (render from doc, emit spans), `src/components/InlineMarkdown.tsx` (accept pre-tokenized words / emit `.w` spans), `src/components/ImpactCard.tsx` (render impact words as spans), `src/app/api/speak/route.ts` (import relocated `stripMarkdown`; no behavior change), `src/components/AiRow.test.tsx`.

---

## Out of scope (later specs)
- Any highlight styling or audio change — `04`/`07` and `02`.
- Sending `spokenText` to the API or any timing — `02`/`03`.
- Word-boundary perfection on pathological emphasis overlaps — keep the simple split; revisit only if `07` needs it.
