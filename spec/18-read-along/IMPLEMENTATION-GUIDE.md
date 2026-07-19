# Read-Along TTS — Shared Implementation Guide (for the specialist agents)

> This is the coordinator's briefing. Each spec is implemented by a fresh specialist agent.
> Read **this guide first**, then your assigned spec (`NN-*.md`) and `00-overview.md`.
> It encodes decisions already made so you do **not** re-derive them (and don't diverge).
> This file is **untracked** — never `git add` it. Scope your commits to the files your spec lists.

---

## 0. Project + gates (apply to every spec)

- Repo: `/Users/vkau/Personal-space/Projects/ai-tutor` — Next.js 14 + TS + Tailwind + Vitest (jsdom).
- Test commands: `npm run test:run` (vitest), `npx tsc --noEmit`, `npm run build`.
- **Definition of Done for every spec = all three green**, plus your spec's own test plan implemented and passing.
- Baseline before this series: 140 tests passing across 14 files. Never let a previously-passing test go red.
- Visual system **Aurora Mist is LOCKED**: no new accent hex, no palette/font/radius/shadow/`@keyframes` changes. New CSS *classes* are allowed. `src/app/globals.tokens.test.ts` enforces this — if you add classes that the token test should know about, update its "present" assertions; never weaken the "absent"/locked assertions.
- Accessibility: the answer container has `aria-live="polite"` (`AiRow.tsx`). Highlighting must be **CSS class toggles on stable pre-rendered spans**, never re-rendering/reordering text nodes. Honor `prefers-reduced-motion`.
- Read-along is an enhancement, never a blocker: missing/short timings → audio still plays, answer still fully readable.

## Branch + PR workflow (STRICT — coordinator-managed, but you execute git)

Specs are a dependency chain; branches are **stacked**.

| Spec | Branch name | Base branch | PR target |
|---|---|---|---|
| 01 | `readalong/01-spoken-document-model` | `main` | `main` |
| 02 | `readalong/02-tts-timestamps-chunking` | `readalong/01-...` | `readalong/01-...` |
| 03 | `readalong/03-timing-map` | `readalong/02-...` | `readalong/02-...` |
| 04 | `readalong/04-sentence-highlight` | `readalong/03-...` | `readalong/03-...` |
| 05 | `readalong/05-follow-scroll` | `readalong/04-...` | `readalong/04-...` |

The coordinator creates/checks out your branch before launching you, or tells you to. Confirm with `git branch --show-current` before editing.

Commit message footer (required):
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```
PR body footer (required):
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
`git add` **only the files your spec's "Files touched" section names** (plus your new test files). Do NOT `git add -A` (it would sweep in this guide and `.next` trash dirs). Then push `-u origin <branch>` and `gh pr create --base <target> --title ... --body ...`.

---

## 1. Shared data contracts (verbatim from `00-overview.md` — do not change shapes)

```ts
// src/lib/readAlong/spokenDoc.ts
export type Emphasis = 'strong' | 'em' | undefined;
export interface SpokenWord {
  id: number; sentenceId: number; text: string;
  charStart: number; charEnd: number; emphasis: Emphasis;
}
export interface SpokenSentence {
  id: number; wordIds: number[];
  charStart: number; charEnd: number; region: 'body' | 'impact';
}
export interface SpokenDoc { spokenText: string; sentences: SpokenSentence[]; words: SpokenWord[]; }

// returned by POST /api/speak
export interface SpeakResult {
  audioBase64: string;
  alignment: { chars: string[]; charStartTimesSec: number[]; charEndTimesSec: number[]; };
}

// src/lib/readAlong/timingMap.ts
export interface Timing { id: number; startSec: number; endSec: number; }
export interface ReadAlongTimings { sentences: Timing[]; words: Timing[]; totalSec: number; estimated?: boolean; }
```

**Load-bearing invariants** (each spec verified independently against these):
- `chars.join('') === spokenDoc.spokenText` (Spec 02).
- `spokenText.slice(word.charStart, word.charEnd) === word.text` (Spec 01).
- Together they make Spec 03 a direct index lookup, no fuzzy matching.

---

## 2. Spec 01 — the crux (READ THIS; the spec has an internal tension you must resolve as below)

The hard part is **spoken text ≠ rendered text**. Today `/api/speak` sends `stripMarkdown(text).slice(0,1200)`; the DOM renders full markdown + a separate Impact card. We need ONE tokenization that is the source of truth for both.

### Resolved decision on the "Business Impact" heading (IMPORTANT — the spec contradicts itself)
- `00-overview` says `spokenText === stripMarkdown(fullAnswer)` so **audio is unchanged** (load-bearing).
- Spec 01 §Coverage/test says the `💼 Business Impact` label is "absent from `spokenText`".
- These conflict, because today's `stripMarkdown(full)` keeps the heading words. **Resolution (use this):**
  - `spokenText = stripMarkdown(fullAnswer)` **literally** — heading words INCLUDED, audio truly unchanged. Make the parity test assert exactly this.
  - The heading words are **excluded from `doc.words`/`doc.sentences`** (they get no `data-w`/`data-s` and the `.impact-label` stays decorative). Their characters still occupy `spokenText` (a gap in token coverage there is fine — Spec 03 just won't highlight them).
  - Write the "region tagging" test as: body sentences `region:'body'`, impact-*body* sentences `region:'impact'`, and assert the heading words are **not present in `doc.words`** (rather than "absent from spokenText"). That satisfies the spec's intent without breaking parity.

### Build algorithm (canonical-first — guarantees both load-bearing invariants by construction)
1. `spokenText = stripMarkdown(fullAnswer)` (relocated, byte-identical function).
2. `{ body, impact } = parseAnswer(fullAnswer)`; `bodyText = stripMarkdown(body)`; `impactText = impact!=null ? stripMarkdown(impact) : null`.
3. Locate region boundaries in `spokenText`: `bodyEnd = bodyText.length` (body is the prefix); `impactStart = impactText ? spokenText.lastIndexOf(impactText) : spokenText.length`. Heading range = `[bodyEnd, impactStart)`. Guard with `indexOf`/fallback so a whitespace hiccup degrades to "all body" rather than throwing.
4. **Words** = maximal non-whitespace runs (`/\S+/g`) scanned over `spokenText` → exact `charStart/charEnd` by construction (this is why offset-integrity is trivially true). Drop words whose span lies inside the heading range. Tag each remaining word `region` = impact if `charStart >= impactStart` else body.
5. **Sentences** = group consecutive (non-heading) words; split when: a word ends a sentence (`[.!?]` + guards for decimals `4.6`, abbreviations `e.g.`/`U.S.`/`Mr.`/`vs.`), OR a `\n` sits in the gap before the next word (so each list item / line is its own sentence), OR the region changes. `sentence.charStart = firstWord.charStart`, `charEnd = lastWord.charEnd` (trim to word bounds → contiguity test holds).
6. **Emphasis**: build an `emphasisAt[]` overlay on `spokenText`. Scan `fullAnswer` for `**…**`/`*…*`/`_…_` runs (reuse `parseInline`'s regex), strip each inner run, locate it in `spokenText` from a moving cursor (handles duplicates in order), mark that range `strong`/`em`. `word.emphasis = emphasisAt[word.charStart]`. Pragmatic; partial-overlap rare.

### Rendering (visual parity is non-negotiable — pixel-identical)
- Keep `parseBlocks(body)` for paragraph/ul/ol structure and `ImpactCard` for the impact card, exactly as today.
- Wrap each sentence in `<span class="s" data-s={id}>` and each word in `<span class="w" data-w={id}>` (word span may itself be/contain `<strong>`/`<em>`). `.s`/`.w` are `display:inline`, **unstyled** in this spec.
- Assign ids by consuming the region's `doc.words` **in document order** (a per-region index). Body blocks consume body words; `ImpactCard` consumes impact words. Both sides derive from the same region text, so the visible-word sequence matches 1:1. (Known limitation: links/code in body would desync — current code already doesn't strip links; keep test corpus link/code-free.)
- Group consecutive words sharing a `sentenceId` under one `.s` span. A sentence never crosses a block boundary (because `\n`/region ends sentences), so per-block grouping is safe.
- Whitespace: split each `parseInline` token value with `/\S+|\s+/g`; emit word runs as `.w` spans and whitespace runs as plain text nodes, in order → `textContent` is byte-identical (no collapsed/doubled spaces). Emphasis wraps **per word** (`<strong class="w">word</strong>`); inter-word spaces inside a bold run render as plain text — visually identical.
- Streaming-safe: a partial/empty doc must not throw; the caret at `AiRow.tsx` stays.
- `InlineMarkdown`: make the word-cursor **optional** — when absent, render exactly as today (keeps `InlineMarkdown.test.tsx` green); when given a `words` slice, emit spans.

### Spec 01 files
- New: `src/lib/readAlong/stripMarkdown.ts` (relocated, unchanged), `src/lib/readAlong/spokenDoc.ts`, `src/lib/readAlong/spokenDoc.test.ts`.
- Modified: `src/components/AiRow.tsx`, `src/components/InlineMarkdown.tsx`, `src/components/ImpactCard.tsx`, `src/app/api/speak/route.ts` (import relocated `stripMarkdown`; NO behavior change), `src/components/AiRow.test.tsx` (add span-coverage + textContent-fidelity tests; keep existing assertions).

---

## 3. Spec 02 — TTS timestamps + chunking (key callouts)
- Switch endpoint `/{voice}/stream` → `/{voice}/with-timestamps` (JSON: `audio_base64`, `alignment`, `normalized_alignment`). Keep `model_id: 'eleven_turbo_v2'`, voice from `ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM'`, `Cache-Control: no-store`.
- Remove `slice(0,1200)`. Chunk on **sentence boundaries**, pack to ~600–800 chars, hard ceiling **2000**, never mid-word. `chunks.join('') === spokenText` exactly (load-bearing). Cap total chunks (≤8).
- Stitch: concat MP3 bytes; offset each chunk's char times by cumulative prior duration (`offset_{i+1} = offset_i + max(chunk_i.charEndTimesSec)`); append `chars` verbatim. Result monotonic non-decreasing, `chars.join('') === spokenText`.
- Use `alignment` (keyed to input), not `normalized_alignment`. If only normalized is reliable, two-pointer reconcile back to input so `chars.join('') === request.text`. Cover with a fixture where they differ.
- Fail-soft: a chunk failing → return partial stitched result (+log), don't 500 the whole thing. Empty text → 400 (today's behavior).
- Client (`AppShell`): `playVoice`/`readAloud` → `res.json()` → base64→Uint8Array→Blob('audio/mpeg')→objectURL; **send `doc.spokenText`** (build via `buildSpokenDoc(content).spokenText`), not raw content; **stash `alignment`** in state (e.g. `speakingAlignment`) for Spec 03. `onplay/onended/onpause` semantics unchanged.
- Files — New: `src/app/api/speak/chunking.ts` (+`.test.ts`), `src/app/api/speak/route.test.ts`. Modified: `route.ts`, `AppShell.tsx`. Pure helpers must be network-free and unit-tested; route test mocks `fetch`.

## 4. Spec 03 — timing map (pure; no UI)
- `buildTimings(doc, alignment): ReadAlongTimings` — word: `start=charStartTimesSec[w.charStart]`, `end=charEndTimesSec[w.charEnd-1]` (clamp indices to `[0,N-1]`). Sentence: `[firstWord.start, lastWord.end]`. Enforce `end>=start` and non-decreasing starts (clamp defensively). `totalSec=max(charEndTimesSec)`.
- Robustness: `alignment.chars.length !== spokenText.length` → **proportional fallback** distributing `totalSec` by `text.length`, set `estimated:true`. Empty doc/alignment → `{sentences:[],words:[],totalSec:0}`. Out-of-range → clamp, never index undefined.
- `activeIndexAt(timings, t, fromHint?)` — forward scan from hint (O(1) amortized, playback is monotonic), binary-search fallback for seeks; define before-first → `-1`, after-last → last index per tests.
- Files — New only: `src/lib/readAlong/timingMap.ts` (+`.test.ts`). No build/UI impact (still run `tsc`/`test:run`).

## 5. Spec 04 — sentence highlight + scroll-to-start
- New hook `src/components/main/useReadAlong.ts({active, audio, timings, rowEl, scrollEl, granularity:'sentence'})`. Drive a `requestAnimationFrame` loop while `!audio.paused`; each frame `i=activeIndexAt(timings.sentences, audio.currentTime, lastI)`; toggle `.s-active` on span `i`, `.s-read` on `<i`, clear rest **via classList on existing `[data-s]` spans** (no React re-render).
- Scroll-to-start **once** per playback (on first playing frame / `audio.onplay`): scroll `scrollEl` so the first `[data-s]` of `rowEl` sits ~12–16% from top. `behavior:'smooth'` normally, `'auto'` under reduced-motion. Guard against re-firing.
- Cleanup on `ended`/`pause`/unmount/`active=false`: cancel rAF, clear classes.
- Suppress `Thread.tsx` bottom-pin while reading: pass an `isReading` flag into `Thread`, skip the `bottomRef` scroll effect when true. Keep today's behavior when false.
- Add `readAlong: ReadAlongMode` (`'off'|'sentence'|'word'`) in `AppShell`; thread `'sentence'` as dev default once this lands; `'off'` is a total no-op.
- CSS: add `.s-active` (soft wash using existing `--accent`/`--accent-2`/low-alpha; legible on white `--panel`; **no layout shift** — background/color only) and `.s-read` (subtle `--ink-soft`). Transition only under `@media (prefers-reduced-motion: no-preference)`. **No new accent hex.** Update `globals.tokens.test.ts` "present" assertions for `.s-active`/`.s-read`.
- Files — New: `useReadAlong.ts(+test)`. Modified: `AppShell.tsx`, `Thread.tsx`, `AiRow.tsx` (expose row ref), `globals.css`, `Thread.test.tsx`, `globals.tokens.test.ts`.
- Test with a fake audio clock (manually advance `currentTime`, toggle `paused`); mock `matchMedia` reduce per `testing-strategy.md §5`.

## 6. Spec 05 — follow-scroll (reading band; completes Solution 3.5)
- Extend `useReadAlong` only. Reading band `BAND_TOP≈0.30`, `BAND_BOTTOM≈0.55` of `scrollEl.clientHeight`. On **sentence change** (not per frame): if active span's top is outside the band, scroll so it lands at `BAND_TOP`; if inside, do nothing (no jitter). One scroll per sentence-change max.
- Unify scroll-to-start with follow: scroll-to-start = band logic on sentence 0 with the smaller top fraction. Same primitive, one code path.
- `behavior:'smooth'` under no-preference, `'auto'`/threshold-only under reduced-motion. Long sentence taller than band → align its top. Near thread end → allow natural bottoming-out, no over-scroll.
- Set `isAutoScrolling=true` for the duration of a controller scroll (clear on `scrollend` or short timeout). Nothing reads it yet — it's for Spec 06. Assert it in tests.
- Files — Modified only: `useReadAlong.ts`, `useReadAlong.test.tsx`.

---

## 7. Test conventions (follow `spec/testing-strategy.md`)
- RTL + jsdom; `vi.fn()` for callbacks; thin `render*(overrides)` helper; `screen` queries; `userEvent.setup()`. Canonical example: `src/components/main/Composer.test.tsx`.
- Reduced-motion: override `window.matchMedia` mock (already in `vitest.setup.ts`) to match `(prefers-reduced-motion: reduce)`.
- `HTMLMediaElement.play/pause`, `URL.createObjectURL`, `SpeechRecognition` are already stubbed in `vitest.setup.ts`. For Spec 04/05 you'll hand-roll a fake audio element object (not a real `<audio>`).
- Pure-logic suites (spokenDoc, chunking, timingMap) must have **no DOM/network**.

## 8. Reporting back to coordinator
End your run with a concise report: branch name, files changed, test counts (`test:run` pass/total), `tsc` clean Y/N, `build` Y/N, PR URL, and any deviations from spec or this guide (with rationale). Do not mark the task complete unless all three gates are green.
