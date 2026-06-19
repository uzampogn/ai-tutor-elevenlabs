# Mobile Responsive Design — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Spec:** `spec/mobile-responsive-design/spec.md`. Execute in a git worktree created via `superpowers:using-git-worktrees` (this repo shares one working tree across many branches — isolation is mandatory).

**Goal:** Make the full web feature set usable on mobile (`≤ 880px`) — the clipped chat dock *and* the absent Knowledge Base / Article reader — while keeping the desktop UI (`> 880px`) byte-for-byte identical.

**Architecture:** Reuse the existing `sidebarOpen` state; only the *CSS presentation* of "open" changes by breakpoint (desktop = grid column; mobile = `position:fixed` slide-in overlay + scrim). All new CSS lives inside `@media (max-width: 880px)` blocks; the one new DOM node (a scrim) renders only when `useIsMobile()` is true; new JS effects are gated on `isMobile`. Desktop CSS, DOM, and JS behavior are therefore provably unchanged, and a three-layer test harness enforces it.

**Tech Stack:** Next.js 14, React 18.3, TypeScript, Tailwind + plain CSS (`globals.css`), Vitest + React Testing Library. Playwright **via MCP** (already used in this repo, see `.playwright-mcp/`) for the empirical desktop pixel check. **No new npm dependencies.**

## Global Constraints

- **Desktop (`> 880px`) renders byte-identically** — no CSS rule, DOM node, or JS effect changes above 880px. Enforced by Tasks 2, 4, 8.
- **Aurora Mist visual system is locked** — no palette / font / radius / shadow / **keyframe** changes. Reuse existing tokens. (`globals.tokens.test.ts` stays green.)
- **All new CSS inside `@media (max-width: 880px)`** (or the existing `480px` block). Reduced-motion-gated mobile transitions use the **combined** query `@media (max-width: 880px) and (prefers-reduced-motion: no-preference)` — never the global `prefers-reduced-motion` guard — so they remain mobile-scoped and excluded from the desktop baseline.
- **Motion gated** behind `prefers-reduced-motion: no-preference` (via the combined query above).
- **No persistence** — mobile sidebar starts closed each load (`useState(false)`, unchanged).
- **`inert` set imperatively** — already handled in `Sidebar.tsx:32-37` when `collapsed`.
- **No new npm dependencies** — swipe uses native pointer events; pixel check uses the Playwright MCP.
- **Quality gate (all must pass before close):** `npm run typecheck`, `npm run test:run`, `npm run lint`, plus the desktop pixel check (Task 8 / Task 11).

---

## Testing strategy — how we prove "the web isn't messed up"

Three independent layers, strongest first. The first two are committed, automated, and run in CI; the third is an empirical confirmation at the review gate.

1. **Static CSS guard (Task 2) — the workhorse.** Reads `globals.css`, strips every `@media (...max-width...)` block, and asserts the remaining (desktop-scope) CSS is identical to a committed baseline captured *before* any change. Because desktop rendering is fully determined by desktop-scope CSS, if this string never changes, desktop CSS cannot regress. Any accidental edit outside a `max-width` query fails the build loudly.
2. **DOM identity (Task 4).** A component test asserting the scrim node is **absent** on desktop (`useIsMobile() === false`) and present only on mobile. Plus existing `AppShell.test` proving desktop toggle behavior is unchanged. Desktop DOM tree stays identical.
3. **Empirical pixel check (Tasks 1, 8, 11).** Playwright-MCP screenshots of all seven visual features at **1440px** and **1024px**, captured on `main` (baseline, Task 1) and again after the change (Task 8), reviewed side-by-side for a zero visual delta. This catches anything the static proof can't see (e.g., a shared component's JS path).

Logical guarantee: desktop CSS unchanged (1) + desktop DOM unchanged (2) + desktop JS is `matchMedia`-gated to a no-op ⇒ desktop rendering is unchanged; (3) confirms it empirically.

---

## File structure

| File | Responsibility |
|---|---|
| `src/app/globals.css` | All mobile CSS — rewrite of the `@media (max-width: 880px)` block + `480px` additions. **No edits outside `max-width` queries.** |
| `src/app/globals.desktop-baseline.css` *(new, committed)* | Frozen snapshot of desktop-scope CSS; the guard's source of truth. |
| `src/app/globals.desktop-guard.test.ts` *(new)* | Strips `max-width` media blocks; asserts desktop-scope CSS == baseline. |
| `src/app/globals.mobile.test.ts` *(new)* | Asserts the mobile block contains the required rules (dvh, safe-area, overlay, scrim, tap-targets) and no longer hides the sidebar. |
| `src/components/main/useIsMobile.ts` *(new)* | `matchMedia('(max-width: 880px)')` hook; SSR-safe default `false`. |
| `src/components/main/useIsMobile.test.tsx` *(new)* | Hook unit tests (mocked `matchMedia`). |
| `src/components/AppShell.tsx` | Render scrim (mobile-only); `isMobile`-gated scroll-lock, Escape-close, and (Phase 2) swipe. |
| `src/components/AppShell.mobile.test.tsx` *(new)* | Scrim presence by breakpoint; scrim-click + Escape close. |
| `src/components/ArticleDrawer.tsx` | (Phase 2) swipe-right-to-close + safe-area handler. |
| `spec/mobile-responsive-design/desktop-equivalence.md` *(new, committed)* | The capture/compare procedure for the pixel check (states + steps). |

---

# PHASE 1 — fit + parity (the shippable milestone)

### Task 1: Desktop baseline capture procedure + baseline screenshots

Establishes the empirical "before" so Task 8 can confirm zero visual delta. No app code changes.

**Files:**
- Create: `spec/mobile-responsive-design/desktop-equivalence.md`

- [ ] **Step 1: Write the procedure doc**

Create `spec/mobile-responsive-design/desktop-equivalence.md` with exactly this content:

```markdown
# Desktop Equivalence — capture & compare procedure

Run via the Playwright MCP. Compare BEFORE (on `main`) vs AFTER (feature branch).
Viewports: **1440×900** and **1024×768** (both > 880px). Theme/data must match
between runs (same seeded articles), so capture both runs back-to-back.

## Setup
1. `npm run dev` (note the port; default 3000).
2. Playwright MCP: `browser_resize` to the viewport, then `browser_navigate` to the app.

## The seven feature states (screenshot each, at each viewport)
1. **welcome** — fresh load, no messages. File: `welcome.png`.
2. **kb-expanded** — click "Expand knowledge base"; wait for KB cards. `kb-expanded.png`.
3. **kb-collapsed** — click "Collapse knowledge base"; toggle shows circle morph. `kb-collapsed.png`.
4. **answer** — type "What is Claude?" → send; wait for the streamed answer with Business
   Impact card + source chips + message actions. `answer.png`.
5. **voice-dock** — ensure Voice mode; capture the docked orb (idle). `voice-dock.png`.
6. **text-composer** — switch to Text mode; capture composer + quick-row. `text-composer.png`.
7. **article-drawer** — expand KB, click an article; wait for hero + score card. `article-drawer.png`.

Filenames: `desktop/<viewport>/<state>.(before|after).png`.

## Compare
For each file, view BEFORE and AFTER side-by-side via the MCP. PASS = no visible
difference. Any delta is a regression — stop and fix before closing the phase.
```

- [ ] **Step 2: Capture the BEFORE screenshots on `main`**

With the worktree on the unchanged base commit, run `npm run dev` and use the Playwright MCP to capture all 7 states at 1440×900 and 1024×768 per the doc. Save under a scratch dir (e.g. `/tmp/desktop-equiv/<viewport>/<state>.before.png`) — these are transient, not committed.

- [ ] **Step 3: Commit the procedure doc**

```bash
git add spec/mobile-responsive-design/desktop-equivalence.md
git commit -m "docs(mobile): desktop-equivalence capture procedure + baseline"
```

---

### Task 2: Desktop CSS guard + frozen baseline

The automated proof that desktop-scope CSS never changes. **Must land before any CSS edit.**

**Files:**
- Create: `src/app/globals.desktop-guard.test.ts`
- Create: `src/app/globals.desktop-baseline.css` (generated)

**Interfaces:**
- Produces: `stripMaxWidthMedia(css: string): string` (exported from the test file) — removes every brace-balanced `@media` block whose condition contains `max-width`, leaving all other CSS (including the global `prefers-reduced-motion` block) intact.

- [ ] **Step 1: Write the failing test**

Create `src/app/globals.desktop-guard.test.ts`:

```ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const cssPath = resolve(process.cwd(), 'src/app/globals.css');
const baselinePath = resolve(process.cwd(), 'src/app/globals.desktop-baseline.css');

/**
 * Remove every brace-balanced `@media (...max-width...) { ... }` block.
 * Keeps all other CSS, including the global `@media (prefers-reduced-motion:
 * no-preference)` block (desktop-relevant) — only mobile-scoped media queries
 * are stripped. Mobile reduced-motion transitions therefore MUST use the
 * combined `@media (max-width: 880px) and (prefers-reduced-motion: …)` query.
 */
export function stripMaxWidthMedia(css: string): string {
  let out = '';
  for (let i = 0; i < css.length; ) {
    if (css.startsWith('@media', i)) {
      const open = css.indexOf('{', i);
      const cond = open === -1 ? '' : css.slice(i, open);
      if (open !== -1 && cond.includes('max-width')) {
        let depth = 0;
        let j = open;
        for (; j < css.length; j++) {
          if (css[j] === '{') depth++;
          else if (css[j] === '}' && --depth === 0) { j++; break; }
        }
        i = j;
        continue;
      }
    }
    out += css[i++];
  }
  return out;
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('stripMaxWidthMedia', () => {
  it('removes max-width blocks but keeps reduced-motion blocks', () => {
    const css = `
      .a { color: red; }
      @media (max-width: 880px) { .a { color: blue; } }
      @media (prefers-reduced-motion: no-preference) { .a { transition: 1s; } }
    `;
    const out = stripMaxWidthMedia(css);
    expect(out).toContain('.a { color: red; }');
    expect(out).toContain('prefers-reduced-motion');
    expect(out).not.toContain('color: blue');
  });

  it('strips a combined max-width + reduced-motion query', () => {
    const css = `@media (max-width: 880px) and (prefers-reduced-motion: no-preference) { .x { transition: 1s; } }`;
    expect(stripMaxWidthMedia(css)).not.toContain('.x');
  });
});

describe('Desktop CSS is byte-stable (no edits outside max-width media queries)', () => {
  const desktopScope = stripMaxWidthMedia(readFileSync(cssPath, 'utf8'));

  // First run (or explicit refresh) freezes the current desktop-scope CSS.
  if (process.env.UPDATE_DESKTOP_BASELINE || !existsSync(baselinePath)) {
    writeFileSync(baselinePath, desktopScope, 'utf8');
  }

  it('matches the committed desktop baseline', () => {
    const baseline = readFileSync(baselinePath, 'utf8');
    expect(normalize(desktopScope)).toBe(normalize(baseline));
  });
});
```

- [ ] **Step 2: Generate the baseline from the current (unchanged) CSS**

Run: `npx vitest run src/app/globals.desktop-guard.test.ts`
Expected: PASS — the `!existsSync` branch writes `globals.desktop-baseline.css`, then the assertion compares equal. Confirm the baseline file now exists and contains the `:root` tokens and `.app` rule but **not** the `@media (max-width: 880px)` block.

- [ ] **Step 3: Commit the guard + baseline**

```bash
git add src/app/globals.desktop-guard.test.ts src/app/globals.desktop-baseline.css
git commit -m "test(mobile): desktop-scope CSS guard + frozen baseline"
```

---

### Task 3: `useIsMobile` hook

**Files:**
- Create: `src/components/main/useIsMobile.ts`
- Test: `src/components/main/useIsMobile.test.tsx`

**Interfaces:**
- Produces: `useIsMobile(query?: string): boolean` — default query `'(max-width: 880px)'`; returns `false` on first paint (SSR-safe), then reflects `matchMedia(query).matches`, updating on the media query's `change` event.

- [ ] **Step 1: Write the failing test**

Create `src/components/main/useIsMobile.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIsMobile } from './useIsMobile';

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('useIsMobile', () => {
  it('returns true when the media query matches', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('returns false when it does not match', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/main/useIsMobile.test.tsx`
Expected: FAIL — `Cannot find module './useIsMobile'`.

- [ ] **Step 3: Implement the hook**

Create `src/components/main/useIsMobile.ts`:

```ts
import { useEffect, useState } from 'react';

/**
 * True when the viewport is at or below the mobile breakpoint (≤ 880px).
 * SSR-safe: `false` on the server and first client paint, then updated on mount
 * and on viewport changes. Desktop never flips to true, so mobile-only DOM (the
 * scrim) stays out of the desktop tree and the desktop render is unchanged.
 */
export function useIsMobile(query = '(max-width: 880px)'): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return isMobile;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/main/useIsMobile.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/main/useIsMobile.ts src/components/main/useIsMobile.test.tsx
git commit -m "feat(mobile): useIsMobile breakpoint hook"
```

---

### Task 4: Scrim render (mobile-only) + scroll-lock + Escape-close in AppShell

**Files:**
- Modify: `src/components/AppShell.tsx` (import hook ~line 3; add `isMobile` + effects in the component body; render scrim before `<Sidebar>` ~line 297)
- Test: `src/components/AppShell.mobile.test.tsx`

**Interfaces:**
- Consumes: `useIsMobile` (Task 3); existing `sidebarOpen`/`setSidebarOpen` (`AppShell.tsx:61`), `SidebarToggle` (`AppShell.tsx:296`), `Sidebar` (`AppShell.tsx:297`).
- Produces: a `<div class="scrim">` rendered iff `isMobile && sidebarOpen`, closing the sidebar on click.

- [ ] **Step 1: Write the failing test**

Create `src/components/AppShell.mobile.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppShell from './AppShell';

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ articles: [] }) }));
});
afterEach(() => vi.unstubAllGlobals());

describe('AppShell — mobile sidebar overlay', () => {
  it('renders no scrim on desktop even when the sidebar is open', async () => {
    mockMatchMedia(false); // desktop
    const user = userEvent.setup();
    const { container } = render(<AppShell />);
    await user.click(screen.getByRole('button', { name: 'Expand knowledge base' }));
    expect(container.querySelector('.scrim')).toBeNull();
  });

  it('renders a scrim on mobile when open, and tapping it closes the sidebar', async () => {
    mockMatchMedia(true); // mobile
    const user = userEvent.setup();
    const { container } = render(<AppShell />);
    const app = container.querySelector('.app') as HTMLElement;

    await user.click(screen.getByRole('button', { name: 'Expand knowledge base' }));
    expect(app.classList.contains('sidebar-collapsed')).toBe(false);
    const scrim = container.querySelector('.scrim') as HTMLElement;
    expect(scrim).not.toBeNull();

    await user.click(scrim);
    expect(app.classList.contains('sidebar-collapsed')).toBe(true);
    expect(container.querySelector('.scrim')).toBeNull();
  });

  it('closes the sidebar on Escape (mobile)', async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();
    const { container } = render(<AppShell />);
    const app = container.querySelector('.app') as HTMLElement;

    await user.click(screen.getByRole('button', { name: 'Expand knowledge base' }));
    expect(app.classList.contains('sidebar-collapsed')).toBe(false);
    await user.keyboard('{Escape}');
    expect(app.classList.contains('sidebar-collapsed')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/AppShell.mobile.test.tsx`
Expected: FAIL — no `.scrim` node exists.

- [ ] **Step 3: Implement in `AppShell.tsx`**

Add the import near the other `main/` imports (top of file):

```tsx
import { useIsMobile } from './main/useIsMobile';
```

Inside the component, after the `sidebarOpen` state (`AppShell.tsx:61`):

```tsx
  const isMobile = useIsMobile();

  // Mobile overlay only: Escape closes the sidebar and the body is scroll-locked
  // while it's open. Both are no-ops on desktop (isMobile === false), so the
  // desktop runtime is unchanged.
  useEffect(() => {
    if (!isMobile || !sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isMobile, sidebarOpen]);

  useEffect(() => {
    if (!isMobile || !sidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isMobile, sidebarOpen]);
```

Render the scrim between `<SidebarToggle …/>` and `<Sidebar …/>` (`AppShell.tsx:296-297`):

```tsx
      <SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />
      {isMobile && sidebarOpen && (
        <div className="scrim" aria-hidden="true" onClick={() => setSidebarOpen(false)} />
      )}
      <Sidebar
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/AppShell.mobile.test.tsx src/components/AppShell.test.tsx`
Expected: PASS — new mobile tests green AND the existing desktop toggle test still green (proves desktop behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/components/AppShell.tsx src/components/AppShell.mobile.test.tsx
git commit -m "feat(mobile): scrim + scroll-lock + Escape-close for the sidebar overlay"
```

---

### Task 5: Mobile CSS — viewport fit (`100dvh` + safe-area)

Fixes Breakage 1 (clipped chat dock). All edits inside the `@media (max-width: 880px)` block.

**Files:**
- Modify: `src/app/globals.css` (the `@media (max-width: 880px)` block, currently `:941-952`)
- Test: `src/app/globals.mobile.test.ts`

- [ ] **Step 1: Write the failing assertion test**

Create `src/app/globals.mobile.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
const normalize = (s: string) => s.replace(/\s+/g, ' ');
const full = normalize(css);

describe('Mobile viewport fit', () => {
  it('uses 100dvh so the dock clears mobile browser chrome', () => {
    expect(full).toContain('100dvh');
  });
  it('pads the dock for the home-bar safe area', () => {
    expect(full).toContain('env(safe-area-inset-bottom)');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/globals.mobile.test.ts`
Expected: FAIL — `100dvh` / `env(safe-area-inset-bottom)` not present yet.

- [ ] **Step 3: Edit the mobile block in `globals.css`**

Inside `@media (max-width: 880px) {` (currently opens at `:941`), add these rules (after the existing `.app { grid-template-columns: 1fr; }`):

```css
  /* Mobile viewport fit: 100% resolves to the layout viewport on mobile, so the
     bottom-docked orb / composer fall under the URL bar. dvh tracks the visual
     viewport. Mobile-scoped only — desktop keeps height: 100%. */
  html, body, .app, .main { height: 100dvh; min-height: 100dvh; }
  .composer-wrap { padding-bottom: calc(18px + env(safe-area-inset-bottom)); }
  .main > .composer-foot { margin-bottom: calc(clamp(16px, 3vh, 32px) + env(safe-area-inset-bottom)); }
```

- [ ] **Step 4: Run to verify mobile test passes AND desktop guard still green**

Run: `npx vitest run src/app/globals.mobile.test.ts src/app/globals.desktop-guard.test.ts`
Expected: PASS for both — proves the dvh/safe-area rules landed **and** desktop-scope CSS is unchanged (guard green).

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/app/globals.mobile.test.ts
git commit -m "feat(mobile): 100dvh + safe-area viewport fit so the chat dock is reachable"
```

---

### Task 6: Mobile CSS — sidebar overlay + trigger + scrim

Fixes Breakage 2 (KB unreachable). All edits inside the `@media (max-width: 880px)` block.

**Files:**
- Modify: `src/app/globals.css` (replace the `display:none` lines `:943-944`; add overlay/scrim/trigger rules)
- Modify: `src/app/globals.mobile.test.ts` (add assertions)

- [ ] **Step 1: Extend the assertion test (failing)**

Add to `src/app/globals.mobile.test.ts`:

```ts
/** Extract just the `@media (max-width: 880px) { … }` block (brace-balanced). */
function block880(src: string): string {
  const at = src.indexOf('@media (max-width: 880px)');
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(open, j + 1);
  }
  return '';
}
const mobile880 = normalize(block880(css));

describe('Mobile sidebar overlay', () => {
  it('no longer hides the sidebar or its toggle', () => {
    expect(mobile880).not.toContain('.sidebar { display: none');
    expect(mobile880).not.toContain('.sidebar-toggle { display: none');
  });
  it('promotes the sidebar to a fixed slide-in overlay', () => {
    expect(mobile880).toContain('position: fixed');
    expect(mobile880).toContain('translateX(-100%)');
  });
  it('defines the scrim', () => {
    expect(mobile880).toContain('.scrim');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/globals.mobile.test.ts`
Expected: FAIL — sidebar still `display:none`; no `.scrim`/overlay rules.

- [ ] **Step 3: Edit the mobile block**

In `@media (max-width: 880px)`, **delete** these two lines (`:943-944`):

```css
  .sidebar { display: none; }
  .sidebar-toggle { display: none; }
```

and **replace** with:

```css
  /* KB as a slide-in overlay (peek + scrim) instead of a grid column. */
  .sidebar {
    position: fixed; top: 0; left: 0; bottom: 0;
    width: min(86vw, 360px);
    transform: translateX(-100%);
    z-index: 45;
  }
  .app:not(.sidebar-collapsed) .sidebar { transform: translateX(0); }
  .sidebar-inner { width: 100%; }

  /* Trigger: un-hidden, ≥44px touch target, clear of the notch. */
  .sidebar-toggle {
    top: calc(14px + env(safe-area-inset-top));
    left: 14px;
    width: 44px; height: 44px;
  }

  /* Keep the welcome/thread clear of the floating trigger. */
  .scroll { padding-top: 56px; }

  /* Dimming scrim behind the overlay. */
  .scrim {
    position: fixed; inset: 0;
    background: rgba(27, 34, 54, 0.34);
    z-index: 44;
  }
```

Then add the reduced-motion-gated slide, using the **combined** query — with the `@keyframes` **nested inside** it so the guard strips it along with the rest of the mobile block (keyframes nested in a media query are valid CSS). Place this right after the `@media (max-width: 880px)` block closes, NOT inside the global reduced-motion guard:

```css
@media (max-width: 880px) and (prefers-reduced-motion: no-preference) {
  .sidebar { transition: transform .28s cubic-bezier(.4,0,.2,1); }
  .scrim { animation: scrim-in .2s ease-out; }
  @keyframes scrim-in { from { opacity: 0; } to { opacity: 1; } }
}
```

> Note: `.sidebar`'s desktop `transition` lives on the `.app` grid rule, untouched; the mobile transition above targets `transform` and is fully inside a `max-width` query. Because the keyframe is nested inside that query too, **nothing lands outside a `max-width` block** — the desktop baseline needs no refresh.

- [ ] **Step 4: Verify mobile assertions + desktop guard (no baseline change)**

Run: `npx vitest run src/app/globals.mobile.test.ts src/app/globals.desktop-guard.test.ts`
Expected: PASS for both — **without** editing the baseline. Confirm `git status` shows `globals.desktop-baseline.css` is unmodified. If the guard fails, you edited outside the mobile block (or placed the keyframe outside the media query) — fix it there.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/app/globals.mobile.test.ts
git commit -m "feat(mobile): KB slide-in overlay + scrim + un-hidden trigger"
```

---

### Task 7: Mobile CSS — tap targets + drawer safe-area

**Files:**
- Modify: `src/app/globals.css` (mobile block + `480px` block)
- Modify: `src/app/globals.mobile.test.ts` (add assertions)

- [ ] **Step 1: Extend the assertion test (failing)**

Add to `src/app/globals.mobile.test.ts`:

```ts
describe('Mobile touch targets & drawer', () => {
  it('bumps mic/send buttons to a 44px target', () => {
    expect(mobile880).toContain('.mic-btn, .send-btn { width: 44px; height: 44px');
  });
  it('insets the drawer for the safe area', () => {
    expect(mobile880).toContain('.drawer-inner');
    expect(mobile880).toContain('env(safe-area-inset-bottom)');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/globals.mobile.test.ts`
Expected: FAIL — the 44px mic/send override and drawer inset aren't present.

- [ ] **Step 3: Edit the mobile block**

Inside `@media (max-width: 880px)`, add:

```css
  /* Comfortable touch targets. */
  .mic-btn, .send-btn { width: 44px; height: 44px; }
  .quick-chip { padding: 9px 16px; }
  .kb-card { padding: 13px 14px; }
  .drawer-close { width: 40px; height: 40px; }

  /* Drawer respects notch + home bar. */
  .drawer-inner { padding: calc(20px + env(safe-area-inset-top)) 20px calc(40px + env(safe-area-inset-bottom)); }
```

- [ ] **Step 4: Run to verify mobile test + desktop guard pass**

Run: `npx vitest run src/app/globals.mobile.test.ts src/app/globals.desktop-guard.test.ts`
Expected: PASS for both.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/app/globals.mobile.test.ts
git commit -m "feat(mobile): 44px tap targets + drawer safe-area insets"
```

---

### Task 8: Phase 1 desktop-equivalence gate + full quality gate

The release gate for Phase 1. Proves the web is untouched and mobile parity works.

**Files:** none (verification only).

- [ ] **Step 1: Run the full automated quality gate**

```bash
npm run typecheck && npm run test:run && npm run lint
```
Expected: all green — including `globals.tokens.test.ts`, the desktop CSS guard, the mobile assertions, `AppShell.test` (desktop unchanged), and `AppShell.mobile.test`.

- [ ] **Step 2: Capture the AFTER desktop screenshots**

With `npm run dev` on the feature branch, use the Playwright MCP to capture all 7 states at 1440×900 and 1024×768 per `desktop-equivalence.md`, saving as `…/<state>.after.png`.

- [ ] **Step 3: Compare BEFORE vs AFTER (the empirical web-safety proof)**

For each of the 14 screenshots, view BEFORE (Task 1) and AFTER side-by-side. Expected: **no visible difference** in any desktop state. Any delta = a desktop regression — stop, find the offending rule (it escaped the `max-width` scope), fix, and re-run from Step 1.

- [ ] **Step 4: Smoke-test mobile parity**

Resize the Playwright MCP browser to 390×844 (iPhone-class). Verify: the orb + New chat + Voice/Text switch + composer are fully visible and tappable; the trigger opens the KB overlay with a scrim; tapping the scrim and pressing Escape close it; a KB card opens the article drawer; a score-card "suggested ask" sends to chat.

- [ ] **Step 5: Tag the Phase 1 milestone**

```bash
git tag mobile-phase-1
```

---

# PHASE 2 — refinements (higher risk, device-specific)

### Task 9: Keyboard-aware composer (`visualViewport`)

Lifts the dock above the on-screen keyboard while typing in Text mode.

**Files:**
- Modify: `src/components/AppShell.tsx` (add a mobile-gated `visualViewport` effect that sets a CSS var)
- Modify: `src/app/globals.css` (mobile block consumes the var)
- Test: `src/components/AppShell.mobile.test.tsx` (effect attaches/detaches listeners on mobile only)

**Interfaces:**
- Consumes: `isMobile` (Task 4).
- Produces: a `--kb-inset` CSS custom property on `document.documentElement`, `0px` when the keyboard is closed.

- [ ] **Step 1: Write the failing test**

Add to `src/components/AppShell.mobile.test.tsx`:

```tsx
it('tracks visualViewport on mobile and sets --kb-inset', async () => {
  mockMatchMedia(true);
  const listeners: Record<string, () => void> = {};
  const vv = {
    height: 844, width: 390, offsetTop: 0,
    addEventListener: (e: string, cb: () => void) => { listeners[e] = cb; },
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('visualViewport', vv);
  // window.innerHeight stays 844; shrink the visual viewport => keyboard open.
  render(<AppShell />);
  vv.height = 544;
  listeners['resize']?.();
  expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('300px');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/AppShell.mobile.test.tsx`
Expected: FAIL — `--kb-inset` is never set.

- [ ] **Step 3: Implement the effect in `AppShell.tsx`**

Add after the scroll-lock effect (Task 4):

```tsx
  // Keyboard-aware dock (mobile only): lift the dock by the slice of viewport
  // the on-screen keyboard covers. No-op on desktop and where visualViewport is
  // unsupported. The CSS var defaults to 0px via globals.css.
  useEffect(() => {
    if (!isMobile) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--kb-inset', `${inset}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--kb-inset');
    };
  }, [isMobile]);
```

- [ ] **Step 4: Consume the var in the mobile CSS block**

In `@media (max-width: 880px)`, update the composer padding rule from Task 5 to add the inset (default 0):

```css
  .composer-wrap { padding-bottom: calc(18px + env(safe-area-inset-bottom) + var(--kb-inset, 0px)); }
```

- [ ] **Step 5: Run tests + desktop guard**

Run: `npx vitest run src/components/AppShell.mobile.test.tsx src/app/globals.desktop-guard.test.ts`
Expected: PASS for both (the CSS change is inside the mobile block; guard green).

- [ ] **Step 6: Commit**

```bash
git add src/components/AppShell.tsx src/app/globals.css src/components/AppShell.mobile.test.tsx
git commit -m "feat(mobile): keyboard-aware composer via visualViewport"
```

---

### Task 10: Swipe-to-close (sidebar + drawer)

**Files:**
- Create: `src/components/main/useSwipeToClose.ts`
- Test: `src/components/main/useSwipeToClose.test.tsx`
- Modify: `src/components/AppShell.tsx` (wire to the sidebar overlay)
- Modify: `src/components/ArticleDrawer.tsx` (wire to the drawer)

**Interfaces:**
- Produces: `useSwipeToClose({ onClose, direction, enabled }): { onPointerDown, onPointerMove, onPointerUp }` — fires `onClose()` when a horizontal drag exceeds 60px in `direction` (`'left'` for the sidebar, `'right'` for the drawer); inert when `enabled` is false.

- [ ] **Step 1: Write the failing test**

Create `src/components/main/useSwipeToClose.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSwipeToClose } from './useSwipeToClose';

function drag(handlers: any, fromX: number, toX: number) {
  handlers.onPointerDown({ clientX: fromX, clientY: 0 });
  handlers.onPointerMove({ clientX: toX, clientY: 2 });
  handlers.onPointerUp({ clientX: toX, clientY: 2 });
}

describe('useSwipeToClose', () => {
  it('closes on a leftward swipe past threshold', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSwipeToClose({ onClose, direction: 'left', enabled: true }));
    drag(result.current, 200, 120); // 80px left
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('ignores small or wrong-direction drags', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSwipeToClose({ onClose, direction: 'left', enabled: true }));
    drag(result.current, 200, 180); // 20px, under threshold
    drag(result.current, 200, 300); // rightward
    expect(onClose).not.toHaveBeenCalled();
  });
  it('is inert when disabled', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSwipeToClose({ onClose, direction: 'right', enabled: false }));
    drag(result.current, 200, 400);
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/main/useSwipeToClose.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the hook**

Create `src/components/main/useSwipeToClose.ts`:

```ts
import { useRef, type PointerEvent } from 'react';

interface Opts { onClose: () => void; direction: 'left' | 'right'; enabled: boolean; }
const THRESHOLD = 60;

/** Horizontal swipe-to-close. Returns pointer handlers to spread onto the panel. */
export function useSwipeToClose({ onClose, direction, enabled }: Opts) {
  const start = useRef<{ x: number; y: number } | null>(null);

  return {
    onPointerDown: (e: PointerEvent | { clientX: number; clientY: number }) => {
      if (!enabled) return;
      start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerMove: (_e: PointerEvent | { clientX: number; clientY: number }) => {
      /* tracking only on up; nothing needed here */
    },
    onPointerUp: (e: PointerEvent | { clientX: number; clientY: number }) => {
      if (!enabled || !start.current) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      start.current = null;
      if (Math.abs(dx) < THRESHOLD || Math.abs(dy) > Math.abs(dx)) return;
      if ((direction === 'left' && dx < 0) || (direction === 'right' && dx > 0)) onClose();
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/main/useSwipeToClose.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire into `AppShell.tsx` (sidebar) and `ArticleDrawer.tsx` (drawer)**

In `AppShell.tsx`, build sidebar swipe handlers and spread them onto a wrapper around `<Sidebar>` (or pass through). Minimal approach — wrap the scrim+sidebar region:

```tsx
  const sidebarSwipe = useSwipeToClose({
    onClose: () => setSidebarOpen(false), direction: 'left', enabled: isMobile && sidebarOpen,
  });
```

Spread `{...sidebarSwipe}` onto the `<Sidebar>`'s root by adding pass-through props, OR onto a wrapping `<div>`. Simplest: add the handlers to the `aside.sidebar` via a new optional prop on `Sidebar` (`swipeHandlers?`). For the drawer, in `ArticleDrawer.tsx` add:

```tsx
  const swipe = useSwipeToClose({ onClose, direction: 'right', enabled: open });
```

and spread `{...swipe}` onto the `<aside className="drawer …">`.

- [ ] **Step 6: Run the affected suites + guard**

Run: `npx vitest run src/components/AppShell.mobile.test.tsx src/components/ArticleDrawer.test.tsx src/app/globals.desktop-guard.test.ts`
Expected: PASS (drawer test unaffected on desktop; guard green — no CSS changed).

- [ ] **Step 7: Commit**

```bash
git add src/components/main/useSwipeToClose.ts src/components/main/useSwipeToClose.test.tsx src/components/AppShell.tsx src/components/ArticleDrawer.tsx src/components/sidebar/Sidebar.tsx
git commit -m "feat(mobile): swipe-to-close for sidebar overlay and article drawer"
```

---

### Task 11: Phase 2 desktop-equivalence gate + final quality gate

**Files:** none (verification only).

- [ ] **Step 1: Full quality gate**

```bash
npm run typecheck && npm run test:run && npm run lint
```
Expected: all green.

- [ ] **Step 2: Re-run the desktop pixel check**

Repeat Task 8 Steps 2–3 (capture AFTER, compare to the Task 1 baseline). Expected: zero visible desktop delta. The swipe/keyboard work is mobile-gated, so desktop must still match the original baseline exactly.

- [ ] **Step 3: Mobile device pass**

In the Playwright MCP at 390×844: type in Text mode and confirm the composer stays above the on-screen keyboard; swipe the sidebar overlay left to close; swipe the article drawer right to close.

- [ ] **Step 4: Finish the branch**

Use `superpowers:finishing-a-development-branch` to open the PR (or merge), referencing the spec and this plan.

---

## Self-review notes (author)

- **Spec coverage:** Breakage 1 → Task 5 (+9); Breakage 2 → Tasks 4, 6; peek+scrim → Task 6; tap targets → Task 7; desktop equivalence (a) DOM → Task 4, (b) static CSS → Task 2, (c) pixel diff → Tasks 1/8/11; phasing → Phase 1 vs Phase 2 split; out-of-scope items (bottom tabs, bottom-sheet drawer, persistence) intentionally absent.
- **Type consistency:** `useIsMobile(): boolean`, `useSwipeToClose(opts): handlers`, `--kb-inset` / `--kb-inset, 0px` used consistently; `.scrim`, `.sidebar`, `.sidebar-collapsed`, `kb-sidebar` match the existing DOM (`Sidebar.tsx:40`, `SidebarToggle.tsx:19`).
- **Guard caveat:** every addition lands inside a `max-width` query — including `@keyframes scrim-in`, nested inside the combined `max-width … and (prefers-reduced-motion …)` block (Task 6 Step 3). So the desktop baseline is never edited across the whole plan; if the guard ever asks for a baseline refresh, that's the signal something escaped mobile scope.
