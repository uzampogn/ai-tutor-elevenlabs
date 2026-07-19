# Spec 06 — User-scroll override + resume affordance

**Series:** [Read-Along TTS](./00-overview.md) · **Milestone:** User override
**Status:** 📋 Proposed · **Date:** 2026-06-14
**Depends on:** `05` · **Unblocks:** `07` (inherits the override)
**User-visible change:** if the user scrolls during read-along, the app **stops auto-following** and shows a small **"Resume following"** affordance; highlighting continues regardless.

---

## Goal

Make follow-scroll cooperative instead of hostile. The single most important interaction detail in any read-along UI: the instant the user takes manual control of the scroll, the app must **stop fighting them**, while still highlighting the spoken text. A lightweight affordance lets them snap back to the voice when ready.

---

## Context

- Spec 05 added continuous follow-scroll and an `isAutoScrolling` flag that marks scrolls the controller itself initiates. This spec uses that flag to distinguish **user** scrolls from **programmatic** ones.
- Scroll happens on `.scroll` (`globals.css:225`). Input sources to treat as "user took control": `wheel`, `touchmove`, keyboard paging (`PageUp/Down`, arrows, `Space`, `Home/End`), and dragging the scrollbar — all surface as `scroll` events not tagged `isAutoScrolling`.

---

## Design

### State machine
Per active read-along session:
```
following ──user scroll──> paused ──(Resume click | new playback)──> following
```
- **`following`** (default): Spec 05 keeps the active sentence in the band.
- **`paused`**: the controller **stops issuing follow scrolls**. Highlight (`.s-active`/`.s-read`, and words in Spec 07) **keeps updating** — the user can still read along visually wherever they've scrolled.

### Detecting a user scroll
- Listen for `scroll` on `.scroll`. If a `scroll` fires while `isAutoScrolling` is **false**, it's the user → set `paused=true`.
- Debounce/guard the controller's own smooth scrolls: keep `isAutoScrolling=true` from the moment the controller calls `scrollTo` until `scrollend` (or a ~150ms fallback timer for browsers without `scrollend`). This prevents the smooth-scroll's own intermediate `scroll` events from being misread as user input. (Programmatic-scroll detection is notoriously finicky — prefer the explicit flag + `scrollend` over position-diffing heuristics.)
- Also accept explicit intent signals directly (`wheel`, `touchstart`, relevant `keydown`) as immediate pause triggers, which is more robust than inferring from `scroll` alone.

### Resume affordance
- A small pill, e.g. **"↓ Resume following"**, fixed near the bottom-center of `.scroll` (above the voice dock), shown only while `paused` **and** audio is still playing.
- Click → `paused=false`, re-center on the current active sentence (band logic), resume follow.
- Auto-dismiss/auto-resume when: audio ends, the user sends a new message, or a new answer starts playing (each new playback begins in `following`).
- Keyboard accessible (focusable button, `aria-label="Resume following the narration"`); announced politely. Reduced-motion: appears without animation.

### Styling (Aurora Mist locked)
- New class `.follow-resume` (and maybe `.is-visible`). Reuse tokens: frosted pill consistent with existing chips/buttons (`--panel`, `--line`, `--accent-strong` text/icon). No new accent hex. Match the existing button/chip vocabulary so it feels native.

### Edge cases
- User scrolls, then audio ends before they resume → hide the pill, clear highlight (Spec 04 cleanup) as normal.
- User scrolls **back** into the band manually → stay `paused` (don't silently re-grab control); they can click Resume. (Avoid surprising re-engagement.)
- Multiple rapid messages → each new playback resets to `following` and removes any stale pill.

---

## Test plan

### Component — `useReadAlong.test.tsx` (extend)
| Assert | Detail |
|---|---|
| User scroll pauses | A `scroll`/`wheel` event while `isAutoScrolling=false` → `paused=true`, and subsequent active-sentence changes issue **no** follow scroll. |
| Programmatic scroll ignored | A `scroll` event during the controller's own scroll (`isAutoScrolling=true`) does **not** pause. |
| Highlight continues when paused | Active/read classes still update while `paused`. |
| Resume | Invoking resume → `paused=false`, re-centers on the current sentence, follow resumes. |
| Auto-resume | `audio.ended` / new playback → state returns to `following`, pill hidden. |

### Component — affordance render test
| Assert | Detail |
|---|---|
| Visibility | Pill renders only when `paused && playing`; hidden otherwise. |
| Click wiring | Click invokes resume (via `vi.fn()`); button is focusable with the right `aria-label`. |
| Reduced-motion | Renders without animation under the reduce mock. |

### Token regression — `globals.tokens.test.ts`
- `.follow-resume` present; no new accent hex; palette table intact.

### Manual / Playwright
- During a long read-along, scroll up with the wheel → following stops, pill appears, highlight keeps moving. Click the pill → snaps back to the active sentence and resumes following. Let audio end while paused → pill disappears. Keyboard `PageUp` also pauses.

---

## Definition of Done
- Manual scroll (wheel/touch/keyboard/scrollbar) reliably pauses follow without false-positives from the controller's own smooth scrolls.
- Resume pill appears only when relevant, restores following, and is keyboard+SR accessible.
- New playback always starts in `following`. Reduced-motion + token lock honored. `test:run` / `tsc` / `build` green.

---

## Files touched
- **Modified:** `src/components/main/useReadAlong.ts` (follow/paused state machine, user-scroll detection via `isAutoScrolling` + `scrollend`), `src/components/main/useReadAlong.test.tsx`.
- **New:** `src/components/main/FollowResume.tsx` (the pill) + `FollowResume.test.tsx`.
- **Modified:** `src/components/main/Thread.tsx` (mount the pill within `.scroll`), `src/app/globals.css` (`.follow-resume`), `src/app/globals.tokens.test.ts`.

---

## Out of scope
- Word-level highlight — Spec `07` (it inherits this override unchanged).
- A persistent "auto-follow on/off" user preference — possible follow-up; this spec is per-session.
