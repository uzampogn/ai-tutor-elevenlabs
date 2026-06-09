# AI News Tutor Redesign — Testing Strategy

Companion to [`SPEC.md`](./SPEC.md). Defines the test suite that gates the redesign. The
build is considered done when **all three gates are green**.

## Stack

- **Vitest** (`jsdom` environment) — unit + component tests. Fast, ESM-native, TS-friendly,
  resolves the `@/*` path alias via `vite-tsconfig-paths`.
- **@testing-library/react** + **@testing-library/jest-dom** + **user-event** — component
  rendering and interaction assertions.
- **`tsc --noEmit`** — type gate (the app is `strict`).
- **`next build`** — integration gate (catches RSC/client-boundary and build-time errors).

### Scripts (`package.json`)

```jsonc
"test": "vitest",
"test:run": "vitest run",
"typecheck": "tsc --noEmit"
```

### Config

- `vitest.config.ts` — `environment: 'jsdom'`, `globals: true`,
  `setupFiles: ['./vitest.setup.ts']`, `plugins: [react(), tsconfigPaths()]`.
- `vitest.setup.ts` — `import '@testing-library/jest-dom'`; mock browser APIs that jsdom
  lacks (`window.matchMedia`, `HTMLMediaElement.prototype.play`, `URL.createObjectURL`, and a
  stub `SpeechRecognition`).

## The three gates

| Gate | Command | Must show |
|---|---|---|
| Types | `npm run typecheck` | exit 0, no errors |
| Tests | `npm run test:run` | all suites pass, 0 failures |
| Build | `npm run build` | compiles successfully |

---

## Test layers

### 1. Unit — pure logic (`src/lib/parseAnswer.test.ts`)

Highest value, fully deterministic. Targets `parseAnswer` and `matchSources`.

`parseAnswer(markdown)`:
- Splits a `💼 Business Impact` section: `body` excludes it, `impact` holds the trailing
  text.
- Tolerant heading match (with/without emoji, optional `#`/`**`, case-insensitive).
- No heading → `impact === null`, whole input is `body`.
- Partial/streaming input (heading not yet arrived) → all `body`, `impact === null`.
- Empty string → `{ body: '', impact: null }`.

`matchSources(answer, articles)`:
- Returns articles whose `title` appears in the answer (case-insensitive).
- No match → `[]`.
- No duplicate chips when a title appears twice.
- Preserves the article's real `url`.

Inline-markdown helper (if extracted): `**x**` → strong token, `*x*`/`_x_` → em token, blank
lines split paragraphs.

### 2. Unit — Claude blog scraper (`src/lib/scraper.test.ts`)

Fixture-based unit tests for `getClaudeArticles()` (and `buildArticleContext()`), with
`global.fetch` mocked via `vi.stubGlobal('fetch', ...)`. The fixtures are hand-authored HTML
that matches the selectors/strategies the scraper actually uses:

- **One index-page fixture** with 11 `<a href="/blog/...">` cards rendered **oldest-first**
  (reverse chronological) so document order is the *opposite* of recency — this proves the
  scraper sorts by date rather than trusting card position. (The real index mixes a featured
  grid with the chronological list, so the first cards are not the most recent.)
- **Per-article fixtures** carrying a JSON-LD `Article`/`BlogPosting` block (inside a `@graph`,
  to exercise defensive parsing) with `datePublished` and `description`, plus `og:description`
  and a first-paragraph fallback. One fixture uses the **human `"Jun 08, 2026"` format** that
  the live site actually emits, to exercise ISO normalization.

The scraper caches in-process, so each test gets a fresh cache via `vi.resetModules()` +
dynamic `import('./scraper')` — except the cache-hit test, which intentionally reuses one
instance to assert the second call does not re-fetch.

Assertions (12 tests):

- **Parsing / recency** — returns the **10 most recent** articles **sorted newest-first**: the
  scraper fetches *every* candidate's authoritative `datePublished`, sorts descending, and takes
  10 (the oldest of 11 is dropped). Every `url` is absolute and starts with
  `https://claude.com/blog/`; every `pubDate` is **ISO** (`"Jun 08, 2026"` → `2026-…T…Z`) and
  `new Date(pubDate)` is valid; every happy-path `description` is non-empty; cards are
  de-duplicated by slug.
- **Caching gate** — a second call within TTL does **not** re-invoke `fetch` (asserts the call
  count stays at 1 index + 11 candidate fetches) and returns the same cached reference.
- **Resilience gate** — when the index fetch **rejects** or **404s**, `getClaudeArticles()`
  resolves to `[]` (or cached) and does **not** throw; when a single article-body fetch errors,
  only that article degrades (index title/url kept, `description` empty) while the others keep
  their excerpts and the feed stays at 10.
- **Context** — `buildArticleContext()` over the parsed articles produces the expected
  `## [Article 1] …` / `## [Article 10] …` markdown blocks (with `Published:`/`URL:` lines,
  `---`-separated), and the empty-list path returns the "No articles currently available"
  message.

> **Real-network verification is manual:** the unit tests never hit claude.com. To confirm the
> live source still parses (markup drift, bot-blocking), run the app and hit `GET /api/scrape`
> — see §9 of [`CLAUDE-BLOG-FEED.md`](./CLAUDE-BLOG-FEED.md). Selectors are centralized as named
> constants at the top of `src/lib/scraper.ts` so drift is cheap to fix.

### 3. Component — rendering & interaction (RTL)

One file per component group under `src/components/**.test.tsx`. Render in isolation with
mock props; assert on accessible roles/text, not on CSS classes (classes are visual and
tested by eye against the mockup).

- **Welcome** — renders the suggested-question chips; clicking one calls the `onPick`
  handler with that question.
- **AiParagraph / answer rendering** — `**bold**` renders a `<strong>`, `*em*` an `<em>`;
  plain text passes through.
- **ImpactCard** — renders given impact text; the parent renders no card when
  `impact === null`.
- **SourceChips** — renders one link per matched article with correct `href`,
  `target="_blank"`, `rel="noopener noreferrer"`; renders nothing for an empty list.
- **Composer** — Send is disabled when input is empty or `isLoading`; enabled with text;
  submitting calls `onSend`; mic button is disabled/hidden when STT is unsupported (feature
  flag prop).
- **VoiceToggle** — reflects on/off state and calls `onToggle`.
- **KbCard** — renders title + formatted date; clicking calls `onOpen` with the article.

### 4. Integration gates

- **Typecheck** catches prop/type drift between the agent-built foundation and components
  (e.g. `Message`, `Article`, parser signatures).
- **`next build`** catches `'use client'` boundary mistakes, server/client import leaks, and
  font/`globals.css` issues that unit tests miss. APIs are not called at build time, so no
  keys are required.

---

## Mocking notes (jsdom gaps)

- `window.matchMedia` — required by reduced-motion logic; stub in `vitest.setup.ts`.
- `HTMLMediaElement.prototype.play` — `Audio().play()` from TTS; stub to a resolved promise.
- `URL.createObjectURL` / `revokeObjectURL` — TTS blob playback; stub.
- `SpeechRecognition` / `webkitSpeechRecognition` — provide a fake constructor so STT code can
  be exercised and feature-detection paths covered.
- `fetch` — mock per test for components that hit `/api/scrape` / `/api/chat`; shell-level
  streaming is covered by mocking a `ReadableStream` reader.

## Definition of done

```
npm run typecheck   # 0 errors
npm run test:run    # all pass
npm run build       # success
```
