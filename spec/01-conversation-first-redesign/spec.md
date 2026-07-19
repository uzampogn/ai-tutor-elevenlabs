# Spec — Conversation-First Redesign (Aurora Mist)

**Project:** AI News Tutor (`Projects/ai-tutor`, Next.js 14 + TS + Tailwind)
**Status:** Approved direction, pending implementation
**Date:** 2026-06-13

---

## Context

The AI News Tutor is currently a sidebar + chat-thread + text/voice composer app in a
warm-cream / terracotta (`#c75b39`) palette. We are making it **conversation-first**:

1. The input area gets **two modes** — (a) the existing **text + voice** composer, and
   (b) a new **voice-only** mode with a **large central animated orb**. The two are
   switchable, and **voice-only is the default**.
2. The overall UI should feel **modern / futuristic** (glassmorphic polish, like the
   "DO.er" reference) but **not** that reference's mauve palette.
3. Adopt a **soft, airy, pastel palette** like the Wysa reference — light blue / lilac,
   frosted glass, a glowing orb.

**Chosen creative direction:** **Aurora Mist**. Voice-only mode is **consistent /
unified** — same palette and background as chat; it swaps the composer for the orb rather
than becoming a separate full-screen environment. The sidebar and header remain visible in
both modes.

---

## Part 1 — Creative Brief (Aurora Mist)

Anchor brief for all styling work. Copy-paste-ready prompt block:

```
Redesign the AI News Tutor UI in the "Aurora Mist" direction: soft, airy, futuristic,
frosted-glass. The mood is calm and friendly — a luminous pastel-blue/lilac atmosphere
with glowing, glassy surfaces floating over a gently gradient background. Apply this tonal
system consistently across the whole UI — no accent colors outside the palette.

COLOR PALETTE (darkest → lightest):
- Ink (text):        #1B2236  cool near-black slate
- Ink-soft:          #4A5470  secondary text
- Muted:             #7C86A0  tertiary text / icons
- Accent-strong:     #4F7BE8  interactive text, links, focus (use where AA contrast needed)
- Accent (sky):      #8AB4FF  primary fills, icon buttons, orb core
- Accent-2 (lilac):  #C9B8FF  gradients, orb glow, secondary highlights
- Line:              #E1E7F4  hairline borders
- Surface:           #FFFFFF at 70–80% opacity (frosted glass) over...
- Background:        #EDF1FB base, with a soft aurora radial gradient (sky top-left,
                     lilac bottom-right, both very low saturation)

Surfaces are translucent white with backdrop-blur (12–20px) and a 1px #E1E7F4 hairline.
Shadows are soft and cool-blue-tinted, never gray/black.

TYPOGRAPHY:
- UI + headings: Plus Jakarta Sans (geometric humanist, modern). Tight tracking on
  headings (letter-spacing -0.02em). If Satoshi is available via self-hosting, prefer it.
- Long-form answers: Newsreader (serif) retained for editorial contrast — 17px, 1.6 line.
- Mono labels: JetBrains Mono for tiny meta labels/timestamps.
- Avoid Inter, Roboto, Arial, system-ui as primary UI faces.

LAYOUT:
- Keep the 320px sidebar + fluid main column. Max content width 760px, centered.
- Border-radius: 999px for pills/buttons, 22px for the composer and large cards, 12–16px
  for smaller cards. Be consistent.
- Generous vertical rhythm; let the background breathe around glass surfaces.

THE ORB (voice-only mode centerpiece):
- Large (~220–280px), centered where the composer would sit.
- Iridescent gradient core: white center → #8AB4FF → #C9B8FF → soft #E9D8FF edge, via a
  slowly rotating conic/radial blend.
- Soft outer bloom (blurred radial glow) that breathes (gentle scale + opacity pulse).
- State-reactive:
    idle      → slow breathing, calm.
    listening → faster pulse + expanding concentric ripple rings + brighter rim.
    thinking  → orbiting shimmer / rotating gradient speeds up subtly.
    speaking  → amplitude-style outer ring that reacts in soft waves.
- All motion gated behind `prefers-reduced-motion: no-preference`; reduced-motion users
  get a static glowing orb.

COMPONENT GUIDANCE:
- Buttons/pills: flat translucent glass, 160ms ease-out hover that shifts brightness +
  border contrast only — no large transforms.
- Composer (text mode): frosted glass pill, focus ring = 4px soft sky halo
  (color-mix accent 10%), border brightens to accent-strong.
- Mode switch: a small segmented "Voice / Text" pill toggle near the input dock.

<frontend_aesthetics>
NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto,
Arial, system fonts), cliched color schemes (particularly purple gradients on white or
dark backgrounds), predictable layouts and component patterns, and cookie-cutter design
that lacks context-specific character. Use unique fonts, cohesive colors and themes, and
animations for effects and micro-interactions.
</frontend_aesthetics>
```

**What makes this distinctive:** a cool, low-saturation aurora gradient + frosted glass
surfaces + a single iridescent state-reactive orb — a coherent system rather than a flat
template; pastel sky/lilac stays off the cliché purple-gradient path by keeping saturation
low and pairing it with a cool-slate ink.
**Trade-off:** pastel `#8AB4FF` is low-contrast on white for *text*; mitigate by using
`#4F7BE8` (accent-strong) for any text/icon needing AA, reserving the pastel for
fills/glows.

---

## Part 2 — Implementation

### 2.1 Palette + glass foundation — `src/app/globals.css`
- Replace the `:root` tokens with the Aurora Mist values above (keep the **same token
  names** — `--accent`, `--bg`, `--panel`, `--ink`, `--line`, etc. — so the change
  cascades through every component automatically). Add `--accent-2` (lilac) and
  `--accent-strong`.
- Convert hardcoded warm spots to cool: `--bg` as an aurora radial gradient on `body`;
  cool-tint the `--shadow*` values (blue hue); soften `.brand-mark`/`.ai-avatar`
  gradients to sky→lilac.
- Add frosted glass to surfaces: `backdrop-filter: blur(...)` + translucent white on
  `.sidebar`, `.composer`, `.welcome-chip`, `.kb-card` (topbar already blurs).
- Hardcoded greens (`.welcome-badge`, `.live-dot`, `.kb-live`) → keep as a calm success
  green or retune to the cool family; minor.

### 2.2 Font swap — `src/app/layout.tsx`
- Replace `Hanken_Grotesk` with **`Plus_Jakarta_Sans`** from `next/font/google` bound to
  `--font-sans` (keep `Newsreader` → `--font-serif`, `JetBrains_Mono` → `--font-mono`).
- (Optional, later) self-host Satoshi via `next/font/local` for an exact match; Plus
  Jakarta Sans is the closest Google-hosted substitute and needs no assets.

### 2.3 Extract STT into a reusable hook — `src/components/main/useSpeechRecognition.ts` (new)
- The `SpeechRecognition` setup currently inside `MicBtn.tsx` (feature-detect, build-once
  instance, interim/final handlers, `toggle()`) is needed by **both** the mic button and
  the orb. Extract it into `useSpeechRecognition({ listening, setListening, onInterim,
  onFinal, disabled })` returning `{ supported, toggle }`.
- Refactor `MicBtn.tsx` to consume the hook (behavior unchanged — reuse, not rewrite).

### 2.4 Input-mode state — `src/components/AppShell.tsx`
- Add `const [inputMode, setInputMode] = useState<'voice' | 'text'>('voice')` (**voice is
  default**).
- Replace the single `<Composer .../>` with a new **`<InputDock .../>`** receiving
  `inputMode`, `setInputMode`, the existing composer props
  (`input/setInput/isLoading/listening/setListening/onSend`), and the
  `speaking`/`speakingContent` signal so the orb can react to TTS playback.

### 2.5 New components
- **`src/components/main/Orb.tsx`** — large animated orb. Pure CSS/SVG (conic-gradient
  core, blurred bloom, ripple rings). Props: `state: 'idle' | 'listening' | 'thinking' |
  'speaking'`, `onClick`, `disabled`. Keyframes wrapped in the existing
  `@media (prefers-reduced-motion: no-preference)` block.
- **`src/components/main/VoiceDock.tsx`** — voice-only layout: centered `Orb` + one-line
  status/transcript readout + mode toggle. Tapping the orb calls `toggle()` from
  `useSpeechRecognition`; final transcript auto-sends via existing `onSend` (same
  `AUTO_SEND` path in `Composer`). Reuse `Waveform.tsx` for the readout.
- **`src/components/main/InputDock.tsx`** — renders the **mode switch** (segmented
  "Voice / Text" pill) and conditionally shows `VoiceDock` (voice) or `Composer` (text).
  Keeps the `.composer-wrap` footer/disclaimer.

### 2.6 Styling for new pieces — `globals.css`
- Add `.input-mode-switch` (segmented glass pill), `.voice-dock` (centered column),
  `.orb`, `.orb-core`, `.orb-bloom`, `.orb-ring`, and orb `@keyframes`
  (breathe / ripple / shimmer) inside the reduced-motion guard.

### Files touched
- Modify: `src/app/globals.css`, `src/app/layout.tsx`, `src/components/AppShell.tsx`,
  `src/components/main/MicBtn.tsx`.
- New: `src/components/main/useSpeechRecognition.ts`, `Orb.tsx`, `VoiceDock.tsx`,
  `InputDock.tsx`.
- Unchanged behavior: `/api/chat`, `/api/speak`, `Thread`, `Sidebar`, `ArticleDrawer`,
  `Composer` (restyled via tokens only, logic intact).

### Decisions
- Voice mode is **consistent/unified**: same bg + sidebar + topbar; only the bottom input
  region swaps composer ↔ orb. No separate full-screen route.
- The orb replaces the composer in voice mode but the thread above stays visible, so
  spoken Q&A still scrolls in the conversation.

---

## Verification

1. `cd Projects/ai-tutor && npm run dev`, open the app.
2. **Default mode**: app opens in **voice-only** mode — large animated orb centered in the
   input region; sidebar + topbar + thread present; palette is Aurora Mist (no
   cream/terracotta, no mauve).
3. **Orb interaction**: click the orb → `listening` (ripple/pulse), speak a question →
   interim transcript shows, final transcript auto-sends, answer streams in the thread; if
   TTS on, orb shows `speaking` reaction.
4. **Mode switch**: toggle to **Text** → frosted-glass composer (textarea + mic + send +
   quick chips) works as before; toggle back to **Voice**.
5. **Reduced motion**: with `prefers-reduced-motion: reduce`, the orb is static-glowing and
   no ripple/breathe animations run.
6. **Responsive**: at <880px the sidebar hides and the orb/composer remain centered and
   usable.
7. Visual check against the Aurora Mist brief (frosted glass, cool shadows, Plus Jakarta
   Sans UI, Newsreader answers). Optionally screenshot via Playwright MCP.
8. `npm run build` (or `npx tsc --noEmit`) passes — no type errors from new props/hook.
