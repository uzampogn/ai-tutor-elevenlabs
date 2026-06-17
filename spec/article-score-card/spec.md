# Article Score Card — design

**Status:** approved design, ready for implementation plan
**Date:** 2026-06-17
**Backlog item:** "Complete the article page/score card" (`spec/feature-backlog.md`)
**Branch:** create a fresh branch off `main` (the working tree is shared across many
branches — isolate this work in a git worktree per the ai-tutor convention).

---

## Problem

Clicking a knowledge-base card opens the right-side `ArticleDrawer`, but that drawer is a
stub:

- The hero is a literal placeholder hatch pattern (`.drawer-hero` → "Article preview").
- The tags are hardcoded `['Claude', 'AI', 'Analysis']` — identical for every article.
- It shows only the short `description` excerpt, ending with a note that pushes the user
  *out* of the app ("Open the original article for the full text").

The app's identity is a **tutor**: it explains AI news clearly and is a launchpad into a
grounded conversation. The drawer should pull its weight in that loop instead of being a
dead end.

## Goal

Turn the drawer into a **tutor-style score card**: an AI-generated digest the user can skim,
that also launches a conversation about the article. Not a full in-app reader, not a literal
rating — a clean digest.

### Non-goals

- Read-along TTS on the article body (separate; see `spec/read-along/`).
- Showing the full raw article body in the drawer.
- A numeric/score rating or difficulty tier.
- Reducing the orb size / color harmonization (separate backlog items).
- Pagination, infinite scroll, or a second feed.

---

## Decisions (locked during brainstorming)

| # | Decision |
|---|---|
| 1 | The panel is a **tutor-style score card** (digest), not a reader. |
| 2 | Smart content is **LLM-generated, pre-computed** (not on-demand per open) and cached. |
| 3 | **No literal score / no difficulty tier / no read-time** — a clean digest only. |
| 4 | The card surfaces **2–3 suggested question chips** that send to the tutor. |
| 5 | Hero = **real `og:image`, falling back to a category-tinted gradient**. |
| 6 | **Delivery = Approach A**: a separate `/api/digest` endpoint, prefetched into client state on mount, so the sidebar list never blocks on digest generation. |

---

## The digest

A digest is generated per article and is the single payload the card renders.

```ts
// src/lib/types.ts (or digest.ts) — new shared type
export interface ArticleDigest {
  tldr: string;          // 1–2 sentences
  takeaways: string[];   // 3–4 bullets
  whyItMatters: string;  // one business-impact line (on-brand with the chat's Impact card)
  tags: string[];        // exactly 3 real topic tags derived from the article
  questions: string[];   // 2–3 article-specific tutor questions, self-contained
}
```

Keyed by `article.url` (the stable identifier already used as the React key and for source
matching in `AppShell`).

---

## Architecture

### 1. Scraper — capture `og:image`

`src/lib/scraper.ts`:

- Add `heroImage: string` to the `Article` interface (`''` when absent).
- Add `SEL_OG_IMAGE = 'meta[property="og:image"]'` to the centralized selector block.
- In `parseArticleBody`, read the `content` attribute of `og:image` (fall back to
  `twitter:image` if you want, optional). Resolve relative URLs against `CLAUDE_ORIGIN` with
  `new URL(...)`, same as the index-card href handling.
- Thread `heroImage` through `fetchArticleBody` (both the success and the degraded-fallback
  return paths) so the field always exists.

This is the only change to the `Article` shape; the digest lives in its own structure and
its own endpoint, so `KbList`/`KbCard`/`SourceChips`/`parseAnswer` are untouched.

### 2. Digest generation — `src/lib/digest.ts` (new)

Keeps the LLM out of the pure HTML scraper.

**Mirror the established `src/lib/summarize.ts` pattern** — same module shape, same
fail-soft/caching/concurrency discipline. This codebase already does LLM-at-ingest there, so
the digest module is its sibling, not a new approach.

Constraints discovered in the codebase:

- The pinned SDK is `@anthropic-ai/sdk@^0.40.0`, which predates `output_config.format` /
  `messages.parse()`. **Do NOT use structured outputs.** Instead instruct the model to return
  a single JSON object and `JSON.parse` the text block — the same plain `messages.create()`
  call `summarize.ts` uses, extracting `content.filter(b => b.type === 'text')`.
- Use a module-scoped, **guarded** `Anthropic` client (try/catch at construction → `null` on
  missing key → fall back, never crash ingest), exactly like `summarize.ts`.

API:

- `digestArticle(a): Promise<ArticleDigest | null>` — one article:
  - `client.messages.create({ model: DIGEST_MODEL, max_tokens: DIGEST_MAX_TOKENS, system:
    DIGEST_SYSTEM_PROMPT, messages: [{ role: 'user', content: `${title}\n\n${body.slice(0,
    BODY_INPUT_CAP)}` }] })`.
  - Extract the text, `JSON.parse` it, and **validate the shape** (all five fields present;
    `takeaways`/`tags`/`questions` are arrays). On parse failure, missing client, empty body,
    or bad shape → log like `summarize.ts` and return `null`.
  - **Model:** `DIGEST_MODEL = process.env.DIGEST_MODEL ?? 'claude-haiku-4-5'` — matches the
    Haiku tier `summarize.ts` already uses (bounds cost across ~10 calls per cold refresh),
    env-overridable. (`claude-sonnet-4-6` / `claude-opus-4-8` are swap-in via the env var for
    higher quality later.)
  - `DIGEST_MAX_TOKENS ≈ 600`; `BODY_INPUT_CAP = 12_000` (reuse the summarizer's bound).
  - `DIGEST_SYSTEM_PROMPT`: tutor voice; "Return ONLY a JSON object with keys tldr, takeaways
    (3–4 strings), whyItMatters, tags (exactly 3 strings), questions (2–3 strings). No
    markdown, no preamble." Questions self-contained about *this* article; `whyItMatters`
    echoes the chat prompt's Business-Impact tone.
- `getArticleDigests(): Promise<Record<string, ArticleDigest | null>>`
  - Mirror `summarizeAll`: a module-level `digestCache` keyed by `slug + contentHash` (reuse
    the djb2 hash + `slugFromUrl` approach), so unchanged content costs 0 calls.
  - Call `getClaudeArticles()`, generate misses with **bounded concurrency** (`CONCURRENCY =
    5`, same as the summarizer), and return a `{ [url]: digest | null }` map.
  - Behind the article cache, so it's never per-user. **Fail-soft per article**: one bad
    article is `null`, never fails the batch.

### 3. Endpoint — `src/app/api/digest/route.ts` (new)

- `GET` → `{ digests: Record<string, ArticleDigest | null> }` from `getArticleDigests()`.
- 1-hour cache header, fail-soft (return `{ digests: {} }` on a hard error), mirroring
  `/api/scrape`.

### 4. Client wiring — `AppShell`

`AppShell` already owns `articles`, the drawer state (`activeArticle`, `drawerOpen`,
`openArticle`, `closeDrawer`), and the chat send path (`sendMessage(override?)`, already used
by the Welcome chips via `onAsk`).

- New state: `digests: Record<string, ArticleDigest | null>` and a small status flag
  (`digestsLoaded`).
- **Prefetch on mount, background, non-blocking**: after `/api/scrape` resolves (or in
  parallel — it doesn't depend on it), `fetch('/api/digest')` and store the result. The
  sidebar renders from `articles` and never waits on this.
- Pass to the drawer: the active article's digest (`digests[activeArticle.url] ?? null`), a
  `digestsLoaded` flag (to distinguish "still loading" from "generation returned null"), and
  an `onAsk` handler.
- **Chip → tutor**: new `onAsk(question: string)` prop on the drawer → `closeDrawer()` then
  `sendMessage(question)` — the exact path the Welcome chips use. Chat already injects all 10
  articles as context, and the questions are phrased to be self-contained about the article,
  so the tutor answers grounded in the right post.

### 5. Components (decompose the current single `ArticleDrawer`)

Keep units small and single-purpose.

- **`ArticleDrawer.tsx`** — shell only: the slide-in `aside`, head (date + close), Esc
  handling (unchanged), and composition of `ArticleHero` + `ScoreCard`. Props gain
  `digest`, `digestsLoaded`, `onAsk`.
- **`ArticleHero.tsx`** (new) — renders `article.heroImage` as an `<img>`; on missing src or
  `onError`, swaps to a category-tinted Aurora-Mist gradient. Tint derives from the article's
  category color: `AppShell` finds the active article's index in `articles`
  (`findIndex` by url) and passes `categoryFor(index).color` (from `sidebar/kb.ts`, the same
  helper `KbCard` uses) down to the hero — keep the palette logic in one place.
- **`ScoreCard.tsx`** (new) — renders the three states:
  - **loading** (`!digestsLoaded`): skeleton shimmer for tldr / takeaways / tags.
  - **ready** (`digest` present): `tldr` → `takeaways` (list) → `whyItMatters` (callout) →
    `tags` → question chips → original-article link.
  - **fallback** (`digestsLoaded && digest === null`): the existing `description` excerpt +
    the original-article link, no chips. Graceful, never a dead UI.
  - Reuse: `ImpactCard` styling for the `whyItMatters` callout, `SourceChips` for the
    original-article link, `InlineMarkdown` for any inline emphasis in text.
- Question chips can be a small inline piece of `ScoreCard` (or `QuestionChips.tsx` if it
  earns its own file). Each chip: button, tap → `onAsk(question)`.

### 6. Styles — `globals.css`

Extend the existing `.drawer-*` block (Aurora Mist tokens):

- `.drawer-hero` gains a real `<img>` variant + the gradient fallback (tinted by the category
  color via a CSS custom property).
- Takeaways list, `whyItMatters` callout (echo the Impact-card tokens), question chips
  (tappable, frosted), and a skeleton-shimmer class.
- Honor `prefers-reduced-motion` for the shimmer (the codebase already respects it for
  read-along).

---

## Data flow

```
mount
  ├── GET /api/scrape  → articles            → sidebar renders immediately
  └── GET /api/digest  → { digests }          → stored in AppShell state (background)
                              │
click KB card → openArticle(article)
                              │
ArticleDrawer(article, digest = digests[url], digestsLoaded)
   ├── ArticleHero(heroImage, categoryColor)  → img | gradient fallback
   └── ScoreCard(digest, digestsLoaded, description, onAsk)
          ├── loading  → skeleton
          ├── ready    → tldr / takeaways / whyItMatters / tags / chips / link
          └── fallback → description / link
                              │
tap question chip → onAsk(q) → closeDrawer() + sendMessage(q) → grounded tutor answer
```

## Error handling (fail-soft throughout)

- Scrape fails → drawer still opens with title/date/url; digest endpoint returns `{}`; card
  shows the fallback state.
- One digest fails → that URL is `null` → fallback state for that article only.
- `og:image` missing or broken → gradient hero.
- `/api/digest` unreachable → `digestsLoaded` stays false briefly, then card shows fallback;
  no crash, the link to the original always works.

## Testing

- `digest.ts`: happy-path JSON parse → valid `ArticleDigest`; shape validation; fail-soft on
  malformed JSON and on a thrown SDK error → `null` (mock the Anthropic client).
- `scraper`: `og:image` extraction (present, absent, relative-URL resolution).
- `ScoreCard`: renders each of the three states correctly (loading skeleton; ready renders
  tldr/takeaways/whyItMatters/tags/chips; fallback renders description + link, no chips).
- `ArticleHero`: falls back to the gradient on `onError` and on empty `heroImage`.
- Chip interaction: tapping a chip calls `onAsk` with the chip's text and closes the drawer.
- `AppShell` integration: clicking a chip routes through `sendMessage` (a user message is
  sent).

## Implementation notes

- Use a **git worktree** for this work — the ai-tutor repo shares one working tree across many
  active branches.
- Don't run `npm run build` while `npm run dev` is live (shared `.next`; corrupts dev).
- Quality gate: `npm run lint && npm run typecheck && npm run test:run`.
