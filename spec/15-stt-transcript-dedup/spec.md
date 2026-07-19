# STT Transcript De-duplication — Design Spec

> **Status:** Design approved 2026-06-19. Next: implementation plan (`superpowers:writing-plans`).
> **Issue:** [#30](https://github.com/uzampogn/ai-tutor-elevenlabs/issues/30) — mobile STT transcript accumulates/duplicates.

**Goal:** Fix the mobile speech-to-text bug where the live transcript **accumulates/duplicates** as the user speaks — `"good itgood it firstgood it first on the skill…"` — so the transcript updates as a single, monotonically-growing string on every engine, while keeping desktop STT behaviour and the existing voice UX (continuous capture + 2.5 s silence auto-send) byte-for-byte the same.

---

## Background — what breaks today

`src/components/main/useSpeechRecognition.ts` drives the Web Speech API with `continuous = true` + `interimResults = true`, and accumulates finalized text with:

```ts
if (result.isFinal) committedRef.current += transcript;   // line ~113
```

This assumes each finalized result is a **new, distinct segment** appended once, and that `event.resultIndex` advances past finalized results. That holds on desktop Chrome. On mobile (Android Chrome / in-app webviews), two things break it:

1. **Incremental re-finalization (dominant cause).** The engine re-emits `result[0]` as `isFinal = true` *repeatedly with growing text* (`"good it"` → `"good it first"` → `"good it first on the skill"`), all at `resultIndex = 0`. The `+=` stacks every emission, producing the run-on duplication.
2. **`onend` auto-restart churn.** `continuous` is unreliable on mobile; the engine ends after each pause, and `onend` (lines ~122–134) restarts it via `recognition.start()` **without resetting** the accumulators (only the user-initiated `start()` resets them). So finalized text from each restarted session piles onto the previous.

The bug lives entirely in the STT hook; it is unrelated to the mobile-responsive layout work (PR #29), which simply made the voice dock reachable on mobile so the bug surfaced.

### Test-harness note

The existing test *"each new result resets the silence timer"* (`useSpeechRecognition.test.tsx:216–231`) feeds two `isFinal` events **both at `resultIndex = 0`, each a single-result list**, and expects them appended (`'part one ' + 'part two'`). That mock does **not** model the real API, where `event.results` is *cumulative* and `resultIndex` advances — it actually mirrors the buggy mobile re-emit pattern while asserting the buggy append. The fix must correct this mock to model cumulative results.

---

## Approach — rebuild the transcript from cumulative results

Stop accumulating with `+=`. The Web Speech API's `event.results` is a **cumulative list for the session**; the correct transcript is a *projection* of that list, recomputed each event — not a running sum of deltas. Re-emitting a growing `result[0]` then **replaces** instead of stacking.

To preserve text across the `onend` auto-restart (where a new session resets `event.results`), carry finalized text from ended sessions in a separate accumulator.

### Ref model (replaces the single `committedRef`)

| Ref | Meaning | Reset when |
|---|---|---|
| `priorSessionsRef` | Final text from **earlier** engine sessions, folded forward on each `onend` restart. | user `start()` |
| `sessionFinalRef` | The **current** session's final text, rebuilt from `event.results` each `onresult`. | user `start()`; folded into `priorSessionsRef` on `onend` restart |
| `interimRef` | Current non-final tail (unchanged role). | user `start()` |

The full live transcript is always `priorSessionsRef + sessionFinalRef + interimRef`.

### `onresult(event)` — rebuild, don't accumulate

```
sessionFinal = ''; interim = ''
for i in 0 .. event.results.length - 1:          // from 0 every event
  (results[i].isFinal ? sessionFinal : interim) += results[i][0].transcript
sessionFinalRef = sessionFinal
interimRef      = interim
running = (priorSessionsRef + sessionFinal + interim).trim()
if running: onInterim(running)
armSilenceTimer()
```

Iterating from `0` (not `resultIndex`) and assigning (not `+=`) makes the result idempotent: re-emitting `result[0]` with longer text yields the new text, never a concatenation of every emission.

### `onend` — fold the ended session forward before restart

```
if shouldListen:
  priorSessionsRef += sessionFinalRef     // keep what was said
  sessionFinalRef   = ''                  // next session rebuilds its own
  recognition.start()
else:
  setListening(false)
```

This is the cross-restart fix: text already finalized survives the restart (no loss) and is not re-added by the next session's rebuild (no duplication).

### `commit` / `start`

- `commit`: send `(priorSessionsRef + sessionFinalRef + interimRef).trim()` (same shape as today, new refs); on success reset all three.
- `start`: reset all three refs to `''`.

`continuous` stays `true`. Desktop STT is unchanged: for a well-behaved cumulative engine, the rebuilt projection equals the old accumulated value.

---

## Testing strategy

`useSpeechRecognition.test.tsx`:

1. **Correct the existing "rolling window" test.** Add a cumulative-results helper so two utterances in one session are `results = [r0(final), r1(final)]` with advancing `resultIndex`; assert `onFinal` = `'part one part two'` (same expectation, now modelling the real API).
2. **Regression — mobile re-emit (the bug).** Fire `onresult` three times with `result[0]` `isFinal` and growing (`'good it'`, `'good it first'`, `'good it first on the skill'`); after silence, assert `onFinal` = `'good it first on the skill'` — **no duplication**.
3. **Regression — cross-restart.** Session-1 final `'hello '`; `onend` while `shouldListen`; session-2 final `'world'`; commit ⇒ `'hello world'` (not `'hellohello world'`, not `'world'`).
4. All existing tests stay green (interim fires, silence timer, `sendNow`, disable/abort, restart-on-end).

**Validation limits.** Android STT cannot be reproduced in the local/jsdom or desktop-Playwright environments, so the regression tests *model* the re-emit and restart patterns that the device exhibits. Final confirmation is the user re-testing the Vercel preview after merge.

---

## Global constraints

- **Desktop STT byte-identical** — no behavioural change for a standards-compliant cumulative engine.
- **No UX change** — `continuous = true`, `interimResults = true`, and the 2.5 s silence auto-send are preserved.
- **No new dependencies.**
- **Quality gate:** `npm run typecheck`, `npm run test:run`, `npm run lint` all pass.

## Files touched

| File | Change |
|---|---|
| `src/components/main/useSpeechRecognition.ts` | Replace `committedRef` accumulation with the `priorSessionsRef` / `sessionFinalRef` rebuild model in `onresult`, `onend`, `commit`, `start`. |
| `src/components/main/useSpeechRecognition.test.tsx` | Cumulative-results helper; fix the rolling-window mock; add the two regression tests. |

## Out of scope (YAGNI)

- Disabling `continuous` on mobile or any mobile-specific STT branch.
- Changing the silence-timeout, language, or auto-send UX.
- Reworking the desktop voice flow.

## Acceptance criteria

- On a mobile engine that re-emits a growing final `result[0]`, the transcript shows a single monotonic string — no `"good itgood it first…"` duplication.
- Text spoken before an `onend` auto-restart is preserved exactly once across the restart.
- Existing and new tests pass; `npm run typecheck`, `npm run test:run`, `npm run lint` are green.
- Desktop voice input is unchanged.
