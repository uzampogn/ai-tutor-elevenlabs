# Spec — Center the welcome composition (text block + orb on one axis)

**Project:** AI News Tutor (`Projects/ai-tutor`, Next.js 14 + TS + Tailwind)
**Branch:** `aurora-mist-redesign`
**Status:** ✅ Implemented & verified on `aurora-mist-redesign` (2026-06-13)
**Date:** 2026-06-13
**Visual system:** Aurora Mist — **locked** (no palette/font/radius/shadow/`@keyframes` changes)
**Builds on:** [`layout-fix-sidebar-content-centering.md`](./layout-fix-sidebar-content-centering.md), [`conversation-first-cleanup.md`](./conversation-first-cleanup.md)

---

## Goal

In the **welcome / idle state**, align the **upper section (welcome text + suggested-question
cards)** and the **lower section (voice orb)** to the **same center of the conversational space**
(the `.main` column right of the sidebar) — both horizontally on one shared vertical axis, and
vertically balanced so the screen reads as one centered composition instead of top-left text with a
floating orb.

This is the "Both (block)" centering option:
- **Horizontal** — the welcome block's center sits on the orb's vertical axis (`.main` center). Text
  stays **left-aligned inside the block** (heading and lede do not become center-aligned text).
- **Vertical** — the welcome block is centered in the space **above** the docked orb (un-jam the top),
  with the orb staying bottom-docked per the locked conversation-first decision.

```
        main column (right of sidebar)
┌───────────────────────────────────────┐
│                                        │
│          Understand the latest…        │  ← welcome BLOCK centered on
│          Ask anything about Anthropic…    main's axis; text left-aligned
│          [ card ]   [ card ]              inside the block
│          [ card ]   [ card ]           │
│                                        │
│                  ( • )                 │  ← orb already on the same axis
│            [ Voice | Text | New ]      │     (no change needed)
│         Answers are grounded in…       │
└───────────────────────────────────────┘
```

---

## Context — current behavior (matches Image #3)

`.main` is a flex column: `.scroll` (flex:1, the conversation/welcome area) on top, then the
`InputDock` output (`.voice-dock` + `.composer-foot`) docked below.

**Why the orb is centered but the text is not:**

| Element | Rule (globals.css) | Effect |
|---------|--------------------|--------|
| `.thread` | `max-width: var(--content-max); margin: 0 auto; padding: 34px 32px 28px` (`:222`) | 920px column **centered** in `.main`, but **top-anchored** (34px top pad, content flows down) |
| `.welcome` | `padding: 30px 4px 10px` — **no `max-width`/`margin`** (`:364`) | Fills the full `.thread` width; children are **left-aligned**, so the block hugs the column's **left edge** → left-biased |
| `.welcome-title` / `-lede` / `-grid` | `max-width: 22ch` / `56ch` / `620px` (`:365`,`:371`,`:375`) | Each left-aligned within `.welcome`; the 620px grid is the widest child |
| `.voice-dock` | `max-width: var(--content-max); margin: 0 auto; align-items: center` (`:506–509`) | 920px column centered in `.main`, orb **centered** → orb on `.main`'s axis |

Net: the orb already sits on `.main`'s center axis; the welcome block is **left-biased and
top-jammed**. The fix is to bring the welcome block onto that same axis and center it vertically in
the space above the orb. **The orb / `.voice-dock` need no change.**

---

## Changes — all in `src/app/globals.css` (CSS-only, no JSX/TS)

### 1. Horizontal — center the welcome block on the orb's axis

Give `.welcome` an explicit content width equal to its widest child (the 620px grid) and center it
inside the already-centered `.thread` column. Children stay left-aligned (default), so the block is
centered while the **text inside it remains left-aligned**.

```css
/* shared welcome content width — keeps block + grid in sync */
.app { --welcome-col: 620px; }            /* add beside the existing --content-max (:94) */

.welcome {
  max-width: var(--welcome-col);
  margin-inline: auto;                     /* center the block in .thread → on .main's axis */
  padding: 30px 4px 10px;                  /* unchanged */
}
.welcome-grid { max-width: var(--welcome-col); }  /* was 620px (:376) — now the token */
```

Result: welcome block center = `.thread` center = `.main` center = orb center. The 2×2 grid fills the
block (so the cards span the full centered width); the heading (22ch) and lede (56ch) stay
left-aligned to the block's left edge — exactly the chosen layout.

### 2. Vertical — center the welcome composition above the docked orb (welcome state only)

Scope the vertical centering to the welcome state with `:has(.welcome)` — `.welcome` only renders when
`messages.length === 0` (`Thread.tsx`), so this never affects the active answer thread. Use auto
margins (not `justify-content: center`) so content taller than the viewport still scrolls from the
top instead of clipping.

```css
/* Welcome state only: center the thread block in the space above the orb.
   Auto margins are overflow-safe (collapse to 0 when content exceeds height). */
.scroll:has(.welcome) { display: flex; flex-direction: column; }
.scroll:has(.welcome) .thread { margin: auto; }   /* both axes; max-width still caps horizontally */
```

The orb stays bottom-docked (`.voice-dock` is below `.scroll` in `.main`); the welcome block now
centers in the upper region, giving a balanced, single-composition read.

**Scrollbar-gutter (added during implementation).** The orb lives in `.voice-dock` *outside*
`.scroll`, so when the welcome overflows a short viewport and a **classic** (non-overlay) scrollbar
appears, that scrollbar shifts the in-`.scroll` welcome block ~½ a scrollbar-width off the orb's
axis. Reserve the gutter symmetrically so the block stays centered:

```css
.scroll { /* …existing flex:1; overflow-y:auto; min-height:0… */
  scrollbar-gutter: stable both-edges;
}
```

No effect on macOS overlay scrollbars (0 layout width — already pixel-perfect there); on
classic-scrollbar platforms it keeps the welcome centered and prevents a layout shift when the
scrollbar appears mid-session.

### 3. Leave the orb and dock untouched

No change to `.voice-dock`, `.orb`, `--orb-size`, `.session-controls`, or `.composer-foot`. The orb is
already on `.main`'s center axis and bottom-docked per [`conversation-first-cleanup.md`](./conversation-first-cleanup.md) — that decision is preserved.

### 4. Responsive — unchanged (optional tidy)

`@media (max-width: 880px)` (`:758–767`) is untouched: single-column grid, sidebar hidden, the five
content selectors → `max-width: 100%`, orb caps. The welcome block (≤620px) already fits narrower
viewports; the `:has(.welcome)` vertical centering still applies and stays overflow-safe.
*(Optional: add `.welcome` to the `max-width: 100%` override list at `:761` for symmetry.)*

---

## Implementation prompt (via /ui-prompt — layout-only, Aurora Mist locked)

> In `src/app/globals.css` for the AI News Tutor, center the **welcome/idle composition** in the
> `.main` column so the welcome text block and the voice orb share one vertical center axis and read
> as a single, vertically balanced composition. **Inherit the existing Aurora Mist system verbatim** —
> every color, font, radius, shadow, `backdrop-filter`, and `@keyframes`. Layout mechanics only; no
> palette/type/accent changes, no JSX/TS edits.
>
> **Horizontal:** Add `--welcome-col: 620px` on `.app`. Set `.welcome { max-width: var(--welcome-col);
> margin-inline: auto; }` and switch `.welcome-grid`'s `620px` to `var(--welcome-col)`. The block
> centers within the already-centered `.thread`; text inside stays **left-aligned** (do NOT add
> `text-align: center` to the heading/lede). Net: welcome block center = orb center = `.main` center.
>
> **Vertical (welcome state only):** `.scroll:has(.welcome) { display: flex; flex-direction: column; }`
> and `.scroll:has(.welcome) .thread { margin: auto; }`. Use auto margins (not `justify-content:
> center`) so tall content scrolls from the top rather than clipping. `.welcome` only renders in the
> empty state, so the active answer thread keeps its top-down scrolling layout — verify it is
> unaffected.
>
> **Do not touch** `.voice-dock`, `.orb`, `--orb-size`, `.session-controls`, `.composer-foot`, or the
> `@media (max-width: 880px)` block — the orb is already centered and bottom-docked and must stay so.
>
> Verify at 1280/1440/1920px: the welcome block's horizontal center equals the orb's center equals
> `.main`'s center (equal left/right gaps); the welcome block is vertically centered in `.scroll`
> (roughly equal gap above it and below it down to the dock); no horizontal overflow; and once a
> message is sent, the thread reverts to top-anchored scrolling.
>
> ```xml
> <frontend_aesthetics>
> NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto,
> Arial, system fonts), cliched color schemes (particularly purple gradients on white or
> dark backgrounds), predictable layouts and component patterns, and cookie-cutter design
> that lacks context-specific character. Use unique fonts, cohesive colors and themes, and
> animations for effects and micro-interactions.
> </frontend_aesthetics>
> ```

Build effort: **xhigh** (layout-sensitive, per /ui-prompt guidance).

---

## Verification

1. **Dev server** (`PORT=3838 npm run dev`) — load `http://localhost:3838` in the welcome state; via
   Playwright `browser_resize` + `browser_evaluate` at **1280, 1440, 1920px**:
   - `centerX(.welcome) ≈ centerX(.orb) ≈ centerX(.main)` (within ~1px) — shared vertical axis.
   - `.welcome` text **left-aligned** inside the block (heading/lede ragged-right, not centered text).
   - `.welcome` vertically centered in `.scroll` — gap above ≈ gap below (down to the dock).
   - `document.documentElement.scrollWidth === window.innerWidth` (no horizontal overflow).
   - Sidebar `left === 0` (the prior layout-fix invariant still holds).
2. **State scope** — send a message: the answer thread is **top-anchored and scrolls** normally
   (no centering); `.scroll:has(.welcome)` no longer matches. Click **New chat** → welcome re-centers.
3. **Responsive** — 880px: sidebar hides, grid stacks single-column, welcome still centered, no
   overflow. 480px: orb caps, welcome scrolls from top if it exceeds height (no top clip).
4. **Automated** — `npx tsc --noEmit` clean; `npx vitest run` green; `npm run build` succeeds.

### (Optional) Regression lock
In `src/app/globals.tokens.test.ts`, assert `.welcome` contains `margin-inline: auto` + a
`--welcome-col`-based `max-width`, and that `.scroll:has(.welcome) .thread` sets `margin: auto`, so
the centering can't silently regress.

---

## Files touched
- `src/app/globals.css` — `--welcome-col` token; `.welcome` block-center; `.welcome-grid` token swap;
  `.scroll:has(.welcome)` + `.thread` vertical centering; `scrollbar-gutter: stable both-edges` on
  `.scroll`.
- `src/app/globals.tokens.test.ts` — regression assertions (4 cases): `--welcome-col` token,
  `.welcome` `margin-inline: auto` + `max-width: var(--welcome-col)`, and
  `.scroll:has(.welcome) .thread { margin: auto; }`.

---

## Verification — results (2026-06-13, `aurora-mist-redesign`)

- **`npx tsc --noEmit`** — clean.
- **`npx vitest run`** — 140/140 passing (incl. the 4 new welcome-centering assertions in
  `globals.tokens.test.ts`).
- **Live (`localhost:3838`), Playwright `browser_resize` + `browser_evaluate`:**
  - **1440×900:** `centerX(.welcome) = centerX(.welcome-grid) = centerX(.orb) = centerX(.main) = 880`
    (all deltas 0); welcome/title `text-align: start` (text left-aligned inside the centered block);
    vertical gaps above/below = 64/58 (~6px = thread's 34/28 top/bottom padding); sidebar `left=0`;
    no horizontal overflow.
  - **1280×800 (welcome overflows → classic scrollbar present):** before `scrollbar-gutter`, welcome
    was 5px (½ scrollbar) off the orb's axis; after, all centers = 800, delta 0.
  - **1920×1080:** all centers = 1120, delta 0; gaps 140/134; sidebar `left=0`; no overflow.
  - **Answer-thread state** (after sending a query): `.welcome` unmounts, `.scroll:has(.welcome)` no
    longer matches, `.scroll` reverts to `display:block`, `.thread` `margin-top:0` and scrolls
    top-down — centering is correctly welcome-only. New chat restores the centered welcome.
- **`next build`** — **not run**: a `next dev` server is live on :3838 and building against it corrupts
  `.next`. The change is CSS-only (no TS/imports), so `tsc` + the full vitest suite + live
  multi-width browser verification cover it; run `npm run build` after stopping dev if a CI-parity
  check is wanted.

## Out of scope
- No change to the orb, `.voice-dock`, session controls, or footer (orb already centered + docked).
- No centering of the active answer thread (welcome state only).
- No palette/type/accent/shadow/keyframe changes; no JSX/TS edits.
- The bottom-dock orb position (≤25vh) and all responsive caps stay as locked in prior specs.
```
