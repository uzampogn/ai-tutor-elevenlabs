# Spec 02 — Inline `[n]` Citation Markers

**Parent:** `00-overview.md`. **Depends on:** spec 01 (retrieved sources + `X-Sources` header). **Branch:** `feat/rag-02-inline-citations` stacked on `feat/rag-01-retrieval`.
**Touch surface:** `src/app/api/chat/route.ts` (prompt instruction), `src/lib/parseAnswer.ts` (+test), `src/lib/readAlong/stripMarkdown.ts` (+test), `src/components/InlineMarkdown.tsx`, `src/components/ImpactCard.tsx`, `src/components/AiRow.tsx` (+test), `src/components/SourceChips.tsx`, `src/app/globals.css`.

---

## Objective

Deliver the "every claim links to a source I can check" half of backlog #2: the model cites individual claims with numbered markers tied to the retrieved sources; the frontend renders them as superscript links and a numbered footnote list. Read-aloud never speaks a marker and word-highlighting stays aligned.

## Prompt change (chat route, retrieved block only)

Replace "cite by writing the article title EXACTLY" with:

```
Cite claims that come from a retrieved source with an inline marker like [1],
where the number matches the source number above. Place the marker immediately
after the claim it supports. Use markers ONLY for the numbered retrieved
sources; do not invent numbers. Not every sentence needs a marker — cite where
grounding matters.
```

- Applies **only when the retrieved block exists**. Retrieval-off turns get no marker instruction ⇒ no markers ⇒ spec 01's `matchSources` fallback still covers chips.
- Source numbering in the block (`[Source 1]`, `[Source 2]`, …) is the key the frontend joins on via the ordered `X-Sources` slugs: marker `n` ⇒ `sources[n-1]`.

## Parsing (`src/lib/parseAnswer.ts`) — the glue-sentinel mechanism

The naive design (a `citation` token type in `parseInline`) breaks read-along: a standalone `[1]` becomes its own non-whitespace run, consumes a `WordCursor` word, but has no counterpart in the stripped spoken text — every subsequent word's highlight shifts by one. Instead, markers are **glued to the preceding word** before block parsing:

- `glueCitations(text)` — `claim [1].` → `claim⟦1⟧.` via `/(\S)[ \t]*\[(\d{1,2})\]/g` applied in a loop until stable (handles adjacent `[1][2]`). Sentinels `⟦⟧` (U+27E6/7) are never model-emitted. A glued run stays ONE word-run ⇒ one cursor word ⇒ alignment holds.
- A marker with **no preceding non-space** (start of line) is left as literal `[1]` on both display and speech sides — same guard everywhere.
- `citationTargets(slugs, articles)` — positional `(Article | undefined)[]`, holes preserved so `[2]` never shifts when source 1's article is missing. Out-of-range / unresolvable ⇒ rendered as literal text (never crash, never fabricate a link).
- `matchSources` is **retired from the retrieval-on path**; it remains only as the no-`sources` fallback. Delete once retrieval has been on in prod for a while — leave a `TODO(rag-02)`.

## Rendering

- **`InlineMarkdown`** gains `citeTargets?: (Article | undefined)[]`; every emitted text value passes through a `renderCited()` helper that replaces `⟦n⟧` with `<sup class="cite"><a href={target.url} target="_blank" title={target.title}>[n]</a></sup>`. In the cursor path the sup renders **inside** the surrounding word's span and never consumes a cursor word. `ImpactCard` forwards the prop.
- **`AiRow.tsx`** — parses `glueCitations(content)` for display; `buildSpokenDoc(content)` stays on raw content (stripMarkdown handles markers).
- **`SourceChips.tsx`** — `numbered` mode when retrieval slugs are present: each chip prefixed with its number. Chips for sources the answer never cited still render (they grounded the answer) — no visual distinction in this spec (YAGNI; backlog #8 owns deeper source-trace UX).

## Read-aloud safety (the reason this is its own spec)

- **`stripMarkdown.ts`** — deletes glued markers with the **same guarded pattern + until-stable loop** as `glueCitations`; that identity IS the alignment invariant. Placed after the markdown-link rule so `[text](url)` is unaffected; the `(\S)` guard protects ordered-list markers at line starts.
- Tests assert the invariant directly: `buildSpokenDoc` of a marked answer equals the marker-free version (`spokenText` + word count), and an `AiRow` render of a cited answer has exactly `buildSpokenDoc(content).words.length` `[data-w]` spans.

## Edge cases

| Case | Behavior |
|---|---|
| Marker out of range (`[7]` with 3 sources) | rendered as literal `[7]` text; stripped from speech (same glued pattern — range isn't checked there; a silent drop beats a spoken "seven") |
| Marker at start of line (no preceding word) | literal `[n]` on both display and speech sides — the `(\S)` guard skips it identically everywhere |
| Legitimate bracketed numbers in prose (e.g. quoting "[1]" from an article) | accepted cost — treated as citation if in range; rare in this domain, noted as known limitation |
| Adjacent markers `[1][2]` | glue loop converts both; renders `¹ ²` inside one word-run |
| `[123]` or `[note]` | not a marker (1–2 digits only) — untouched everywhere |
| Retrieval off / no sources | no instruction ⇒ markers absent; any stray `[n]` renders literal |
| Model cites title verbatim out of habit | harmless — chips already come from retrieval; no double-render since `matchSources` is off in this path |

## Testing (Vitest)

| Suite | Cases |
|---|---|
| `parseAnswer.test.ts` (extend) | valid marker ⇒ citation token; out-of-range ⇒ literal; inside code ⇒ literal; adjacent markers; no-sources ⇒ literal |
| `stripMarkdown.test.ts` (extend) | markers removed; code-guard respected; spokenDoc-equivalence invariant fixture |
| `AiRow` test (extend) | superscript anchor href/title from `sources[n-1]`; numbered chips; uncited sources still listed |
| chat route test (extend) | marker instruction present iff retrieved block present |

## Definition of Done

| Check | Criterion |
|---|---|
| Quality gate | lint, typecheck, test:run all green |
| Markers render | topical prod question yields superscript links matching source numbers |
| Read-aloud clean | played answer speaks no markers; word highlight stays in sync through a cited paragraph |
| Fallback intact | retrieval-off answers look exactly like spec 01 |
| Impeccable pass | `/impeccable audit` (or polish) run on the citation UI |
