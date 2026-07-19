# KB Sidebar Collapse/Expand Animation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single top-left toggle that collapses/expands the knowledge-base sidebar with a smooth push animation, defaulting to closed.

**Architecture:** A `sidebarOpen` boolean lives in `AppShell`. When closed, `.app` gets a `sidebar-collapsed` class that animates the grid's first column `320px → 0` (CSS transition, reduced-motion gated); `.main` reclaims the space. A standalone `SidebarToggle` button is rendered by `AppShell`, absolutely positioned top-left, present in both states. The `Sidebar` aside is marked `inert` when collapsed so its controls leave the tab order.

**Tech Stack:** Next.js 14, React 18.3, TypeScript, Tailwind + plain CSS (`globals.css`), Vitest + React Testing Library. No new dependencies.

## Global Constraints

- **Visual system Aurora Mist is locked** — no palette/font/radius/shadow/**keyframe** changes. This feature adds CSS **transitions** only (no `@keyframes`), reuses existing tokens, and adds one icon.
- **Animation gated behind `prefers-reduced-motion: no-preference`** — the transition lives inside the existing guard at `globals.css:732`; toggling still works under reduced motion, just without the slide.
- **Desktop-only (≥880px).** Below 880px the sidebar already `display:none`s (`globals.css:806-808`); the toggle is hidden there and the animation does not apply.
- **No persistence.** State starts **closed** on every load; `useState(false)`. No localStorage.
- **No new npm dependencies.**
- **`inert` is set imperatively** (`setAttribute('inert','')`) — React 18.3 / `@types/react` 18.3.31 do not pass the `inert` JSX attribute through.
- **Quality gate (all must pass at the end):** `npm run typecheck`, `npm run test:run`, `npm run lint`.

---

### Task 1: `SidebarToggle` button + `PanelLeftIcon`

**Files:**
- Modify: `src/components/icons.tsx` (add `PanelLeftIcon`, end of file before EOF)
- Create: `src/components/sidebar/SidebarToggle.tsx`
- Test: `src/components/sidebar/SidebarToggle.test.tsx`

**Interfaces:**
- Consumes: the `base(size)` icon helper already exported-by-use in `src/components/icons.tsx`.
- Produces: `SidebarToggle` (default export) with props `{ open: boolean; onToggle: () => void }`. Renders a `<button class="sidebar-toggle">` whose `aria-label` is `"Collapse knowledge base"` when `open`, else `"Expand knowledge base"`; `aria-expanded={open}`; `aria-controls="kb-sidebar"` (the id added in Task 2).

- [ ] **Step 1: Write the failing test**

Create `src/components/sidebar/SidebarToggle.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SidebarToggle from './SidebarToggle';

describe('SidebarToggle', () => {
  it('labels itself "Expand" and sets aria-expanded=false when closed', () => {
    render(<SidebarToggle open={false} onToggle={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Expand knowledge base' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn).toHaveAttribute('aria-controls', 'kb-sidebar');
  });

  it('labels itself "Collapse" and sets aria-expanded=true when open', () => {
    render(<SidebarToggle open={true} onToggle={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Collapse knowledge base' });
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('calls onToggle when clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<SidebarToggle open={false} onToggle={onToggle} />);
    await user.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/sidebar/SidebarToggle.test.tsx`
Expected: FAIL — `Failed to resolve import "./SidebarToggle"` (file does not exist yet).

- [ ] **Step 3: Add `PanelLeftIcon` to `src/components/icons.tsx`**

Append after the `ArrowIcon` function (after line 101), before EOF:

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

- [ ] **Step 4: Create `src/components/sidebar/SidebarToggle.tsx`**

```tsx
// Top-left toggle that collapses/expands the knowledge-base sidebar.
// Rendered by AppShell; absolutely positioned, present in both states.

import { PanelLeftIcon } from '../icons';

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
      <PanelLeftIcon />
    </button>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/components/sidebar/SidebarToggle.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/icons.tsx src/components/sidebar/SidebarToggle.tsx src/components/sidebar/SidebarToggle.test.tsx
git commit -m "feat(sidebar): SidebarToggle button + PanelLeftIcon"
```

---

### Task 2: `Sidebar` collapse plumbing (`collapsed` prop, id, inner wrapper, `inert`)

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`
- Test: `src/components/sidebar/Sidebar.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Sidebar` now also accepts `collapsed: boolean`. The `<aside>` gets `id="kb-sidebar"`, `aria-hidden={collapsed}`, and (imperatively, via ref+effect) the `inert` attribute when `collapsed` is true. Its existing children move inside a `<div className="sidebar-inner">` wrapper. The new prop is **required**, so Task 3 must pass it.

- [ ] **Step 1: Write the failing test**

Create `src/components/sidebar/Sidebar.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Sidebar from './Sidebar';

const noop = () => {};

function renderSidebar(collapsed: boolean) {
  return render(
    <Sidebar
      articles={[]}
      articlesLoading={false}
      activeUrl={null}
      collapsed={collapsed}
      onRefresh={noop}
      onOpenArticle={noop}
    />,
  );
}

describe('Sidebar collapse state', () => {
  it('is inert and aria-hidden when collapsed', () => {
    const { container } = renderSidebar(true);
    const aside = container.querySelector('#kb-sidebar') as HTMLElement;
    expect(aside).not.toBeNull();
    expect(aside.hasAttribute('inert')).toBe(true);
    expect(aside.getAttribute('aria-hidden')).toBe('true');
  });

  it('is interactive (no inert) and not aria-hidden when open', () => {
    const { container } = renderSidebar(false);
    const aside = container.querySelector('#kb-sidebar') as HTMLElement;
    expect(aside.hasAttribute('inert')).toBe(false);
    expect(aside.getAttribute('aria-hidden')).toBe('false');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/sidebar/Sidebar.test.tsx`
Expected: FAIL — `collapsed` is not a valid prop / `#kb-sidebar` not found (current `Sidebar` has neither).

- [ ] **Step 3: Rewrite `src/components/sidebar/Sidebar.tsx`**

Replace the entire file with:

```tsx
// Left column: brand, KB header, and the article list. Collapsible via the
// top-left SidebarToggle; when collapsed the aside is `inert` (out of tab order).

import { useEffect, useRef } from 'react';
import type { Article } from '@/lib/types';
import Brand from './Brand';
import KbHeader from './KbHeader';
import KbList from './KbList';

interface SidebarProps {
  articles: Article[];
  articlesLoading: boolean;
  activeUrl: string | null;
  collapsed: boolean;
  onRefresh: () => void;
  onOpenArticle: (article: Article, trigger: HTMLButtonElement | null) => void;
}

export default function Sidebar({
  articles,
  articlesLoading,
  activeUrl,
  collapsed,
  onRefresh,
  onOpenArticle,
}: SidebarProps) {
  const asideRef = useRef<HTMLElement>(null);

  // `inert` removes the collapsed sidebar from the tab order and the
  // accessibility tree. Set imperatively because React 18 / @types/react 18
  // do not pass the `inert` JSX attribute through.
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    if (collapsed) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [collapsed]);

  return (
    <aside ref={asideRef} id="kb-sidebar" className="sidebar" aria-hidden={collapsed}>
      <div className="sidebar-inner">
        <Brand />
        <KbHeader count={articles.length} loading={articlesLoading} onRefresh={onRefresh} />
        <KbList
          articles={articles}
          loading={articlesLoading}
          activeUrl={activeUrl}
          onOpen={onOpenArticle}
        />
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/sidebar/Sidebar.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx src/components/sidebar/Sidebar.test.tsx
git commit -m "feat(sidebar): Sidebar collapsed prop, kb-sidebar id, inert handling"
```

---

### Task 3: Wire up `AppShell`, add the CSS animation, integration test

**Files:**
- Modify: `src/components/AppShell.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/AppShell.test.tsx`

**Interfaces:**
- Consumes: `SidebarToggle` (Task 1) and `Sidebar`'s new `collapsed` prop + `#kb-sidebar` id (Task 2).
- Produces: the `.app` element gains/loses the `sidebar-collapsed` class as the sidebar closes/opens.

- [ ] **Step 1: Write the failing integration test**

Create `src/components/AppShell.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppShell from './AppShell';

beforeEach(() => {
  // AppShell fetches /api/scrape on mount; stub it so the tree mounts cleanly.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ articles: [] }) }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppShell — sidebar toggle wiring', () => {
  it('starts collapsed and toggles the .app class open/closed', async () => {
    const user = userEvent.setup();
    const { container } = render(<AppShell />);
    const app = container.querySelector('.app') as HTMLElement;

    // Default closed.
    expect(app.classList.contains('sidebar-collapsed')).toBe(true);

    // Open.
    await user.click(screen.getByRole('button', { name: 'Expand knowledge base' }));
    expect(app.classList.contains('sidebar-collapsed')).toBe(false);

    // Close again.
    await user.click(screen.getByRole('button', { name: 'Collapse knowledge base' }));
    expect(app.classList.contains('sidebar-collapsed')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/AppShell.test.tsx`
Expected: FAIL — no button named "Expand knowledge base" (toggle not rendered yet); `sidebar-collapsed` class absent.

- [ ] **Step 3: Wire `AppShell.tsx` — import, state, class, render toggle, pass `collapsed`**

In `src/components/AppShell.tsx`:

3a. Add the import next to the other sidebar/main imports (after line 7, `import Sidebar from './sidebar/Sidebar';`):

```tsx
import SidebarToggle from './sidebar/SidebarToggle';
```

3b. Add state alongside the other `useState` calls (immediately after line 56, `const [inputMode, setInputMode] = useState<'voice' | 'text'>('voice');`):

```tsx
  // KB sidebar collapse. Starts closed every load (no persistence).
  const [sidebarOpen, setSidebarOpen] = useState(false);
```

3c. Change the `.app` wrapper opening tag (line 269) from:

```tsx
    <div className={`app${densityClass}`}>
```

to:

```tsx
    <div className={`app${densityClass}${sidebarOpen ? '' : ' sidebar-collapsed'}`}>
      <SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />
```

3d. Add the `collapsed` prop to the `<Sidebar ... />` element (the existing block at lines 270-276) so it reads:

```tsx
      <Sidebar
        articles={articles}
        articlesLoading={articlesLoading}
        activeUrl={drawerOpen ? activeArticle?.url ?? null : null}
        collapsed={!sidebarOpen}
        onRefresh={loadArticles}
        onOpenArticle={openArticle}
      />
```

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `npx vitest run src/components/AppShell.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Add the CSS — layout, animation, toggle button**

In `src/app/globals.css`, make these edits:

5a. Add `position: relative;` to `.app` (it is the positioning context for the absolute toggle). Change the `.app` block (line 89-102) so the rule includes:

```css
.app {
  height: 100%;
  position: relative;
```

(Leave the rest of the `.app` declarations unchanged.)

5b. Immediately after the `.app { ... }` block (after line 102), add the collapsed modifier:

```css
/* Collapsed: first grid track shrinks to 0; .main reclaims the width.
   Animated via the transition inside the reduced-motion guard below. */
.app.sidebar-collapsed { grid-template-columns: 0 1fr; }
```

5c. Add `overflow: hidden;` and `min-width: 0;` to `.sidebar` (block at line 105-114) so the 0-width track clips its content cleanly:

```css
.sidebar {
  border-right: 1px solid var(--line);
  /* frosted glass — translucent white over the aurora */
  background: var(--glass);
  -webkit-backdrop-filter: blur(18px) saturate(125%);
  backdrop-filter: blur(18px) saturate(125%);
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

/* Fixed-width inner column so content is clipped (not re-wrapped) as the
   sidebar collapses, producing a clean slide-away. */
.sidebar-inner {
  width: 320px;
  flex: none;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* Top-left toggle — present in both states; over the header when open, over
   the empty top-left of .main when closed. */
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

5d. Give `.brand` extra left padding so its mark clears the toggle when open. Change line 117 from:

```css
  padding: 22px 22px 18px;
```

to:

```css
  padding: 22px 22px 18px 56px;
```

5e. Add the grid transition **inside** the existing `@media (prefers-reduced-motion: no-preference)` block (after line 736, alongside the other gated animations):

```css
  /* Sidebar collapse/expand slide — gated so reduced-motion users get an
     instant snap. First load paints the resolved width directly (no prior
     value), so a default-closed sidebar does not animate in. */
  .app { transition: grid-template-columns .28s ease; }
```

5f. Hide the toggle on mobile. In the `@media (max-width: 880px)` block (line 806-816), add:

```css
  .sidebar-toggle { display: none; }
```

- [ ] **Step 6: Run the full test suite + quality gate**

Run: `npm run test:run`
Expected: PASS — all suites green, including `globals.tokens.test.ts` and the new toggle/sidebar/appshell tests.

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Manual verification (the animation is visual — confirm in the running app)**

> Note: per workspace rule, do **not** run `next build` while `next dev` is live (shared `.next`). Use dev only.

Start dev (`npm run dev`) and at ≥880px width:
1. Sidebar starts **closed**; the toggle is visible top-left over the conversation. No slide-in flash on load.
2. Click the toggle → sidebar slides open (~0.28s), `.main` narrows to match; click again → slides closed, `.main` widens.
3. With OS "Reduce motion" on, the toggle snaps instantly with no slide but otherwise behaves identically.
4. When closed, Tab does not land on any sidebar control (refresh / KB cards).
5. Narrow the window below 880px → toggle disappears and layout is unchanged from today.

- [ ] **Step 8: Commit**

```bash
git add src/components/AppShell.tsx src/components/AppShell.test.tsx src/app/globals.css
git commit -m "feat(sidebar): wire collapse toggle in AppShell + animated grid CSS"
```

---

## Self-Review

**Spec coverage:**
- Toggle in top-left, opens/closes → Task 1 (button) + Task 3 (wiring, positioning CSS). ✓
- Push layout, grid `320px→0`, `.main` reclaims → Task 3 (5a-5c, 5e). ✓
- Default closed, no persistence → Task 3 (3b `useState(false)`) + AppShell test. ✓
- Desktop-only, hidden <880px → Task 3 (5f). ✓
- Reduced-motion gating → Task 3 (5e, inside the guard). ✓
- `inert` + `aria-hidden` + `aria-expanded` + `aria-controls` → Task 1 (button aria) + Task 2 (aside). ✓
- No-flash on first load → Task 3 (5e note) + manual step 7.1. ✓
- Tests: SidebarToggle (Task 1), Sidebar collapse (Task 2), AppShell integration (Task 3). ✓
- Quality gate typecheck/test/lint → Task 3 step 6. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `collapsed: boolean` prop defined in Task 2 and passed as `collapsed={!sidebarOpen}` in Task 3; `SidebarToggle` props `{ open, onToggle }` defined in Task 1 and used in Task 3; `aria-controls="kb-sidebar"` (Task 1) matches `id="kb-sidebar"` (Task 2). ✓
