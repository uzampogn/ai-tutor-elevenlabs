# Spec — Brand-mark sidebar toggle (gradient mark + pulse)

**Project:** AI News Tutor (`Projects/ai-tutor`, Next.js 14 + TS + Tailwind)
**Branch:** TBD (builds on `feat/sidebar-collapse-animation`, PR #24)
**Status:** Approved direction, pending implementation
**Date:** 2026-06-17
**Visual system:** Aurora Mist — **locked**. This upgrade reuses the existing brand
gradient, shadow recipe, and `pulse` keyframe; it adds only CSS **transitions**
(border-radius + transform) and changes no palette/font/radius/shadow **tokens** and
adds no keyframes.

---

## Context

The KB sidebar collapse feature (`spec/sidebar-collapse-animation/`, PR #24) added a
single top-left toggle rendered as a plain bordered `PanelLeftIcon` button
(`SidebarToggle.tsx` + `.sidebar-toggle` in `globals.css`). Separately, the sidebar
header has the product **brand mark** — a 38px gradient squircle
(`linear-gradient(150deg, var(--accent), var(--accent-2))`) holding a white
`.brand-pulse` dot that pulses via the `pulse` keyframe (`Brand.tsx`,
`globals.css:157-173`). The pulse animation is already gated inside the
`@media (prefers-reduced-motion: no-preference)` block (`globals.css:776`).

We want the toggle to **be** the brand mark: one gradient-mark-with-pulse element that
doubles as the collapse/expand control, instead of a separate plain icon button sitting
next to the mark.

## Goals

1. The top-left toggle is rendered as the **brand mark** (gradient square + pulsing dot),
   reusing the existing visual.
2. **Unify, don't duplicate:** there is only ever **one** mark on screen. The mark in the
   sidebar header is removed; the toggle provides it.
3. The mark signals open vs. closed by **morphing its corner radius** (squircle when open,
   circle when closed) plus a gentle press on click.
4. Fully keyboard- and screen-reader-accessible; respects `prefers-reduced-motion`.

## Non-goals (YAGNI)

- **No shared `<BrandMark>` component.** After dedup the toggle is the only consumer; a
  shared component adds structure for one caller. Inline the markup in `SidebarToggle`.
- **No directional chevron / extra glyph.** State is carried by the radius morph alone.
- **No change to collapse behavior, persistence, mobile rules, or the grid animation** —
  all of that is unchanged from PR #24. Below 880px the toggle stays hidden.
- **No new animation library and no new npm dependencies.**
- **No new keyframes.** Reuse the existing `pulse`.

## Behavior

| State | Mark shape | Pulse | aria |
|---|---|---|---|
| Open (sidebar visible) | squircle, `border-radius: 11px` (identical to today's brand mark) | pulsing | `aria-expanded=true`, label "Collapse knowledge base" |
| Closed (default) | circle, `border-radius: 50%` | pulsing | `aria-expanded=false`, label "Expand knowledge base" |

- The toggle is the **same single element** in both states, in the **same fixed top-left
  spot** (the position the brand mark occupied in the open header). When open it reads as
  the logo beside the brand text; when closed it floats over the top-left of `.main`.
- Click gives a brief press (`scale(.92)`); hover gives a gentle lift — both signal the
  mark is an interactive control.
- The radius morph is symmetric (same easing/duration both ways).

## Components & files

- **`src/components/sidebar/SidebarToggle.tsx`** — render
  `<button class="sidebar-toggle" …><span class="brand-pulse" aria-hidden="true" /></button>`
  instead of `<PanelLeftIcon />`. **No prop or aria changes**: keeps
  `{ open, onToggle }`, `aria-label` (Collapse/Expand), `aria-expanded={open}`,
  `aria-controls="kb-sidebar"`. State styling keys off `aria-expanded` (no extra class).
- **`src/components/sidebar/Brand.tsx`** — remove the `.brand-mark` wrapper and its
  `.brand-pulse` child; keep `.brand-name` + `.brand-sub` only.
- **`src/components/icons.tsx`** — remove the now-dead `PanelLeftIcon`.
- **`src/app/globals.css`**:
  - Restyle `.sidebar-toggle`: 38px; `background: linear-gradient(150deg, var(--accent),
    var(--accent-2))`; the brand-mark `box-shadow`; `display:grid; place-items:center`;
    pinned `top:20px; left:22px` (the brand-mark spot). Remove the old bordered/panel
    styling (border, white background, muted color).
  - State via attribute selector: `.sidebar-toggle[aria-expanded="true"] { border-radius:
    11px; }` and `.sidebar-toggle[aria-expanded="false"] { border-radius: 50%; }`.
  - `.sidebar-toggle:active { transform: scale(.92); }`;
    `.sidebar-toggle:hover { transform: translateY(-1px); box-shadow: 0 8px 18px
    color-mix(in oklab, var(--accent) 40%, transparent); }` (a stronger version of the
    brand-mark's own `0 4px 12px … 32%` shadow, same blue-tinted family).
  - Remove the now-unused `.brand-mark` rule. **Keep `.brand-pulse`** (reused by the dot).
  - Change `.brand` left padding from `56px` to ~`72px` so the text clears the 38px mark
    pinned at `left:22px`.
  - Move the radius/transform transition **inside** the existing
    `@media (prefers-reduced-motion: no-preference)` guard:
    `.sidebar-toggle { transition: border-radius .28s ease, transform .12s ease, box-shadow .18s ease; }`.

## Accessibility & reduced motion

- The button keeps `aria-label`, `aria-expanded`, `aria-controls="kb-sidebar"`; the pulse
  dot is `aria-hidden`. Visible focus ring consistent with other buttons.
- Radius morph + press/hover transforms live inside the reduced-motion guard; the pulse is
  already gated there. Reduced-motion users get an instant radius snap and no pulse — the
  control is fully functional, just without motion.

## Testing (vitest + RTL)

- **`SidebarToggle.test.tsx`** (existing) stays green: tests query by role/name and assert
  `aria-label` / `aria-expanded` / `aria-controls` — all unchanged. Add one assertion that
  the pulse dot (`.brand-pulse`) renders inside the button.
- **`Brand.test.tsx`** *(new, small)* — assert `Brand` no longer renders a `.brand-mark`
  (locks the dedup) and still renders the brand name text.
- **`Sidebar.test.tsx`** / **`AppShell.test.tsx`** (existing) unaffected — collapse
  plumbing and wiring are unchanged.
- `globals.tokens.test.ts` and all other suites stay green (verified: no suite asserts
  `.brand-mark` / `.brand-pulse` / `.sidebar-toggle`).

## Acceptance criteria

1. The top-left toggle renders as the gradient brand mark with the pulsing dot; no second
   mark appears in the sidebar header.
2. Toggling collapses/expands the sidebar exactly as before; the mark morphs squircle ⇄
   circle in sync, with a press on click and a lift on hover.
3. With `prefers-reduced-motion: reduce`, the mark snaps between shapes with no transition
   and no pulse, but behaves identically.
4. `aria-label`, `aria-expanded`, and `aria-controls` remain correct; the mark is keyboard-
   focusable with a visible focus ring; the dot is not announced.
5. Below 880px the toggle stays hidden and layout is unchanged.
6. `npm run typecheck` and `npm run test:run` pass. (`npm run lint` remains a pre-existing
   repo gap — ESLint is not configured — and is out of scope.)
