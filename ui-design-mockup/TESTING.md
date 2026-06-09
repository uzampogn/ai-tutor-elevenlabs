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

### 2. Component — rendering & interaction (RTL)

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

### 3. Integration gates

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
