# Testing Strategy — Conversation-First Cleanup (Aurora Mist, pass 2)

**Project:** AI News Tutor (`src/`, Next.js 14 + TS + Vitest + @testing-library/react)
**Spec:** `spec/conversation-first-cleanup.md` (structural cleanup; builds on `spec/conversation-first-redesign.md`)
**Date:** 2026-06-13

> **Pass 2 in one line:** the top bar is gone, voice is always on, the orb is shrunk and
> bottom-docked, the readout text and the "Live knowledge base" badge are removed, and
> "New chat" moves down beside the Voice/Text switch. The Aurora Mist visual system is
> **locked and unchanged** — this pass only removes chrome and reflows layout, so the
> token contract below stays as-is and only the *structural* assertions move.

---

## Test Layers

### 1. Unit / Logic Tests (`src/**/*.test.ts`)

Pure functions and hooks with no DOM dependency.

| Target | What to assert |
|--------|---------------|
| `parseAnswer` (existing) | Parsing correctness — unchanged by cleanup |
| `scraper` utilities (existing) | Network/parse logic — unchanged |
| `useSpeechRecognition` hook | See §3 below — unchanged by cleanup |

Run with: `npm run test:run` (no browser required).

---

### 2. Component Tests (`src/**/*.test.tsx`)

RTL renders with jsdom. The engineering agent owns all component test files.

| Target | Minimum coverage expected |
|--------|--------------------------|
| `Orb.tsx` | Renders for each `state` prop value; reduced-motion static-only class; `onClick` fires; **state-appropriate `aria-label` per state** (now the only voice cue for screen readers — see §6) |
| `VoiceDock.tsx` | Orb state derivation (idle/listening/thinking/speaking precedence) + orb interaction + STT-unsupported fallback; **the `.voice-dock-readout` status text is NOT rendered**; orb keeps a state-appropriate `aria-label` |
| `InputDock.tsx` | Shows `VoiceDock` when `inputMode='voice'`, `Composer` when `'text'`; toggle changes mode; **`New chat` renders in BOTH modes and clicking it invokes the new-chat handler** |
| `Welcome.tsx` | Title + lede + 2×2 suggested chips render and are clickable; **the "Live knowledge base" badge is NOT present** |
| `Composer.tsx` (existing) | Already covered in `Composer.test.tsx` — no changes needed |

**Removed (pass 2):**

| Target | Reason |
|--------|--------|
| `Topbar.tsx` + its test | Top bar deleted from `AppShell.tsx`; component removed |
| `VoiceToggle.tsx` + `VoiceToggle.test.tsx` | Voice is always on; the on/off affordance no longer exists. **Delete `VoiceToggle.test.tsx`.** |

Conventions: use `vi.fn()` for callbacks; render via a thin `render*(overrides)` helper; use `screen` queries; `userEvent.setup()` for interactions. See `Composer.test.tsx` as the canonical example.

---

### 3. `useSpeechRecognition` Hook — Required Coverage

The hook (`src/components/main/useSpeechRecognition.ts`) encapsulates STT setup. The `MockSpeechRecognition` in `vitest.setup.ts` makes it fully unit-testable. **Unchanged by the cleanup** — voice-always-on does not change the STT contract.

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

**Why the token table is unchanged in pass 2:** The Aurora Mist visual system is **locked**. The cleanup removes chrome and reflows layout but does not touch any color, font, radius, shadow, or `@keyframes`. The token table below is identical to pass 1; only the *structural assertions* change (some classes are now removed, and the orb gains a viewport-relative size cap).

**Locked token table (cross-team contract — unchanged):**

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

**Structural assertions (updated for pass 2):**

- `radial-gradient` IS present (aurora background).
- `backdrop-filter` IS present (frosted glass).
- Old accent `#c75b39` is ABSENT.
- `@media (prefers-reduced-motion: no-preference)` guard is present.
- Classes `.orb-core`, `.orb-bloom`, `.orb-ring`, `.input-mode-switch`, `.voice-dock` ARE present.
- **`--orb-size` uses the `25vh` cap** — assert the declaration reads `min(248px, 25vh)` (the orb is bottom-docked at ≤25% viewport height); the `200px` / `168px` responsive floors remain.
- **Removed classes are ABSENT** — `.topbar` (and `.topbar-l` / `.topbar-r` / `.topbar-title` / `.topbar-sub`), `.welcome-badge` (and `.live-dot`), `.voice-dock-readout` / `.voice-dock-readout-text`, and the legacy `.voice-dock-status` / `.voice-dock-hint` status classes must no longer appear in `globals.css`.
- `.voice-dock-unsupported` IS still present (STT fallback retained).

> **Note:** These assertions track the cleanup CSS. They will fail until the design/eng agent lands the pass-2 `globals.css` (topbar/badge/readout CSS removed, `--orb-size` capped). That is expected — the test is correct against the contract.

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

The CSS-layer animation gating (`@media (prefers-reduced-motion: no-preference)`) and the `--orb-size` cap are asserted in `globals.tokens.test.ts`.

---

### 6. A11y Trade-Off — Orb as the Sole Voice Cue

The cleanup removes the `.voice-dock-readout` block (Waveform + "Tap to speak / Listening… /
Thinking… / Speaking…" status text). The orb's animation states are now the **only** visible
cue that voice is active, and there is no longer any status text for screen readers to announce.

**Mitigation under test:** the orb button's `aria-label` must remain state-appropriate so
assistive tech still surfaces the current state:

| Orb state | Required `aria-label` |
|-----------|----------------------|
| `idle` | `Start voice input` |
| `listening` | `Stop listening` |
| `thinking` | `Thinking…` |
| `speaking` | `Speaking…` |

Asserted in both `Orb.test.tsx` (per-state label) and `VoiceDock.test.tsx` (derived state →
correct label), so removing the readout cannot silently strip the only remaining a11y signal.

---

### 7. Manual / Playwright Verification Checklist

Run after all automated tests pass, against `npm run dev`:

1. App opens in **voice mode** — **no top bar, no "AI News Tutor" title/subtitle, no "Live knowledge base" badge, no on/off voice toggle**. Welcome hero (title + lede + 2×2 chips) fully visible; palette is Aurora Mist (no cream/terracotta).
2. **Orb is compact and bottom-docked** (≤25vh), in its own flex row, **never overlapping the content above it**; **no "Tap to speak" readout text beneath it**.
3. **Orb interaction** — click → `listening` state (ripple/pulse); speak → final transcript auto-sends; answer **streams in the thread above while TTS plays** (voice always on — no toggle to flip).
4. **New chat** — sits beside the Voice/Text switch, is reachable in **both** Voice and Text modes, and clears the session (messages + audio) when clicked.
5. **Mode switch** — toggle to Text → frosted-glass composer works; toggle back to Voice.
6. **Reduced motion** — `prefers-reduced-motion: reduce` → orb is static-glowing, no ripple/breathe.
7. **Responsive** — at <880px sidebar hides; orb/composer remain usable and the orb stays within its ≤25vh cap.
8. `npm run build` (or `npx tsc --noEmit`) passes — no type errors from dropped props (`voiceEnabled`/`onToggleVoice`) or the relocated New chat.

---

### 8. Eval Harness — Offline Modules (in-gate) + Live Run (out-of-gate)

The Langfuse-backed eval harness (`spec/eval-harness/`) adds a second, orthogonal
kind of testing: it scores answer **quality**, not UI structure. It splits cleanly
across the gate boundary.

**In the normal Vitest gate** — pure, offline, no network. These run as part of
`npm run test:run` like any other unit test:

| Target | What to assert |
|--------|---------------|
| `src/lib/eval/retrievalMetrics.ts` | recall/precision/MRR table cases; empty-expected; off-topic inversion; slug-order independence |
| `src/lib/eval/citationMetrics.ts` | in-range/out-of-range markers; no-retrieval ⇒ no-marker; coverage ratio; glue/strip round-trip |
| `src/lib/eval/judge.ts` | prompt builder includes question/excerpts/answer; strict-JSON parse; malformed JSON → one retry → failed item (SDK mocked) |
| `src/lib/eval/baseline.ts` | tolerance edges (at / just below); improvement; metric absent from baseline; missing baseline file |
| `src/lib/langfuse.ts` | keys unset ⇒ no-op (no network, no throw); trace helper swallows internal errors |
| `src/lib/answerPipeline.ts` | system blocks byte-identical to the pre-extraction route assembly; constants exported |

**NOT in the gate — `npm run eval` is a live-API experiment run.** It calls the
real Anthropic API (generation + LLM judge) and reads Supabase pgvector, so it
spends real tokens and needs `ANTHROPIC_API_KEY` + `DATABASE_URL` (and
`LANGFUSE_*` to record the run). It is **never part of `npm run test:run`** — the
Vitest suite stays fully offline. Run it manually before merging changes that
touch retrieval, prompts, or citations. (It also wants **Node 22**, not 24 — see
`spec/eval-harness/spec.md` §3.)

**Baseline-gate semantics.** `eval/baseline.json` is committed. Each `npm run eval`
prints a baseline-vs-current diff table and **exits non-zero** if any metric drops
below `baseline − tolerance` (deterministic ≤0.02; judge dims 0.3). Re-blessing the
baseline is a deliberate act: `npm run eval:accept` copies the latest run's
aggregates into `eval/baseline.json` as a reviewable git diff — the baseline never
moves silently. Managed-evaluator setup on prod traces: `spec/eval-harness/langfuse-setup.md`.

---

## Green-Bar Definition of Done

All of the following must be true before the cleanup is considered complete:

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
