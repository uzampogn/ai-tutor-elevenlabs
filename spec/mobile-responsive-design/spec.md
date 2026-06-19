# Mobile Responsive Design — Design Spec

> **Status:** Design approved 2026-06-19. Next step: implementation plan (`superpowers:writing-plans`).
> **Source brainstorm:** `.superpowers/brainstorm/51694-1781854497/` (nav-pattern, overlay-style mockups).

**Goal:** Make the full web feature set usable on mobile (phones and small tablets, `≤ 880px`) — today the **core chat controls are clipped under the browser chrome** *and* the **Knowledge Base / Article reader are absent** — with a touch-first experience, **while keeping the desktop UI (`> 880px`) byte-for-byte identical.**

---

## Background — what breaks today

The app is a CSS-grid shell (`globals.css`): a 320px Knowledge-Base `.sidebar` + a `1fr` `.main` column (Thread + InputDock), plus a right-hand `ArticleDrawer`. On mobile **two distinct things break — both must be fixed for parity.**

### Breakage 1 — the primary chat surface doesn't fit the mobile viewport

The shell sizes off a `height: 100%` chain (`html, body { height: 100% }` at `globals.css:58` → `.app { height: 100% }` at `:90`), with the InputDock bottom-docked inside `.main`. On mobile browsers `100%` resolves to the *layout* viewport (taller than the *visual* viewport while the URL / tab bars show), so the bottom-docked controls sit **below the fold, under the browser chrome, and can't be tapped**:

- the **voice orb** — the headline "tap the orb and speak" interaction,
- **New chat** and the **Voice / Text switch** (the `.session-controls` cluster),
- in text mode, the **composer** itself.

The code already half-acknowledges this: `globals.css:542-547` adds `margin-bottom: clamp(16px, 3vh, 32px)` to lift the cluster because "the Voice/Text toggle clips under browser chrome." That margin is a desktop patch; on mobile the clip is worse and the controls become unreachable. The real fix is a viewport model that respects mobile chrome (`100dvh` + safe-area), **applied inside the `≤ 880px` media query only** so desktop keeps `height: 100%` untouched.

### Breakage 2 — the Knowledge Base and Article reader are amputated

The existing `@media (max-width: 880px)` block (`globals.css:940-955`) hides the KB outright rather than adapting it:

```css
.sidebar        { display: none; }   /* the whole Knowledge Base */
.sidebar-toggle { display: none; }   /* …and the only control that could bring it back */
```

The sidebar's KB cards are the **only** entry point to articles — `onOpenArticle` is passed nowhere else (`AppShell.tsx:303`). So a phone user loses, with no fallback: the browsable **Knowledge Base** (the headline "Live knowledge base" feature), the **Article reader** drawer (hero + score card), and the score-card **"suggested asks" → chat** loop.

**Net:** on a phone today the app is neither fully usable as a chat (core controls off-screen) nor as a knowledge base (absent). Both are in scope. The welcome chips, answer thread, and read-along do reflow to single-column correctly — those are unaffected.

---

## Architecture & strategy

**One breakpoint, everything mobile-gated.** Keep `880px` as the single mobile boundary. Nothing above 880px changes — no CSS rule, no rendered DOM node, no JS effect. Concretely:

- All new CSS lives inside `@media (max-width: 880px)` (and the existing `480px` tweak block).
- The single new DOM node (a scrim) is rendered **only when mobile** (see Desktop Equivalence), so the desktop DOM tree is unchanged.
- New JS behaviors (scroll-lock, Escape-to-close, swipe) are gated behind `matchMedia('(max-width: 880px)')`, so the desktop runtime is a no-op.

**Reuse the existing open/closed state — do not add a new state machine.** The sidebar already has `sidebarOpen` in `AppShell` (`AppShell.tsx:61`), toggled by the brand-mark `SidebarToggle` (`AppShell.tsx:296`), and the `.sidebar-collapsed` class on `.app`. Only the **CSS presentation of "open" changes by breakpoint**:

| Breakpoint | "Open" means |
|---|---|
| Desktop (`> 880px`, unchanged) | grid column animates `0 → 320px`; `.main` reclaims space |
| Mobile (`≤ 880px`, new) | same `.sidebar`, now `position: fixed`, slides `translateX(-100%) → 0` as an overlay over the chat, with a scrim |

Both presentations read the **same** `.sidebar-collapsed` class. State starts closed on every load (`useState(false)`), unchanged.

**Tech stack:** Next.js 14, React 18.3, TypeScript, Tailwind + plain CSS (`globals.css`), Vitest + React Testing Library. Playwright (already used via MCP, see `.playwright-mcp/`) for desktop pixel-equivalence checks. **No new npm dependencies** (swipe handled with native pointer/touch events).

---

## Global constraints

- **Aurora Mist visual system is locked** — no palette / font / radius / shadow / **keyframe** token changes. Asserted by `globals.tokens.test.ts`; this feature adds CSS only, reusing existing tokens.
- **Desktop (`> 880px`) renders byte-identically** — the hard requirement. Enforced by the three-layer verification below, not just by convention.
- **Motion gated behind `prefers-reduced-motion: no-preference`** — any new transition (slide-in, scrim fade) lives inside the existing guard (`globals.css:856`); the overlay still opens/closes under reduced motion, just without the slide.
- **No persistence** — mobile sidebar starts closed each load, like desktop.
- **`inert` set imperatively** — React 18.3 does not pass the `inert` JSX attribute; the collapse work already does this for the sidebar when closed.
- **Quality gate (all must pass before close):** `npm run typecheck`, `npm run test:run`, `npm run lint`, plus the desktop pixel-equivalence pass (below).

---

## 1. Core: make the app fit, reachable, and navigable (Phase 1)

**Viewport fit (fixes Breakage 1).** Inside `@media (max-width: 880px)` **only**, override the shell height to `100dvh` (`html, body`, `.app`, `.main`) and add `env(safe-area-inset-bottom)` padding to the dock so the bottom cluster — **voice orb, New chat, Voice / Text switch, and the text composer** — is fully visible and tappable with the browser chrome showing. Desktop keeps `height: 100%` (no edit outside the media query → static CSS guard and pixel diff stay green).

**Navigation (fixes Breakage 2):**

- **Trigger.** Un-hide the existing brand-mark button on mobile (it is `display:none` today at `globals.css:944`). Ensure a **≥ 44px** touch target and a notch inset (`env(safe-area-inset-top)`). Reserve a top-left zone so it never overlaps the welcome title — add top padding to mobile `.scroll`/`.thread`.
- **Sidebar → overlay.** Below 880px, pull `.sidebar` out of the grid into `position: fixed; top:0; left:0; bottom:0; width: min(86vw, 360px); z-index: 45`. It slides in on `.app:not(.sidebar-collapsed)`. **Peek + scrim** (approved): a strip of chat stays visible at the right edge.
- **Scrim.** A new node rendered by `AppShell` only when mobile + open; tapping it calls `setSidebarOpen(false)`. Soft `rgba(27,34,54,.34)` dim, fade gated under the reduced-motion guard.
- **Close affordances.** (1) tap scrim and (2) `Escape` key — **Phase 1**; (3) **swipe-left** to dismiss — **Phase 2**. Body is scroll-locked while open; focus moves into the sidebar on open and returns to the trigger on close (reuses the existing `inert` wiring).
- **Article drawer.** Keep the existing right-slide, full-width on mobile (`globals.css:948`, `.drawer { width: 100% }`). Add a **≥ 44px** close button and safe-area insets (Phase 1); **swipe-right-to-close** (Phase 2). With the KB reachable, the score-card "suggested asks" → chat loop now works on mobile.
- **Tap targets.** Mic / send buttons `40px → 44px` on mobile (`globals.css:518-519`); quick-chips, KB cards, and the drawer close button audited to **≥ 44px**.

## 2. Refinements (Phase 2)

- **Keyboard-aware composer.** Building on the Phase 1 `100dvh` fit, add a mobile-gated `visualViewport` resize listener that lifts the dock above the **on-screen keyboard** while typing, so the text composer never hides behind it. (Phase 1 already guarantees the dock is reachable with the keyboard *closed*; this handles the keyboard *open* case.)
- **Swipe gestures.** Swipe-left to dismiss the sidebar overlay; swipe-right to dismiss the article drawer. Native pointer/touch events, no dependency.

## 3. Files touched

| File | Change |
|---|---|
| `src/app/globals.css` | Rewrite the `@media (max-width: 880px)` block; minor `480px` additions. **No edits outside media queries.** |
| `src/components/AppShell.tsx` | Render the scrim (mobile-only); wire scroll-lock, Escape, and swipe via a mobile gate. |
| `src/components/ArticleDrawer.tsx` | Swipe-to-close + safe-area (mobile-only handlers/props). |
| `src/components/main/useIsMobile.ts` *(new)* | `matchMedia('(max-width: 880px)')` hook; SSR-safe default `false`. |
| Tests | New mobile-behavior tests + desktop CSS guard (below). |

---

## 4. Desktop equivalence — verification & tests

The acceptance gate for "desktop looks exactly the same." Three layers:

**(a) DOM identity.** The scrim renders **only when `useIsMobile()` is true**. The hook defaults to `false` on first paint (SSR-safe, no hydration mismatch) and updates on mount. On desktop it stays `false` → the scrim node never exists → the desktop DOM tree is unchanged (no hidden/inert nodes added).

**(b) Static CSS guard (CI, fast).** A new Vitest test reads `globals.css`, strips every `@media (max-width: …)` block, and asserts the remaining (desktop-scope) CSS equals a committed baseline string. Any accidental edit to desktop-scope CSS fails the build. `globals.tokens.test.ts` stays green alongside it.

**(c) Before/after pixel diff (the real proof).** Drive the running app with Playwright at desktop widths **1440px** and **1024px** (both `> 880px`); screenshot each visual feature on `main` (baseline) vs. the feature branch (after); assert a **0-pixel diff** per feature. Run in a **git worktree** (repo isolation rule) so baseline and feature branch can be captured without disturbing the shared working tree. Features:

1. Welcome — title, lede, 2×2 suggested chips
2. KB sidebar **expanded** — brand, refresh, live status, cards
3. KB sidebar **collapsed** — toggle squircle → circle morph
4. Answer thread — AI row, Business Impact card, source chips, read-along highlight, message actions
5. Voice dock + orb (idle / speaking)
6. Text composer + quick-row
7. Article drawer — hero, score card, suggested asks

**Mobile behavior tests (Vitest/RTL):** scrim renders only when mobile; tapping scrim and pressing `Escape` close the sidebar; trigger is visible (not `display:none` in the mobile CSS — a regression lock asserting the mobile block no longer hides `.sidebar`/`.sidebar-toggle`).

---

## 5. Phasing

- **Phase 1 — fit + parity (core):** `100dvh` / safe-area viewport fix so the chat dock (orb, New chat, Voice/Text switch, composer) is reachable; KB overlay + scrim + trigger; tap-targets; tap-scrim / Escape close; desktop CSS guard + mobile behavior tests. Delivers a usable chat **and** the KB/reader on mobile, and passes the pixel-diff gate.
- **Phase 2 — refinements (higher risk, device-specific):** `visualViewport` keyboard-follow (composer above the on-screen keyboard) and swipe-to-close gestures (most JS, most test surface).

---

## 6. Risks

- **`100dvh` viewport fit (Phase 1)** — `dvh` is well-supported across current mobile Safari/Chrome, so the static fit fix is low risk. The harder, device-specific case is the **on-screen keyboard** (`visualViewport`), deliberately deferred to Phase 2 so Phase 1 ships a reachable dock without iOS keyboard quirks.
- **Swipe gestures (Phase 2)** add JS and test surface; native pointer events only, no dependency.
- **`backdrop-filter` blur count on mobile GPUs** — pre-existing (sidebar, composer, chips already blur); the overlay adds the sidebar blur over a scrim. Watch for jank on low-end devices; acceptable, no new blur surfaces beyond repositioning.

---

## 7. Out of scope (YAGNI)

- Bottom tab bar / separate "Library" route (rejected nav pattern B).
- Article drawer as a bottom sheet (kept as right-slide).
- Persisting sidebar state across loads.
- Any desktop visual change, new tokens, or new keyframes.
- PWA/install, offline, or native-app concerns.

---

## 8. Acceptance criteria

- On a `≤ 880px` viewport with the browser chrome showing, the **full chat dock — voice orb, New chat, Voice / Text switch, and text composer — is visible and tappable** (no clipping under the URL / tab bars).
- On a `≤ 880px` viewport: the brand-mark trigger opens the KB as a peek+scrim overlay; KB cards open the article drawer; score-card "suggested asks" send to chat; all close affordances work.
- All interactive targets on mobile are **≥ 44px**.
- `npm run typecheck`, `npm run test:run`, `npm run lint` pass.
- Desktop static CSS guard passes; desktop pixel diff at 1440px and 1024px is **0** across all seven features.
