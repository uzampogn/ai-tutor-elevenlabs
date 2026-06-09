# AI News Tutor — Redesign Implementation Spec

> **Reference mockup:** [`AI News Tutor.html`](./AI%20News%20Tutor.html) (same folder).
> Open it in a browser for the source of truth on visuals, spacing, and animation. This
> spec reconstructs the markup/behavior from the mockup's inline CSS (its companion
> `data.js` / `*.jsx` files were not exported) and maps every screen onto the existing
> Next.js app.

---

## 1. Overview & goals

Rebuild the AI News Tutor UI from the current **dark‑purple Tailwind** interface into the
**light "editorial"** design in the mockup: warm oklch grays, a terracotta accent
(`#c75b39`), the **Newsreader** serif for AI answers, **Hanken Grotesk** for UI chrome, and
**JetBrains Mono** for metadata labels.

The product behavior is unchanged: a chat tutor grounded in Anthropic's latest RSS articles,
with streaming answers and optional voice. This redesign adds a **knowledge-base sidebar**, a
**reader drawer** for articles, a structured **Business Impact** card, **source chips**, and
**voice input** (speech-to-text) alongside the existing TTS.

**Scope**
- Replace the current UI entirely (`page.tsx` + components rebuilt; dark UI removed).
- Reuse the existing API routes and streaming/voice/scrape logic.

**Non-goals (this iteration)**
- No structured-JSON `/api/chat` response — Impact/Sources are derived by **client-side
  parsing** of the existing markdown stream.
- No backend rewrite, no conversation persistence, no real article images.

**Confirmed decisions**
1. **Impact / Sources** → client-side parse of the markdown answer; source chips matched to
   loaded articles for real URLs.
2. **Voice** → full **speech-to-text** input via the browser Web Speech API, in addition to
   the existing `/api/speak` TTS output.
3. **Rollout** → **replace** the existing UI.

---

## 2. Design tokens & fonts

### 2.1 Tokens → `src/app/globals.css`

Port the mockup `:root` block **verbatim** into `globals.css` (after the `@tailwind`
directives). These define the entire palette and must not be approximated — the oklch values
are what give the design its character.

```css
:root {
  --accent: #c75b39;
  --answer-font: 'Newsreader', Georgia, serif;

  --bg:        oklch(0.991 0.006 252);
  --panel:     oklch(0.996 0.004 252);
  --panel-2:   oklch(0.968 0.009 252);
  --ink:       oklch(0.255 0.014 260);
  --ink-soft:  oklch(0.44 0.014 260);
  --muted:     oklch(0.60 0.012 260);
  --faint:     oklch(0.72 0.010 260);
  --line:      oklch(0.90 0.010 255);
  --line-2:    oklch(0.945 0.007 255);

  --sans: 'Hanken Grotesk', system-ui, -apple-system, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, monospace;

  --r-sm: 8px; --r: 12px; --r-lg: 16px; --r-xl: 22px;
  --shadow-sm: 0 1px 2px oklch(0.4 0.02 60 / 0.06), 0 1px 3px oklch(0.4 0.02 60 / 0.05);
  --shadow:    0 4px 16px oklch(0.4 0.02 60 / 0.08), 0 1px 3px oklch(0.4 0.02 60 / 0.05);
  --shadow-lg: 0 18px 50px oklch(0.35 0.02 60 / 0.16);

  --gap: 24px;          /* density-controlled message spacing */
  --bubble-pad: 18px;
}
.density-compact { --gap: 16px; --bubble-pad: 14px; }
.density-comfy   { --gap: 34px; --bubble-pad: 22px; }
```

Also port the remaining component CSS from the mockup `<style>` block into `globals.css`
(everything from `.app` down through the responsive `@media` query). The cleanest approach is
to **copy the mockup CSS as-is** and write components whose `className`s match the existing
class names — this makes the port a 1:1 mapping rather than a Tailwind re-translation.

> **Tailwind** stays installed for incidental layout utilities, but the bespoke palette,
> serif typography, and component styling live in these CSS classes. Extending the Tailwind
> theme with these tokens is optional and not required for the port.

### 2.2 Fonts → `src/app/layout.tsx`

Replace the current `Inter` import with the three mockup fonts via `next/font/google`, and
expose them as CSS variables on `<body>` so the `--sans` / `--mono` / `--answer-font` tokens
resolve.

```tsx
import { Newsreader, Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';

const sans  = Hanken_Grotesk({ subsets: ['latin'], weight: ['400','500','600','700'], variable: '--font-sans' });
const serif = Newsreader({ subsets: ['latin'], style: ['normal','italic'], weight: ['400','500','600'], variable: '--font-serif' });
const mono  = JetBrains_Mono({ subsets: ['latin'], weight: ['400','500'], variable: '--font-mono' });
```

Apply `${sans.variable} ${serif.variable} ${mono.variable}` to `<body>`, and in
`globals.css` point the tokens at them (`--sans: var(--font-sans), system-ui, …`, etc.). Set
the base `body { font-family: var(--sans) }` per the mockup. Keep `metadata` as-is.

---

## 3. Component architecture

Replace `ChatInterface.tsx` and `MessageBubble.tsx`. Build the tree below under
`src/components/`. Each component is a near-direct render of the corresponding mockup CSS
classes — the right-hand column is the class contract to honor.

| Component | Role | Mockup CSS classes |
|---|---|---|
| `AppShell` | 2-col grid `320px 1fr`, radial-gradient bg; owns all top-level state | `.app` |
| `Sidebar` | left column wrapper | `.sidebar` |
| `Brand` | logo mark + pulsing accent dot, name + sub | `.brand`, `.brand-mark`, `.brand-pulse`, `.brand-name`, `.brand-sub` |
| `KbHeader` | "Knowledge base" title, live dot, source count (mono), refresh button | `.kb-head`, `.kb-title`, `.kb-refresh`, `.kb-meta`, `.kb-live`, `.live-dot`, `.kb-mono` |
| `KbList` | scrollable list wrapper + "latest articles" label | `.kb-list`, `.kb-list-label` |
| `KbCard` | one article: category dot+name, mono date, title; `is-active`; click opens drawer | `.kb-card`, `.kb-card-top`, `.kb-cat`, `.kb-cat-dot`, `.kb-date`, `.kb-card-title` |
| `Main` | right column wrapper | `.main` |
| `Topbar` | serif page title + sub, `VoiceToggle`, `NewChat` | `.topbar`, `.topbar-l/-r`, `.topbar-title`, `.topbar-sub` |
| `VoiceToggle` | TTS on/off pill with waveform | `.voice-toggle`, `.vt-icon`, `.on` |
| `NewChat` | reset conversation button | `.newchat` |
| `Thread` | scroll container, `max-width:760px` centered | `.scroll`, `.thread` |
| `UserRow` | right-aligned dark bubble | `.row`, `.row-user`, `.bubble-user` |
| `AiRow` | spark avatar + answer body | `.row-ai`, `.ai-avatar`, `.ai-spark`, `.ai-body` |
| `AiStatus` | mono status label + thinking dots while streaming | `.ai-status`, `.status-label`, `.thinking-dots` |
| `AiParagraph` | serif answer paragraph; renders `**bold**`/`*em*`; streaming caret | `.ai-para`, `.caret` |
| `ImpactCard` | "Business Impact" callout card | `.impact`, `.impact-label`, `.impact-text` |
| `SourceChips` | row of clickable source links | `.sources`, `.sources-label`, `.sources-row`, `.source-chip`, `.source-chip-title` |
| `MsgActions` | copy / speak / like row | `.msg-actions`, `.act`, `.is-on` |
| `Welcome` | empty-state hero + suggested questions | `.welcome`, `.welcome-badge`, `.welcome-title`, `.welcome-lede`, `.welcome-grid`, `.welcome-chip`, `.wc-q`, `.wc-arrow` |
| `Composer` | quick chips + textarea + mic + send + footer | `.composer-wrap`, `.quick-row`, `.quick-chip`, `.composer`, `.composer-ta`, `.composer-foot` |
| `MicBtn` | toggles speech-to-text | `.mic-btn` |
| `SendBtn` | submit | `.send-btn` |
| `ArticleDrawer` | right slide-in reader | `.drawer`, `.open`, `.drawer-inner`, `.drawer-head`, `.drawer-close`, `.drawer-date`, `.drawer-title`, `.drawer-hero`, `.ph-label`, `.drawer-summary`, `.drawer-tags`, `.tag`, `.drawer-note` |
| `Waveform` | shared animated bars (voice toggle + while speaking + while listening) | `.wave`, `.wave span`, `.is-active` |

### Notes per component

- **Icons / SVGs.** The mockup uses inline SVGs for the refresh, voice, source-link, mic,
  send, and drawer-close glyphs and the AI "spark" (a CSS `clip-path` polygon). Recreate
  these inline; keep them small and `aria-hidden` with an accessible label on the button.
- **`Waveform`** renders N `<span>` bars; each bar sets `--i` for the staggered
  `animation-delay`. Add the `is-active` class when the relevant state is live
  (TTS playing OR STT listening). Default ~16 bars per the mockup.
- **`KbCard` category color.** The mockup colors each card via a `--c` CSS var on the
  category dot/label. Derive a category + color per article (e.g. map RSS section/keywords to
  a small palette, or rotate through a fixed set). `Article` has no category field, so this is
  a presentational mapping in the component — document the mapping inline.
- **`KbCard` date.** Format `Article.pubDate` to the short mono form shown in the mockup
  (e.g. `JUN 03`).
- **`Welcome` suggested questions.** Reuse the existing `SUGGESTED` array from the current
  `ChatInterface.tsx` (4 items) to fill `.welcome-grid`; reuse a subset for the composer
  `.quick-row` quick chips. Disable quick chips while `isLoading`.

---

## 4. Client-side parsing: markdown answer → Impact card + Source chips

The `/api/chat` route streams **plain markdown text**. Keep it. Derive the structured UI on
the client.

### 4.1 Parser util → `src/lib/parseAnswer.ts`

Pure, framework-free, unit-testable:

```ts
export interface ParsedAnswer {
  body: string;        // markdown before the Business Impact section
  impact: string | null; // text under the Business Impact heading (null if absent)
}

export function parseAnswer(markdown: string): ParsedAnswer;
```

- **Impact split.** Find the `💼 Business Impact` heading the system prompt emits (match
  tolerantly: optional `#`/`**` wrappers, the emoji optional, case-insensitive
  "Business Impact"). Everything after the heading → `impact`; everything before → `body`.
  If no heading is found, `impact = null` and the whole text is `body`.
- **Inline markdown.** Provide a tiny renderer (or render in components) that converts
  `**bold**` → `<strong>` and `*em*`/`_em_` → `<em>` and splits on blank lines into
  paragraphs. Do **not** pull in a heavy markdown library; the answer surface is small
  (bold, italics, paragraphs, simple bullets). Escape/avoid `dangerouslySetInnerHTML` where
  practical by building React nodes from the parsed tokens.
- **Streaming.** Parsing runs on every streamed chunk. While the heading hasn't arrived yet,
  everything renders as `body` (serif paragraphs with the blinking `.caret`); once the
  Business Impact heading streams in, the tail reflows into the `ImpactCard`.

### 4.2 Source chips (matched to loaded articles)

Sources are not parsed from prose markers — they are **recovered by matching**:

- Maintain the `articles: Article[]` list (from `/api/scrape`, already loaded for the
  sidebar).
- After/while an answer streams, scan the full answer text for each article's `title`
  (case-insensitive substring match; normalize whitespace/punctuation; optionally match a
  distinctive leading slice of the title to tolerate minor rewording).
- For each matched article emit a `SourceChip` linking to the real `Article.url` (open in new
  tab, `rel="noopener noreferrer"`), label = article title (ellipsized via
  `.source-chip-title`).
- If nothing matches, render no `.sources` block.

Implement matching as a second pure helper, e.g.
`matchSources(answer: string, articles: Article[]): Article[]`, so it's testable
independently.

### 4.3 System-prompt tweak → `src/app/api/chat/route.ts`

Keep current behavior; tighten two points so parsing is reliable:

- Require the Business Impact section to be the **last block**, under a **fixed heading
  exactly** `💼 Business Impact` (so the split marker is stable).
- Instruct the model to **cite article titles exactly as given** in the knowledge base (so
  source matching is exact). The KB already lists titles via `buildArticleContext`.

No response-shape change; still a plain-text stream.

---

## 5. Voice

Two independent channels share the `Waveform`:

### 5.1 Output (TTS) — existing, keep

Port the current `voiceEnabled` + `playVoice` flow from `ChatInterface.tsx`:
- `VoiceToggle` flips `voiceEnabled`.
- On answer completion, if enabled, POST the final text to `/api/speak`, play the returned
  audio blob (reuse the existing `audioRef` pattern).
- Drive `Waveform.is-active` while audio is playing.

### 5.2 Input (STT) — new, browser-only

Use the **Web Speech API** (`window.SpeechRecognition || window.webkitSpeechRecognition`).
**No new backend route.**

- `MicBtn` toggles a `SpeechRecognition` session (`isListening` state).
- Configure `interimResults = true`, `lang = 'en-US'`, `continuous = false`.
- On `result`: write interim transcript into the composer `input`; on final result, set the
  composer value. **Auto-send** the final transcript (make this a small const flag so it can
  be turned off; default: auto-send on final).
- Drive `Waveform.is-active` while listening; reflect listening state on `.mic-btn`.
- Clean up the recognition instance on stop/unmount; stop listening when a send begins.

**Graceful degradation:** feature-detect on mount. If unsupported (e.g. Firefox), disable the
mic button, add a `title`/`aria-label` explaining voice input isn't available in this
browser. STT being unavailable must never block typing or sending.

> Type note: `SpeechRecognition` lacks DOM lib types in TS — add a minimal ambient
> declaration (e.g. `src/types/speech.d.ts`) or narrow `window` casts; document which.

---

## 6. State & data flow

All top-level state lives in `AppShell` (a client component) and is threaded down as props:

| State | Purpose | Source / notes |
|---|---|---|
| `messages: Message[]` | conversation | reuse `Message` type; keep static `WELCOME`? **No** — the new design uses the dedicated `Welcome` empty state instead of a welcome message. Start `messages` empty and render `Welcome` when `messages.length === 0`. |
| `input: string` | composer text | shared by typing + STT |
| `isLoading: boolean` | streaming in progress | drives `AiStatus`, caret, disabled states |
| `voiceEnabled: boolean` | TTS on/off | `VoiceToggle` |
| `isListening: boolean` | STT active | `MicBtn` / `Waveform` |
| `articles: Article[]` | KB list + drawer + source matching | `/api/scrape` on mount |
| `articlesLoading: boolean` | sidebar loading state | |
| `activeArticle: Article \| null` + `drawerOpen` | reader drawer | set by `KbCard` click |
| `density: 'compact'\|'normal'\|'comfy'` | spacing | toggles `.density-*` class on `.app`; optional control (default `normal`) |

**Reuse the existing logic** from `ChatInterface.tsx`:
- `useEffect` scrape-on-mount → `setArticles`.
- `sendMessage` fetch + `ReadableStream` reader loop (decode chunks, update last assistant
  message). Adapt to empty-initial-`messages` (no `WELCOME` slice offset needed).
- `bottomRef` scroll-into-view on `messages` change.
- `playVoice` for TTS.

`NewChat` clears `messages` and `input` (returns to the `Welcome` state).

---

## 7. Responsive & accessibility

**Responsive** — port the mockup's `@media (max-width: 880px)` rules verbatim:
- `.app` becomes single column; `.sidebar` hidden.
- `.thread`, `.composer`, `.quick-row`, `.composer-foot` go full width.
- `.welcome-grid` → 1 column; `.welcome-title` smaller; `.drawer` full width.

(Consider a mobile affordance to reach the KB/drawer since the sidebar is hidden < 880px —
e.g. a topbar button opening the article list in the drawer. Optional; note as follow-up.)

**Accessibility**
- Icon-only buttons (refresh, voice toggle, mic, send, drawer close, message actions) get
  `aria-label`s; decorative SVGs `aria-hidden`.
- Streaming answer container: `aria-live="polite"` so updates are announced.
- Visible focus styles on all interactive elements (the composer already has a
  `:focus-within` ring; ensure buttons/cards have focus-visible outlines).
- `prefers-reduced-motion`: gate the `pulse`, `pulse-green`, `wv` (waveform), `blink`
  (thinking dots), `spin` (refresh), and `caret` animations behind a
  `@media (prefers-reduced-motion: no-preference)` so motion-sensitive users get a static UI.
- Drawer: trap nothing heavy, but make `Esc` close it and return focus to the triggering
  `KbCard`.

---

## 8. File-change map

**New**
- `src/components/` — the components in §3 (group as you prefer; e.g. `Sidebar/`, `Main/`,
  `ArticleDrawer.tsx`, `Waveform.tsx`, plus an `AppShell.tsx`).
- `src/lib/parseAnswer.ts` — `parseAnswer` + `matchSources` (+ inline-markdown helper).
- `src/types/speech.d.ts` — ambient Web Speech API types (if not using inline casts).

**Modify**
- `src/app/globals.css` — paste mockup tokens + component CSS; add reduced-motion guards.
- `src/app/layout.tsx` — swap Inter → Newsreader / Hanken Grotesk / JetBrains Mono; set font
  CSS variables on `<body>`.
- `src/app/page.tsx` — render `<AppShell />`; remove the dark gradient `<main>` wrapper
  (background now comes from `.app`).
- `src/app/api/chat/route.ts` — system-prompt tweak (§4.3).
- `tailwind.config.js` — optional token `extend` (not required).

**Remove**
- `src/components/ChatInterface.tsx`, `src/components/MessageBubble.tsx` (logic migrated into
  the new tree; keep the `Message` type, relocating it e.g. to `src/lib/types.ts`).

**Untouched**
- `src/app/api/scrape/route.ts`, `src/lib/scraper.ts`, `src/app/api/speak/route.ts`.
- The mockup HTML (kept as the visual reference).

---

## 9. Out of scope / future

- Structured-JSON `/api/chat` response (would replace §4 parsing) — deferred.
- The `tweaks-panel` design tool from the original mockup export.
- Real article hero images in the drawer (placeholder hatch pattern for now).
- Conversation persistence / multi-conversation history.
- Mobile sidebar affordance (noted in §7).

---

## 10. Verification

1. `npm run dev`. Visually diff each screen against `AI News Tutor.html`:
   - **Welcome** empty state (badge, serif title with italic accent, lede, 2×2 chips).
   - **Sidebar** KB cards (category dot/color, mono date, title; active state) and live
     header; refresh re-hits `/api/scrape` with the spin animation.
   - **Streamed answer**: serif paragraphs + blinking caret while streaming; thinking dots in
     `AiStatus`; reflow into the **Impact card** once `💼 Business Impact` arrives; **source
     chips** appear linking to real Anthropic article URLs.
   - **Article drawer** opens from a KB card, shows date/title/summary/tags, closes on `Esc`.
   - **Composer**: quick chips, textarea autosize, focus ring.
2. Send a suggested question end-to-end → confirm streaming, parsed Impact card, and source
   chips that resolve to actual `Article.url`s.
3. **TTS**: toggle voice on → confirm `/api/speak` audio plays and the waveform animates.
4. **STT**: press mic (Chrome/Edge) → confirm transcript fills the composer and the waveform
   animates; in Firefox confirm the mic is disabled with an explanatory label.
5. Resize to ≤ 880px → sidebar hidden, thread/composer full width, drawer full width.
6. `prefers-reduced-motion` enabled → animations are suppressed.
7. `npm run build` and lint pass clean.
```
