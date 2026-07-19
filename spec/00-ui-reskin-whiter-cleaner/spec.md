# Spec — AI Tutor UI Reskin: "Whiter & Cleaner"

**Status:** ✅ Shipped (2026-06-10)
**Scope:** Design-token reskin of `:root` in one CSS file. No component, layout, JSX, or TypeScript changes.
**File touched:** `src/app/globals.css` (only)

---

## Goal

Move the AI Tutor UI from a **cool blue-tinted** palette to a **whiter, cleaner** interface inspired by the BizLink dashboard (`ui-design-mockup/ui-inspiration.png`) — white cards floating on a faint neutral canvas, hairline borders, lots of light — **without changing the layout**.

Confirmed scope decisions:
1. **Keep the terracotta accent** (`#c75b39`) for brand identity. Only neutral surfaces were whitened/neutralized.
2. **Keep current depth** — existing shadows and hover lift retained. This is a color/surface change, not a flattening.

The whole live UI is token-driven (`globals.css` `:root`), so retheming the tokens recolors every component at once.

---

## The key insight (why the first attempt looked unchanged)

The original palette was **already near-white** with only a trace of blue chroma (`--bg` at `oklch(0.991 0.006 252)`, `--panel` at `0.996`). Simply neutralizing the hue produced a visually **imperceptible** change — the page and the cards were within ~0.005 lightness of each other, so nothing "popped."

The lever that actually delivers the BizLink look is **page↔card contrast**: push the page background down to a genuine faint neutral gray and keep panels pure white, so white cards visibly float on a light canvas.

---

## Final token values (locked)

In `src/app/globals.css` `:root`:

| Token | Before (cool blue) | After (neutral white) | Note |
|-------|--------------------|-----------------------|------|
| `--bg` | `oklch(0.991 0.006 252)` | `oklch(0.968 0.0015 95)` | **Faint neutral gray canvas** — the contrast lever. White cards pop against it. |
| `--panel` | `oklch(0.996 0.004 252)` | `oklch(1 0 0)` | Pure-white cards / composer / topbar |
| `--panel-2` | `oklch(0.968 0.009 252)` | `oklch(1 0 0)` | Sidebar is now a pure-white rail, separated by hairline border only |
| `--ink` | `oklch(0.255 0.014 260)` | `oklch(0.24 0.006 95)` | Neutral near-black, blue tint removed |
| `--ink-soft` | `oklch(0.44 0.014 260)` | `oklch(0.44 0.006 95)` | Neutralized |
| `--muted` | `oklch(0.60 0.012 260)` | `oklch(0.60 0.005 95)` | Neutralized |
| `--faint` | `oklch(0.72 0.010 260)` | `oklch(0.74 0.004 95)` | Neutralized, slightly lighter |
| `--line` | `oklch(0.90 0.010 255)` | `oklch(0.915 0.003 95)` | Cleaner hairline |
| `--line-2` | `oklch(0.945 0.007 255)` | `oklch(0.95 0.002 95)` | Cleaner hairline |

**Strategy:** drop the cool blue chroma to near-zero on a faint warm-neutral hue (~95), push panels to pure white, and — critically — lower `--bg` to `0.968` to create real page↔card separation.

### `.app` background (flat clean canvas)

```css
/* before */
background:
  radial-gradient(120% 80% at 100% 0%, color-mix(in oklab, var(--accent) 5%, transparent), transparent 60%),
  var(--bg);
/* after */
background: var(--bg);
```

The accent-tinted radial gradient (visible as a terracotta wash in the canvas top-right) was removed so the canvas reads flat and clean like the inspiration.

---

## Left unchanged (per decisions)

- `--accent: #c75b39` and all accent-derived surfaces: impact-card gradient, AI avatar, send button, focus-within ring, source-chip hover, suggestion-card tint, "explained clearly" italic, card arrows.
- All `--shadow*` tokens (sm / base / lg) and all hover/lift transitions — depth retained.
- All radius / gap / density tokens.
- All component class rules and every `.tsx`.
- The green "Live" / welcome semantic accents, and all fonts.

---

## Verification (all passing)

- **`npm run test:run`** — `src/app/globals.tokens.test.ts` (14 cases) locks the reskin: asserts all 9 `:root` token values, the retained `--accent: #c75b39`, the flat `.app` `background: var(--bg)` with no `radial-gradient`, and the removal of the old cool-blue palette (hue 252). Any accidental revert of the reskin now fails CI. Full suite: 78 tests passing.
- **`npm run typecheck`** — passes clean (no TS edits).
- **Live app** (`npm run dev`, `localhost:3000`) — welcome state confirmed: white sidebar rail, faint-gray canvas, white cards/composer/topbar that pop, terracotta accent intact on logo / "explained clearly" / arrows / send button / green Live dot. Shadows + card depth retained.
- **Responsive** — at `max-width: 880px` the sidebar collapses correctly; cards stack full-width and still read as white on the gray canvas.
- **Surfaces are global** — drawer (`shadow-lg`) and `:focus-within` composer ring inherit the new `--panel` / `--line` tokens and the preserved accent ring automatically.

---

## Out of scope

- No layout/structure changes (grid, spacing, component arrangement).
- No new components, no JSX/TS changes.
- No accent recolor, no shadow flattening.
