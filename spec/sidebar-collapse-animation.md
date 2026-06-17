# Spec — Knowledge-base sidebar collapse/expand animation

**Project:** AI News Tutor (`Projects/ai-tutor`, Next.js 14 + TS + Tailwind)
**Branch:** TBD (feature branch off `main`)
**Status:** Approved direction, pending implementation
**Date:** 2026-06-17
**Visual system:** Aurora Mist — **locked** (no palette/font/radius/shadow/keyframe changes; this adds one transition + one icon only)

---

## Context

The left knowledge-base sidebar (`src/components/sidebar/Sidebar.tsx`, the `.sidebar`
`<aside>`) is a fixed 320px grid column in `.app`
(`grid-template-columns: 320px 1fr`, `globals.css:99-100`). It is always visible on
desktop and there is no way to collapse it. On a focused reading/voice session the
sidebar competes for horizontal space with the conversation.

We want a single toggle icon in the **top-left corner** that opens/closes the sidebar
with a smooth animation, giving the conversation more room when the user wants it.

## Goals

1. A persistent toggle icon, pinned to the **top-left corner**, that opens and closes
   the knowledge-base sidebar on click.
2. **Push layout:** when closing, the sidebar's grid column animates `320px → 0` and
   `.main` smoothly widens to fill the freed space; opening reverses it.
3. Smooth, declarative animation that respects `prefers-reduced-motion`.
4. Fully keyboard- and screen-reader-accessible.

## Non-goals (YAGNI)

- **No persistence.** State always starts **open** on every load; collapsing is a
  within-session action that resets on reload. No localStorage, no hydration concerns.
- **No mobile change.** Below 880px the sidebar already `display:none`s
  (`globals.css:806-808`); this feature is **desktop-only** (≥880px). The toggle is
  hidden on mobile and the animation does not apply there.
- **No thin-rail / overlay variants.** Push layout only.
- **No new animation library.** Vanilla CSS transition, matching the existing codebase.

## Behavior

| State | Sidebar | `.main` | Toggle |
|---|---|---|---|
| Open (default) | 320px column, content visible | fills remaining `1fr` | top-left, over sidebar header; `aria-expanded=true` |
| Closed | column → 0, content clipped (not reflowed) | widens to fill | top-left, over empty top-left of `.main`; `aria-expanded=false` |

- The toggle is the **same single element** in both states — it stays in the same
  fixed top-left spot; only the surrounding layout moves.
- Transition direction is symmetric: same easing/duration both ways.

## Animation technique

**Animate `grid-template-columns` on `.app`** (single declarative mechanism, reuses the
existing grid):

- `.app` gains `transition: grid-template-columns .28s ease` — placed **inside the
  existing `@media (prefers-reduced-motion: no-preference)` guard** (`globals.css:732`),
  matching the codebase convention. Reduced-motion users get an instant snap, no animation.
- A `.sidebar-collapsed` modifier class on `.app` sets `grid-template-columns: 0 1fr`.
- `.sidebar` gains `overflow: hidden` and `min-width: 0` so the column can shrink to 0.
- Sidebar content sits in a **fixed-width (320px) inner wrapper** (`flex: none`) so it is
  clipped as the column narrows rather than re-wrapping — producing a clean slide-away.

Rejected alternatives:
- `transform: translateX(-100%)` on the sidebar — a transform alone does not reclaim the
  grid track, so `.main` would not widen without *also* animating the column. Two synced
  animations for no gain.
- Animating `width` on a flex sidebar — would require restructuring `.app` off grid; more
  churn than warranted.

## Components & state

- **`src/components/AppShell.tsx`** — add `const [sidebarOpen, setSidebarOpen] = useState(true)`.
  Apply `sidebar-collapsed` to the `.app` wrapper when `!sidebarOpen`. Render
  `<SidebarToggle>` as a sibling of `<Sidebar>`. Pass `open`/`onToggle` down.
- **`src/components/sidebar/SidebarToggle.tsx`** *(new)* — a `<button>` with props
  `{ open: boolean; onToggle: () => void }`. Absolutely positioned top-left, `z-index`
  above the sidebar. Renders the panel icon. One element, both states.
- **`src/components/icons.tsx`** — add a `PanelLeftIcon` (or equivalent), matching the
  existing icon style (currentColor stroke, same viewBox conventions as `RefreshIcon`).
- **`src/components/sidebar/Sidebar.tsx`** — the `<aside>` gets `id="kb-sidebar"`; its
  children (`Brand`, `KbHeader`, `KbList`) are wrapped in the fixed-width inner div. When
  collapsed, the aside gets the **`inert`** attribute (passed via prop) so its controls
  (refresh button, KB cards) are not focusable or read by assistive tech.
- **`Brand`** gets extra left padding so its mark clears the top-left toggle when open.

## Accessibility & reduced motion

- Toggle button: `aria-label` ("Collapse knowledge base" / "Expand knowledge base",
  reflecting state), `aria-expanded={open}`, `aria-controls="kb-sidebar"`, keyboard-focusable,
  visible focus ring consistent with other buttons.
- Collapsed aside uses `inert` — no focus traps, no AT readout of hidden content.
- Transition is gated behind `prefers-reduced-motion: no-preference`; the class/`inert`
  toggles themselves (not animations) still work under reduced motion, so the feature is
  fully functional, just without the slide.

## Testing (vitest + React Testing Library — already in repo)

- **`SidebarToggle`**: renders; `aria-expanded` tracks the `open` prop; clicking fires
  `onToggle`; `aria-label` reflects state.
- **Integration (`AppShell` or a focused harness)**: default state is open (no
  `sidebar-collapsed` class); clicking the toggle adds `sidebar-collapsed` to `.app`, sets
  `aria-expanded=false`, and marks the aside `inert`; clicking again reverses all three.
- Existing `globals.tokens.test.ts` / other suites must stay green.

## Acceptance criteria

1. On desktop, a toggle icon is visible in the top-left corner at all times.
2. Clicking it collapses the sidebar to 0 width with a smooth ~0.28s slide; `.main`
   widens to fill. Clicking again restores it.
3. Sidebar starts open on every load (no persisted state).
4. With `prefers-reduced-motion: reduce`, the toggle snaps open/closed instantly with no
   animation but otherwise behaves identically.
5. When collapsed, no sidebar control is keyboard-reachable; `aria-expanded` and
   `aria-controls` are correct.
6. Below 880px, behavior is unchanged from today (sidebar hidden, toggle hidden).
7. `npm run typecheck`, `npm run test:run`, and `npm run lint` all pass.
