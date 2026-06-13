# Testing Strategy — Conversation-First Redesign (Aurora Mist)

**Project:** AI News Tutor (`src/`, Next.js 14 + TS + Vitest + @testing-library/react)
**Spec:** `spec/conversation-first-redesign.md`
**Date:** 2026-06-13

---

## Test Layers

### 1. Unit / Logic Tests (`src/**/*.test.ts`)

Pure functions and hooks with no DOM dependency.

| Target | What to assert |
|--------|---------------|
| `parseAnswer` (existing) | Parsing correctness — unchanged by redesign |
| `scraper` utilities (existing) | Network/parse logic — unchanged |
| `useSpeechRecognition` hook (new) | See §3 below |

Run with: `npm run test:run` (no browser required).

---

### 2. Component Tests (`src/**/*.test.tsx`)

RTL renders with jsdom. The engineering agent owns all component test files.

| Target | Minimum coverage expected |
|--------|--------------------------|
| `Orb.tsx` | Renders for each `state` prop value; reduced-motion static-only class; `onClick` fires |
| `VoiceDock.tsx` | Renders orb + status readout; mode-toggle fires `setInputMode`; transcript text visible |
| `InputDock.tsx` | Shows `VoiceDock` when `inputMode='voice'`, `Composer` when `'text'`; toggle changes mode |
| `Composer.tsx` (existing) | Already covered in `Composer.test.tsx` — no changes needed |
| `MicBtn.tsx` (refactored) | Still toggles listening via `useSpeechRecognition`; existing behavior preserved |

Conventions: use `vi.fn()` for callbacks; render via a thin `render*(overrides)` helper; use `screen` queries; `userEvent.setup()` for interactions. See `Composer.test.tsx` as the canonical example.

---

### 3. `useSpeechRecognition` Hook — Required Coverage

The hook (`src/components/main/useSpeechRecognition.ts`) encapsulates STT setup. The `MockSpeechRecognition` in `vitest.setup.ts` makes it fully unit-testable.

Must test:

- **`supported`**: `true` when `window.SpeechRecognition` is present (mock provides it); `false` when removed.
- **`toggle()` start path**: when `listening=false`, calling `toggle()` calls `recognition.start()` and sets `listening=true`.
- **`toggle()` stop path**: when `listening=true`, calling `toggle()` calls `recognition.stop()` and sets `listening=false`.
- **`onInterim` callback**: fires with partial transcript when `onresult` delivers `isFinal=false` results.
- **`onFinal` callback**: fires with final transcript when `onresult` delivers `isFinal=true` results.
- **`disabled` guard**: when `disabled=true`, `toggle()` is a no-op.
- **`onend` cleanup**: `listening` resets to `false` when recognition ends unexpectedly.

---

### 4. CSS Token Regression Lock (`src/app/globals.tokens.test.ts`)

Reads `src/app/globals.css` from disk and asserts token values + structural guarantees. This is a design-contract test — it catches accidental palette regressions that no component test would catch.

**Why it changed from the old reskin:** The previous test (`UI-RESKIN-WHITER-CLEANER.md`) locked the warm cream/terracotta palette (`--accent: #c75b39`) and explicitly forbade `radial-gradient`. Aurora Mist is the opposite: cool pastel hex tokens, a radial-gradient aurora background, and frosted-glass `backdrop-filter`. Keeping the old assertions would make every correct Aurora Mist CSS file fail, so the test was fully rewritten.

**Locked token table (cross-team contract):**

| Token | Value |
|-------|-------|
| `--ink` | `#1B2236` |
| `--ink-soft` | `#4A5470` |
| `--muted` | `#7C86A0` |
| `--faint` | `#9AA3BD` |
| `--accent` | `#8AB4FF` |
| `--accent-strong` | `#4F7BE8` |
| `--accent-2` | `#C9B8FF` |
| `--line` | `#E1E7F4` |
| `--line-2` | `#EEF2FB` |
| `--bg` | `#EDF1FB` |
| `--panel` | `#FFFFFF` |
| `--panel-2` | `#FFFFFF` |

**Additional structural assertions:**

- `radial-gradient` IS present (aurora background).
- `backdrop-filter` IS present (frosted glass).
- Old accent `#c75b39` is ABSENT.
- Classes `.orb-core`, `.orb-bloom`, `.orb-ring`, `.input-mode-switch`, `.voice-dock` are present.
- `@media (prefers-reduced-motion: no-preference)` guard is present.

> **Note:** This test will fail until the design agent lands the Aurora Mist `globals.css`. That is expected — the test is correct against the contract.

---

### 5. Reduced-Motion + Responsive Assertions

`vitest.setup.ts` already mocks `window.matchMedia` (default: `matches: false`). Use it in component tests:

```ts
// Simulate reduced-motion preference
vi.mocked(window.matchMedia).mockImplementation((query) => ({
  matches: query === '(prefers-reduced-motion: reduce)',
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));
```

- **Orb reduced-motion**: with the mock above, the orb must render without animation classes / with a static-only class.
- **Responsive (<880px)**: inject a `max-width: 880px` matchMedia match to verify the sidebar-hidden layout doesn't break the orb/composer render.

The CSS-layer animation gating (`@media (prefers-reduced-motion: no-preference)`) is asserted in `globals.tokens.test.ts`.

---

### 6. Manual / Playwright Verification Checklist

Run after all automated tests pass, against `npm run dev`:

1. App opens in **voice-only mode** — large orb centered, sidebar + topbar + thread present, palette is Aurora Mist (no cream/terracotta).
2. **Orb interaction** — click → `listening` state (ripple/pulse); speak → interim transcript shows; final transcript auto-sends; answer streams in thread; TTS on → `speaking` orb reaction.
3. **Mode switch** — toggle to Text → frosted-glass composer works; toggle back to Voice.
4. **Reduced motion** — `prefers-reduced-motion: reduce` → orb is static-glowing, no ripple/breathe.
5. **Responsive** — at <880px sidebar hides; orb/composer remain centered and usable.
6. **Visual** — frosted glass, cool shadows, Plus Jakarta Sans UI, Newsreader for answers.
7. *(Optional)* Screenshot via Playwright MCP for before/after record.
8. `npm run build` (or `npx tsc --noEmit`) passes — no type errors from new props/hook.

---

## Green-Bar Definition of Done

All of the following must be true before the redesign is considered complete:

| Check | Command |
|-------|---------|
| All vitest suites pass | `npm run test:run` |
| TypeScript clean | `npx tsc --noEmit` |
| Next.js build succeeds | `npm run build` |
| 8-point manual checklist above | Manual / Playwright |

---

## How to Run

```bash
# Run all tests once
npm run test:run

# Watch mode (re-runs on file change)
npm run test

# Token regression only
npx vitest run src/app/globals.tokens.test.ts

# TypeScript typecheck (no emit)
npx tsc --noEmit

# Production build
npm run build
```
