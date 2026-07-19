# Brand-mark Sidebar Toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the top-left sidebar toggle render as the brand mark (gradient squircle + pulsing dot) that morphs squircle⇄circle by state, and remove the now-duplicate mark from the sidebar header.

**Architecture:** The existing `SidebarToggle` button keeps all its props/aria and swaps its `PanelLeftIcon` for the gradient-mark markup (reusing the `.brand-pulse` dot). `Brand` drops its `.brand-mark` so only one mark exists. CSS restyles `.sidebar-toggle` into the gradient mark, drives the open/closed corner-radius off `aria-expanded`, and gates the radius/transform transitions inside the existing reduced-motion guard. No prop, behavior, or collapse-plumbing changes from PR #24.

**Tech Stack:** Next.js 14, React 18.3, TypeScript, Tailwind + plain CSS (`globals.css`), Vitest + React Testing Library. No new dependencies.

## Global Constraints

- **Visual system Aurora Mist is locked** — no palette/font/radius/shadow/**keyframe** token changes. This feature reuses the existing brand gradient, shadow recipe, and `pulse` keyframe, and adds only CSS **transitions** (border-radius + transform).
- **Unify, don't duplicate** — exactly **one** mark on screen; `Brand` no longer renders one.
- **State carried by corner radius only** — open `border-radius: 11px` (squircle), closed `border-radius: 50%` (circle). No chevron/extra glyph.
- **Reduced motion** — radius morph + press/hover transitions live inside the existing `@media (prefers-reduced-motion: no-preference)` guard; toggling still works under reduced motion, just without morph/pulse.
- **Unchanged from PR #24** — collapse behavior, `sidebarOpen` state, `inert` plumbing, the grid slide, mobile hiding (`<880px`), and no persistence.
- **No new npm dependencies. No new keyframes.**
- **Quality gate (must pass at end):** `npm run typecheck`, `npm run test:run`. (`npm run lint` is a pre-existing repo gap — ESLint is not configured — and is out of scope.)

---

### Task 1: Toggle renders the mark; dedup the header mark; drop dead icon

**Files:**
- Modify: `src/components/sidebar/SidebarToggle.tsx`
- Modify: `src/components/sidebar/Brand.tsx`
- Modify: `src/components/icons.tsx` (remove the now-dead `PanelLeftIcon`)
- Test: `src/components/sidebar/SidebarToggle.test.tsx` (extend)
- Test: `src/components/sidebar/Brand.test.tsx` (new)

**Interfaces:**
- Consumes: nothing new. `SidebarToggle` keeps props `{ open: boolean; onToggle: () => void }` and its `aria-label` / `aria-expanded` / `aria-controls="kb-sidebar"` exactly as today.
- Produces: `SidebarToggle` renders `<button class="sidebar-toggle">` containing `<span class="brand-pulse" aria-hidden="true" />` (no `<svg>`). `Brand` renders `.brand-name` + `.brand-sub` only (no `.brand-mark`).

- [ ] **Step 1: Write the failing tests**

Append to `src/components/sidebar/SidebarToggle.test.tsx` inside the existing `describe('SidebarToggle', …)` block:

```tsx
  it('renders the pulsing brand-mark dot, not a panel icon', () => {
    const { container } = render(<SidebarToggle open={false} onToggle={() => {}} />);
    const btn = screen.getByRole('button');
    expect(btn.querySelector('.brand-pulse')).not.toBeNull();
    expect(btn.querySelector('svg')).toBeNull();
  });
```

Create `src/components/sidebar/Brand.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Brand from './Brand';

describe('Brand', () => {
  it('renders the product name', () => {
    render(<Brand />);
    expect(screen.getByText('AI News Tutor')).toBeInTheDocument();
  });

  it('no longer renders a duplicate brand mark (the toggle provides it now)', () => {
    const { container } = render(<Brand />);
    expect(container.querySelector('.brand-mark')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/sidebar/SidebarToggle.test.tsx src/components/sidebar/Brand.test.tsx`
Expected: FAIL — `SidebarToggle` still renders an `<svg>` (PanelLeftIcon) and has no `.brand-pulse`; `Brand` still renders a `.brand-mark`.

- [ ] **Step 3: Update `SidebarToggle.tsx`**

Replace the entire file with (drops the `icons` import, swaps the icon for the pulse dot):

```tsx
// Top-left toggle that collapses/expands the knowledge-base sidebar.
// Rendered by AppShell; absolutely positioned, present in both states.
// Visually it is the brand mark (gradient square + pulsing dot); the corner
// radius morphs square (open) ⇄ circle (closed), driven by aria-expanded in CSS.

interface SidebarToggleProps {
  open: boolean;
  onToggle: () => void;
}

export default function SidebarToggle({ open, onToggle }: SidebarToggleProps) {
  return (
    <button
      type="button"
      className="sidebar-toggle"
      onClick={onToggle}
      aria-label={open ? 'Collapse knowledge base' : 'Expand knowledge base'}
      aria-expanded={open}
      aria-controls="kb-sidebar"
    >
      <span className="brand-pulse" aria-hidden="true" />
    </button>
  );
}
```

- [ ] **Step 4: Update `Brand.tsx`**

Replace the entire file with (removes the `.brand-mark` wrapper + its dot):

```tsx
// Product name and subtitle. The pulsing brand mark now lives in the top-left
// SidebarToggle (which doubles as the collapse control), so it is not repeated here.

export default function Brand() {
  return (
    <div className="brand">
      <div>
        <div className="brand-name">AI News Tutor</div>
        <div className="brand-sub">Claude blog × voice</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Remove the dead `PanelLeftIcon` from `icons.tsx`**

First confirm nothing else imports it:

Run: `grep -rn "PanelLeftIcon" src/`
Expected: only `src/components/icons.tsx` (the definition) — the `SidebarToggle` import was removed in Step 3.

Then delete the `PanelLeftIcon` function from `src/components/icons.tsx` (the block added in PR #24):

```tsx
export function PanelLeftIcon({ size = 16, ...rest }: IconProps & { size?: number }) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}
```

(Leave the preceding `ArrowIcon` and the rest of the file unchanged.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/sidebar/SidebarToggle.test.tsx src/components/sidebar/Brand.test.tsx`
Expected: PASS — SidebarToggle 4 tests, Brand 2 tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/sidebar/SidebarToggle.tsx src/components/sidebar/SidebarToggle.test.tsx src/components/sidebar/Brand.tsx src/components/sidebar/Brand.test.tsx src/components/icons.tsx
git commit -m "feat(sidebar): toggle renders brand mark; dedup header mark; drop PanelLeftIcon"
```

---

### Task 2: Restyle `.sidebar-toggle` into the gradient mark + radius morph

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `SidebarToggle`'s `.sidebar-toggle` button + `aria-expanded` attribute (Task 1) and the reused `.brand-pulse` dot.
- Produces: the gradient mark visual, the open/closed radius morph, press/hover feedback, and header spacing. (Pure CSS — verified by the full suite staying green + typecheck + manual visual check. No unit test: CSS appearance is not unit-testable in jsdom.)

- [ ] **Step 1: Replace the `.sidebar-toggle` rules**

In `src/app/globals.css`, replace the existing block:

```css
.sidebar-toggle {
  position: absolute;
  top: 14px;
  left: 14px;
  z-index: 20;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--muted);
  box-shadow: var(--shadow-sm);
  transition: color .18s, border-color .18s, background .18s;
}
.sidebar-toggle:hover { color: var(--ink); border-color: var(--faint); }
```

with (gradient mark; radius driven by `aria-expanded`; press/hover feedback; the transition moves to the reduced-motion guard in Step 3):

```css
/* Top-left toggle = the brand mark (gradient square + pulsing dot). Present in
   both states; over the header when open, over the empty top-left of .main when
   closed. Corner radius carries the state: squircle (open) ⇄ circle (closed). */
.sidebar-toggle {
  position: absolute;
  top: 20px;
  left: 22px;
  z-index: 20;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: none;
  background: linear-gradient(150deg, var(--accent), var(--accent-2));
  box-shadow: 0 4px 12px color-mix(in oklab, var(--accent) 32%, transparent);
}
.sidebar-toggle[aria-expanded="true"]  { border-radius: 11px; }
.sidebar-toggle[aria-expanded="false"] { border-radius: 50%; }
.sidebar-toggle:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 18px color-mix(in oklab, var(--accent) 40%, transparent);
}
.sidebar-toggle:active { transform: scale(.92); }
```

- [ ] **Step 2: Remove the now-unused `.brand-mark` rule and widen `.brand` padding**

In `src/app/globals.css`, delete the `.brand-mark` block (it is no longer referenced; **keep** `.brand-pulse` and the `pulse` keyframe):

```css
.brand-mark {
  width: 38px; height: 38px; border-radius: 11px;
  background: linear-gradient(150deg, var(--accent), var(--accent-2));
  display: grid; place-items: center; flex: none;
  position: relative; overflow: hidden;
  box-shadow: 0 4px 12px color-mix(in oklab, var(--accent) 32%, transparent);
}
```

Then change the `.brand` padding so the text clears the 38px mark pinned at `left:22px` (22 + 38 + 12 gap = 72). From:

```css
.brand {
  display: flex; align-items: center; gap: 12px;
  padding: 22px 22px 18px 56px;
}
```

to:

```css
.brand {
  display: flex; align-items: center; gap: 12px;
  padding: 22px 22px 18px 72px;
}
```

- [ ] **Step 3: Add the toggle transition inside the reduced-motion guard**

In `src/app/globals.css`, inside the existing `@media (prefers-reduced-motion: no-preference) { … }` block, next to the `.app { transition: grid-template-columns .28s ease; }` line added in PR #24, add:

```css
  /* Mark morph (squircle ⇄ circle) + press/hover — gated so reduced-motion
     users get an instant snap. */
  .sidebar-toggle {
    transition: border-radius .28s ease, transform .12s ease, box-shadow .18s ease;
  }
```

- [ ] **Step 4: Run the full suite + typecheck to confirm nothing regressed**

Run: `npm run test:run`
Expected: PASS — all suites green (including `globals.tokens.test.ts` and the Task 1 tests).

Run: `npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 5: Manual verification (the mark + morph are visual — confirm in the running app)**

> Note: per workspace rule, do **not** run `next build` while `next dev` is live (shared `.next`). Use dev only.

Start dev (`npm run dev`) and at ≥880px width:
1. The top-left mark is the gradient squircle with the pulsing white dot — and there is **no** second mark in the sidebar header. Sidebar starts **closed**, so the mark is a **circle** on load.
2. Click → sidebar slides open and the mark morphs **circle → squircle** (~0.28s) in sync; the brand text ("AI News Tutor") sits cleanly to its right, not overlapping. Click again → reverses.
3. Hover lifts the mark slightly; pressing it scales it down briefly.
4. With OS "Reduce motion" on, the mark snaps between circle/squircle with no transition and the dot does not pulse, but toggling still works.
5. Below 880px the mark/toggle disappears; layout unchanged.
6. If the mark and brand text are not vertically aligned when open, nudge `.sidebar-toggle` `top` (±2px) to match; re-confirm.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(sidebar): gradient brand-mark toggle styling + squircle/circle radius morph"
```

---

## Self-Review

**Spec coverage:**
- Toggle renders as the brand mark (gradient + pulse) → Task 1 (Step 3) + Task 2 (Step 1). ✓
- Unify / no duplicate mark → Task 1 (Step 4, Brand dedup) + Task 2 (Step 2, remove `.brand-mark`); locked by `Brand.test.tsx`. ✓
- Radius morph squircle⇄circle via `aria-expanded` → Task 2 (Step 1). ✓
- Press + hover feedback → Task 2 (Step 1). ✓
- Reuse `.brand-pulse` / no new keyframes → Task 1 (Step 3) keeps `.brand-pulse`; Task 2 keeps the rule + keyframe. ✓
- Reduced-motion gating → Task 2 (Step 3, inside the guard). ✓
- Accessibility (aria-label/expanded/controls, hidden dot, focus) → unchanged from PR #24, preserved in Task 1 (Step 3). ✓
- Header spacing (text clears the mark) → Task 2 (Step 2, `.brand` padding 72px) + manual Step 5.2. ✓
- Drop dead `PanelLeftIcon` → Task 1 (Step 5). ✓
- Mobile hide / collapse plumbing unchanged → no task touches them (Global Constraints). ✓
- Quality gate typecheck/test → Task 2 (Step 4). ✓

**Placeholder scan:** No TBD/TODO; every code step shows the full before/after code. ✓

**Type consistency:** `SidebarToggle` props `{ open, onToggle }` and all aria attrs are byte-identical to PR #24; `.brand-pulse` class name matches between `SidebarToggle.tsx` (Task 1) and the retained CSS (Task 2); `.sidebar-toggle` + `aria-expanded` selectors (Task 2) match the rendered button (Task 1). ✓
