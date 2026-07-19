# Spec — Reduce the voice orb by 15% (free vertical space for the text)

**Project:** AI News Tutor (`Projects/ai-tutor`, Next.js 14 + TS + Tailwind)
**Branch:** `main`
**Status:** 📋 Proposed (not yet implemented)
**Date:** 2026-06-13
**Visual system:** Aurora Mist — **locked** (no palette/font/radius/shadow/`@keyframes` changes)
**Builds on:** [`center-welcome-composition.md`](./center-welcome-composition.md), [`conversation-first-cleanup.md`](./conversation-first-cleanup.md)

---

## Goal

Shrink the **voice-input orb by 15%** so the docked orb takes less vertical room and the
conversation / welcome text above it gets more breathing space. The orb stays bottom-docked, centered
on `.main`'s axis, and keeps every Aurora Mist visual (gradient core, bloom, rings, all animation
states). **Size only — nothing else changes.**

```
        main column (right of sidebar)
┌───────────────────────────────────────┐
│   Understand the latest…               │
│   Ask anything about Anthropic…        │  ← more room for text/cards
│   [ card ]   [ card ]                  │     as the orb gets smaller
│   [ card ]   [ card ]                  │
│                                        │
│                ( • )    ← −15%         │  ← orb still centered + docked
│          [ Voice | Text | New ]        │
│       Answers are grounded in…         │
└───────────────────────────────────────┘
```

---

## Context — how the orb is sized today

The orb's footprint is driven by a single custom property, `--orb-size`, set on `.orb` and overridden
at two breakpoints (`src/app/globals.css`):

| Where | Rule | Active value |
|-------|------|--------------|
| `.orb` (base) | `--orb-size: min(248px, 25vh)` (`:554`) | 248px, capped to 25vh on short viewports |
| `@media (max-width: 880px)` | `.orb { --orb-size: min(200px, 25vh) }` (`:789`) | 200px |
| `@media (max-width: 480px)` | `.orb { --orb-size: min(168px, 25vh) }` (`:792`) | 168px |

Every visual sub-layer is sized in **percentages of the button**, so they all scale automatically when
`--orb-size` changes — no other rule needs touching:

| Element | Sizing (`globals.css`) | Scales with `--orb-size`? |
|---------|------------------------|---------------------------|
| `.orb` button | `width/height: var(--orb-size)` (`:556`) | — (the source of truth) |
| `.orb-core` | `inset: 14%` (`:573`) | ✅ |
| `.orb-core::before` (specular) | `top/left/width/height` in `%` (`:603`) | ✅ |
| `.orb-bloom` | `inset: -22%` (`:613`) | ✅ |
| `.orb-ring` ×2 | `inset: 0` (`:627`) | ✅ |
| Ripple/bloom/shimmer `@keyframes` | scale/opacity transforms (`:762+`) | ✅ (locked, untouched) |

The orb also lives in `.voice-dock`, which is **below** `.scroll` in `.main`. A shorter orb shifts the
dock cluster down and frees the area above it for the conversation/welcome text — exactly the intent.
`.voice-dock` itself (gap, centering, max-width) is **unchanged**.

---

## Changes — `src/app/globals.css` only (CSS-only, no JSX/TS)

15% smaller = multiply the size by **0.85** at every viewport (scale both the px cap **and** the `25vh`
ceiling so the orb is uniformly −15% on tall and short screens alike).

### Recommended — explicit `--orb-scale` token (single, self-documenting source of intent)

Keep the original design caps (248 / 200 / 168 px) visible in source and apply one labelled −15%
factor. This makes the change legible, reversible, and trivially tunable later.

```css
.orb {
  /* −15% so the orb stays compact and frees vertical space for the conversation/text above.
     Caps are the locked design values (248/200/168px); --orb-scale applies the reduction. */
  --orb-scale: 0.85;
  --orb-size: calc(min(248px, 25vh) * var(--orb-scale));   /* was min(248px, 25vh) */
  /* …rest of .orb unchanged… */
}

/* keep the two responsive overrides reduced by the same factor */
@media (max-width: 880px) { .orb { --orb-size: calc(min(200px, 25vh) * var(--orb-scale)); } }  /* was 200px */
@media (max-width: 480px) { .orb { --orb-size: calc(min(168px, 25vh) * var(--orb-scale)); } }  /* was 168px */
```

Resulting sizes: **211px / 170px / 143px** (px caps), 25vh → **21.25vh** ceiling. (`--orb-scale` is
declared once on `.orb`; the media queries inherit it via the same element, so only `--orb-size` is
re-stated.)

### Alternative — inline recomputed values (no `calc`, matches the existing `min()` pattern)

If you'd rather not introduce a token:

```css
.orb { --orb-size: min(211px, 21.25vh); }                                 /* was min(248px, 25vh) */
@media (max-width: 880px) { .orb { --orb-size: min(170px, 21.25vh); } }   /* was min(200px, 25vh) */
@media (max-width: 480px) { .orb { --orb-size: min(143px, 21.25vh); } }   /* was min(168px, 25vh) */
```

Both produce the identical −15% orb. The token form is preferred for legibility/maintainability.

### Update the regression test (required either way)

`src/app/globals.tokens.test.ts:113–115` asserts the **exact** old string and will fail otherwise:

```js
it('caps the orb at 25vh (--orb-size: min(248px, 25vh))', () => {
  expect(normalizedCss, 'expected --orb-size capped at min(248px, 25vh)').toContain(
    '--orb-size: min(248px, 25vh);',
```

Update it to match the chosen form:
- **Recommended (token):** assert `--orb-scale: 0.85;` **and** `--orb-size: calc(min(248px, 25vh) * var(--orb-scale));`, and reword the test title (e.g. `caps the orb at 21.25vh and applies the −15% --orb-scale`).
- **Alternative (inline):** assert `--orb-size: min(211px, 21.25vh);`.

### Leave everything else untouched

No change to `.voice-dock` (gap/centering/max-width), `.session-controls`, `.composer-foot`, the orb's
gradients/bloom/rings, or any `@keyframes`. The orb stays centered on `.main`'s axis and bottom-docked
per [`conversation-first-cleanup.md`](./conversation-first-cleanup.md) and
[`center-welcome-composition.md`](./center-welcome-composition.md).

---

## Implementation prompt (via /ui-prompt — size-only, Aurora Mist locked)

> In `src/app/globals.css` for the AI News Tutor, **reduce the voice orb's size by exactly 15%** at
> every breakpoint, scaling **both** the px cap and the `25vh` ceiling. **Inherit the existing Aurora
> Mist system verbatim** — every color, font, radius, shadow, `backdrop-filter`, gradient, and
> `@keyframes`. Size only; no palette/type/accent/animation changes, no JSX/TS edits.
>
> Add `--orb-scale: 0.85;` on `.orb` and change `--orb-size` to
> `calc(min(248px, 25vh) * var(--orb-scale))`. Apply the same `* var(--orb-scale)` factor to the two
> overrides: `@media (max-width: 880px)` → `calc(min(200px, 25vh) * var(--orb-scale))`,
> `@media (max-width: 480px)` → `calc(min(168px, 25vh) * var(--orb-scale))`. (Net px: 211 / 170 / 143;
> vh ceiling 21.25.)
>
> **Do not touch** `.voice-dock`, `.session-controls`, `.composer-foot`, `.orb-core/-bloom/-ring`, the
> specular highlight, or any `@keyframes` — the orb's sub-layers are percentage-based and scale on
> their own. Then update the `--orb-size` assertion in `src/app/globals.tokens.test.ts` to the new
> values so the regression test passes.
>
> Verify at 1280/1440/1920px and a short viewport (e.g. 1440×640): the orb is ~15% smaller than before,
> still horizontally centered on `.orb` = `.main`'s axis, still bottom-docked, with visibly more room
> for the welcome text/cards above; idle/listening/thinking/speaking animations still play and stay
> circular.
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

Build effort: **medium** (single-token size change; no layout restructure).

---

## Verification

1. **Automated** — `npx tsc --noEmit` clean; `npx vitest run` green (incl. the updated `--orb-size`
   assertion in `globals.tokens.test.ts`).
2. **Dev server** (`PORT=3838 npm run dev`) — load `http://localhost:3838` in the welcome state; via
   Playwright `browser_resize` + `browser_evaluate`:
   - At **1280 / 1440 / 1920px**: `getComputedStyle(.orb).width` ≈ **0.85 ×** the previous width
     (211px where the 248px cap was active), `width === height`, and the orb is still a circle.
   - `centerX(.orb) === centerX(.main)` (unchanged shared axis); orb still bottom-docked (its bottom
     near the dock, not floating mid-column); visibly more vertical gap for `.welcome` text/cards above.
   - **Short viewport (e.g. 1440×640)** where the vh ceiling binds: orb height ≈ `0.2125 × viewportH`
     (was `0.25 ×`) — confirms the vh term was scaled too, not just the px cap.
   - **880px / 480px**: orb caps are 170px / 143px respectively; dock stays centered; no overflow.
   - Toggle states (idle → listening → thinking → speaking): rings/bloom/shimmer still animate and stay
     centered within the smaller orb.
3. **Build** — run `npm run build` **only after stopping any live `next dev`** (a prod build against a
   running dev server corrupts `.next`). CSS-only + the updated test cover the change otherwise.

---

## Files touched
- `src/app/globals.css` — `--orb-scale: 0.85` on `.orb`; `--orb-size` wrapped in `calc(… * var(--orb-scale))` at `.orb` (`:554`) and the `880px` (`:789`) + `480px` (`:792`) overrides.
- `src/app/globals.tokens.test.ts` — update the `--orb-size` assertion (`:113–115`) to the new value(s) and reword its title.

---

## Out of scope
- No change to `.voice-dock`, session controls, footer, or the welcome/thread layout — only the orb's size.
- No palette/type/accent/shadow/gradient/`@keyframes` changes; no JSX/TS logic edits.
- The bottom-dock orb position, the on-axis centering, and the responsive breakpoint structure all stay as locked in prior specs — they're inherited, just at 85% scale.
