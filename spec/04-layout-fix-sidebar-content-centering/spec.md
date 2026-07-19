# Spec — Layout fix: sidebar-left, content centered-in-main, fluid

**Project:** AI News Tutor (`Projects/ai-tutor`, Next.js 14 + TS + Tailwind)
**Branch:** `aurora-mist-redesign`
**Status:** Approved direction, pending implementation
**Date:** 2026-06-13
**Visual system:** Aurora Mist — **locked** (no palette/font/radius/shadow/keyframe changes)

---

## Context

A regression was introduced in `src/app/globals.css`: the shell rule `.app` gained
`width:100%; max-width:1280px; margin-inline:auto;`. That centered the **entire** shell
(sidebar + main) in the viewport, so on laptop/large screens the **left sidebar floats away
from the viewport's left edge** (visible empty band to its left).

Desired web layout (laptop ~1280–1440px and larger/ultrawide 1920px+):
1. **Left sidebar always flush to the viewport's left edge** (fixed 320px column).
2. **Conversational content centered within the main column's space**, consistently in every
   state (welcome hero, answer thread, voice orb dock, text composer, session controls, footer).
3. **No lopsided empty band; intentional across screen sizes.**

Chosen content behavior on wide screens: **Fluid, capped** — the centered content column grows
with the viewport but is capped at a readable width (`clamp(720px, 64vw, 920px)`), centered in
main. It breathes on large screens without an empty band and stays readable.

## Root cause (confirmed)

`src/app/globals.css` `.app` rule (lines ~86–90): `max-width:1280px; margin-inline:auto;`
caps and centers the whole grid; the sidebar is part of `.app`, so it gets pushed inward.
Inner content elements are **already** centered within main via `max-width:760px; margin:0 auto`,
so only the shell-level cap needs undoing — plus we upgrade the fixed 760px to the fluid width.

---

## Changes — all in `src/app/globals.css`

### 1. Revert `.app` to a full-width grid (sidebar flush-left)
Remove `width:100%`, `max-width:1280px`, `margin-inline:auto` (and the comment added with them):
```css
.app {
  height: 100%;
  display: grid;
  grid-template-columns: 320px 1fr;
  background: transparent;
}
```
Sidebar pins to the viewport left edge; `.main` (the `1fr` track) fills the remaining width;
the article `.drawer` (`position:fixed; right:0`) re-aligns to the true right edge.

### 2. One fluid content-width token, applied to every centered column
Define on `.app` (or `:root`):
```css
--content-max: clamp(720px, 64vw, 920px);
```
Replace `max-width: 760px;` → `max-width: var(--content-max);` (keep existing `margin: 0 auto`)
on the five elements sharing the reading column:
- `.thread` (globals.css:216)
- `.quick-row` (globals.css:406)
- `.composer` (globals.css:422)
- `.composer-foot` (globals.css:456)
- `.voice-dock` (globals.css:497)

`max-width` only caps the upper bound, so between 880–~1040px (where main < 720px) each block
fills `main` with no overflow; above that it caps and centers. No new breakpoint needed.

### 3. Leave responsive + drawer rules unchanged
- `@media (max-width:880px)` (globals.css:747–750): single-column grid, sidebar hidden, and the
  same five selectors forced to `max-width:100%` — that override correctly wins over the var.
  `--orb-size` caps (880/480) untouched.
- `.drawer` needs no change; reverting `.app` to full-width restores its viewport-right alignment.

### 4. (Optional, recommended) Regression lock in the token test
In `src/app/globals.tokens.test.ts`, assert `.app` keeps `grid-template-columns: 320px 1fr`
and does **not** contain `margin-inline: auto` / a `max-width` on `.app`, so the regression
can't silently return.

---

## Implementation prompt (via /ui-prompt — layout-only, Aurora Mist locked)

> Fix the AI News Tutor shell layout in `src/app/globals.css`. **Inherit the existing Aurora
> Mist design system verbatim** — every color, font, radius, shadow, `backdrop-filter`, and
> `@keyframes`. No new accent colors, no palette/type changes; layout mechanics only.
>
> **Shell:** `.app` is a CSS grid `grid-template-columns: 320px 1fr` spanning the **full
> viewport width** — never cap or center the shell. The 320px sidebar sits flush to the
> viewport's left edge at all widths ≥880px.
>
> **Content column:** Introduce `--content-max: clamp(720px, 64vw, 920px)`. Every conversational
> element — `.thread` (welcome hero + answer rows), `.voice-dock` (orb + session controls),
> `.quick-row`, `.composer`, `.composer-foot` — uses `max-width: var(--content-max); margin: 0 auto`
> so they share one column **centered within the main `1fr` track** that grows fluidly, capped at
> 920px for readability. Consistent across welcome, voice, and text states.
>
> **Responsive:** Keep the `@media (max-width:880px)` rules (single-column grid, sidebar hidden,
> the five content selectors → `max-width:100%`) and the orb-size caps. Add no other breakpoints.
>
> **Layout rules:** Border-radius, glass surfaces, and spacing rhythm are inherited — do not alter;
> transitions stay subtle (existing `.16s–.2s ease-out`). Verify no horizontal overflow at 1280,
> 1440, 1920, 2560px, and that the sidebar's left edge is at x=0 on every desktop width.
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

Build effort: **xhigh** (per /ui-prompt guidance for layout-sensitive UI work).

---

## Verification

1. **Dev server** (`PORT=3838 npm run dev`) — load `http://localhost:3838`; check at **1280, 1440,
   1920, 2560px** via Playwright `browser_resize` + `browser_evaluate`:
   - `.sidebar` bounding box `left === 0` at every desktop width.
   - `.thread` / `.voice-dock` centered in `.main` (equal left/right gap inside main), width
     ≈ `clamp(720, 64vw, 920)`.
   - `document.documentElement.scrollWidth === window.innerWidth` (no horizontal overflow).
   - Screenshot welcome + active answer + voice + text states for consistent centering.
2. **Breakpoints** — 880px: sidebar hides, content full-width; 480px: orb shrinks; no overflow.
3. **Automated** — `npx tsc --noEmit` clean, `npx vitest run` green (131 + any new assertion),
   `npm run build` succeeds.

## Files touched
- `src/app/globals.css` — `.app` revert + `--content-max` var + 5 `max-width` swaps.
- `src/app/globals.tokens.test.ts` — optional regression assertion for `.app`.
