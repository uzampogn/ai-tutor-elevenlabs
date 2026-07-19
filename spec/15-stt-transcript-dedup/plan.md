# STT Transcript De-duplication — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Spec:** `spec/stt-transcript-dedup/spec.md`. **Issue:** #30. Execute in the `fix/stt-transcript-dedup` worktree (off `main`).

**Goal:** Stop the mobile STT transcript from duplicating (`"good itgood it first…"`) by rebuilding the transcript from the engine's cumulative `event.results` each event instead of accumulating finalized deltas, while keeping desktop STT and the voice UX unchanged.

**Architecture:** Replace the single `committedRef` accumulator in `useSpeechRecognition.ts` with two refs — `priorSessionsRef` (text carried across `onend` auto-restarts) and `sessionFinalRef` (the current session's final, rebuilt from `event.results` each `onresult`). The live transcript is always `priorSessionsRef + sessionFinalRef + interimRef`. A re-emitted growing `result[0]` then replaces instead of stacking.

**Tech Stack:** Next.js 14, React 18.3, TypeScript, Web Speech API, Vitest + React Testing Library. No new dependencies.

## Global Constraints

- **Desktop STT byte-identical** — for a standards-compliant cumulative engine the rebuilt projection equals the old accumulated value; no behavioural change.
- **No UX change** — `continuous = true`, `interimResults = true`, `lang = 'en-US'`, and the 2.5 s silence auto-send (`SILENCE_TIMEOUT_MS`) are preserved.
- **No new npm dependencies.**
- **Quality gate (all must pass before close):** `npm run typecheck`, `npm run test:run`, `npm run lint`.
- **Scope:** only `src/components/main/useSpeechRecognition.ts` and `src/components/main/useSpeechRecognition.test.tsx`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/components/main/useSpeechRecognition.ts` | STT hook — the `onresult` / `onend` / `commit` / `start` transcript logic that changes. |
| `src/components/main/useSpeechRecognition.test.tsx` | Cumulative-results test helper; corrected rolling-window test; two new regression tests. |

---

### Task 1: Cumulative-results test helper + correct the rolling-window mock

The existing rolling-window test feeds two finals **both at `resultIndex = 0`, each a single-result list** — which models the mobile bug, not the real cumulative API. Add an API-accurate helper and fix that test. This is a test-only change that stays green under the current code (a correct cumulative mock works with the existing `+=` because `resultIndex` advances).

**Files:**
- Modify: `src/components/main/useSpeechRecognition.test.tsx`

**Interfaces:**
- Produces: `makeCumulativeEvent(segments: { transcript: string; isFinal: boolean }[], resultIndex?: number): SpeechRecognitionEvent` — builds an event whose `results` is the full cumulative list (used by the regression tests in Task 2).

- [ ] **Step 1: Add the `makeCumulativeEvent` helper**

Add next to the existing `makeResultEvent` helper (after line ~39):

```tsx
/**
 * Build a SpeechRecognitionEvent whose `results` is the full *cumulative* list
 * for the session (the real API contract), unlike `makeResultEvent` which is a
 * single result. `resultIndex` is the first changed index for this event.
 */
function makeCumulativeEvent(
  segments: { transcript: string; isFinal: boolean }[],
  resultIndex = 0,
): SpeechRecognitionEvent {
  const results = segments.map((s) =>
    Object.assign([{ transcript: s.transcript, confidence: 1 }], {
      isFinal: s.isFinal,
      length: 1,
      item: () => ({ transcript: s.transcript, confidence: 1 }),
    }),
  );
  return {
    resultIndex,
    results: Object.assign(results, {
      length: results.length,
      item: (i: number) => results[i] as unknown as SpeechRecognitionResult,
    }) as unknown as SpeechRecognitionResultList,
  } as unknown as SpeechRecognitionEvent;
}
```

- [ ] **Step 2: Rewrite the rolling-window test to use cumulative results**

Replace the body of `it('each new result resets the silence timer (rolling window)', …)` (lines ~216–231) with:

```tsx
    it('each new result resets the silence timer (rolling window)', () => {
      const onFinal = vi.fn();
      const { instance, restore } = renderWithInstance({
        listening: true, setListening: vi.fn(), onInterim: vi.fn(), onFinal,
      });

      act(() => {
        instance().onresult?.(makeCumulativeEvent([{ transcript: 'part one ', isFinal: true }], 0));
      });
      act(() => { vi.advanceTimersByTime(2000); });
      act(() => {
        instance().onresult?.(
          makeCumulativeEvent(
            [{ transcript: 'part one ', isFinal: true }, { transcript: 'part two', isFinal: true }],
            1,
          ),
        );
      });
      act(() => { vi.advanceTimersByTime(2000); }); // 4000ms total, but only 2000 since last result
      expect(onFinal).not.toHaveBeenCalled();

      act(() => { vi.advanceTimersByTime(600); });
      expect(onFinal).toHaveBeenCalledWith('part one part two');
      restore();
    });
```

- [ ] **Step 3: Run the suite — confirm still green**

Run: `npx vitest run src/components/main/useSpeechRecognition.test.tsx`
Expected: PASS (10 tests). The corrected mock works with the current `+=` code because `resultIndex` advances, so this is a pure mock-accuracy fix.

- [ ] **Step 4: Commit**

```bash
git add src/components/main/useSpeechRecognition.test.tsx
git commit -m "test(stt): cumulative-results helper + API-accurate rolling-window mock"
```

---

### Task 2: Rebuild the transcript from cumulative results (de-dup fix)

TDD: add the two regression tests (mobile re-emit fails on current code), then implement the rebuild model so they pass.

**Files:**
- Modify: `src/components/main/useSpeechRecognition.test.tsx` (add two tests)
- Modify: `src/components/main/useSpeechRecognition.ts` (refs + `onresult` / `onend` / `commit` / `start`)

**Interfaces:**
- Consumes: `makeCumulativeEvent` (Task 1), `renderWithInstance`, the `instance()` / `hook()` accessors.
- Produces: no exported API change — `useSpeechRecognition` keeps its `{ supported, toggle, sendNow }` shape; only internal transcript assembly changes.

- [ ] **Step 1: Add the two regression tests**

Inside the `describe('silence timer', …)` block (it uses fake timers), after the existing `'each new result resets the silence timer'` test, add:

```tsx
    it('does not duplicate when the engine re-emits a growing final result[0] (mobile)', () => {
      // Android / in-app webviews re-finalize result[0] repeatedly with growing
      // text, all at resultIndex 0. The transcript must REPLACE, not stack.
      const onFinal = vi.fn();
      const { instance, restore } = renderWithInstance({
        listening: true, setListening: vi.fn(), onInterim: vi.fn(), onFinal,
      });

      act(() => { instance().onresult?.(makeCumulativeEvent([{ transcript: 'good it', isFinal: true }], 0)); });
      act(() => { instance().onresult?.(makeCumulativeEvent([{ transcript: 'good it first', isFinal: true }], 0)); });
      act(() => { instance().onresult?.(makeCumulativeEvent([{ transcript: 'good it first on the skill', isFinal: true }], 0)); });
      act(() => { vi.advanceTimersByTime(2500); });

      expect(onFinal).toHaveBeenCalledWith('good it first on the skill');
      restore();
    });

    it('preserves text across an onend auto-restart without duplicating', () => {
      const onFinal = vi.fn();
      const { instance, hook, restore } = renderWithInstance({
        listening: false, setListening: vi.fn(), onInterim: vi.fn(), onFinal,
      });

      act(() => { hook().toggle(); }); // user start → shouldListen = true
      act(() => { instance().onresult?.(makeCumulativeEvent([{ transcript: 'hello ', isFinal: true }], 0)); });
      act(() => { instance().onend?.(new Event('end') as unknown as Event); }); // browser ends; hook folds + restarts
      act(() => { instance().onresult?.(makeCumulativeEvent([{ transcript: 'world', isFinal: true }], 0)); });
      act(() => { vi.advanceTimersByTime(2500); });

      expect(onFinal).toHaveBeenCalledWith('hello world');
      restore();
    });
```

- [ ] **Step 2: Run — confirm the mobile re-emit test FAILS (the bug)**

Run: `npx vitest run src/components/main/useSpeechRecognition.test.tsx`
Expected: the **mobile re-emit** test FAILS — current code calls `onFinal` with the duplicated `'good itgood it firstgood it first on the skill'`. (The cross-restart test passes under current code; it guards the new `onend` fold.)

- [ ] **Step 3: Replace the accumulator refs**

In `useSpeechRecognition.ts`, replace the `committedRef` declaration (line ~33):

```ts
  // Accumulated transcript + silence-timer state for the current turn.
  const committedRef = useRef('');
  const interimRef = useRef('');
```

with:

```ts
  // Transcript assembly for the current turn. The live transcript is always
  // priorSessionsRef + sessionFinalRef + interimRef.
  //   priorSessionsRef — final text from engine sessions that already ended and
  //     were auto-restarted (continuous mode can end on mobile mid-turn).
  //   sessionFinalRef  — the CURRENT session's final text, rebuilt from the
  //     cumulative event.results each onresult (never accumulated with +=, so a
  //     re-emitted growing result[0] replaces instead of stacking).
  const priorSessionsRef = useRef('');
  const sessionFinalRef = useRef('');
  const interimRef = useRef('');
```

- [ ] **Step 4: Rewrite `commit` to read the new refs**

Replace `commit` (lines ~76–89):

```ts
    function commit(cancelIfEmpty: boolean) {
      clearSilenceTimer();
      const text = (committedRef.current + interimRef.current).trim();
      if (!text) {
        // Timer fire with nothing said: keep listening (next result re-arms).
        // Explicit tap (cancelIfEmpty): treat as cancel — stop listening.
        if (cancelIfEmpty) stop();
        return;
      }
      committedRef.current = '';
      interimRef.current = '';
      stop();
      cb.current.onFinal(text);
    }
```

with:

```ts
    function commit(cancelIfEmpty: boolean) {
      clearSilenceTimer();
      const text = (priorSessionsRef.current + sessionFinalRef.current + interimRef.current).trim();
      if (!text) {
        // Timer fire with nothing said: keep listening (next result re-arms).
        // Explicit tap (cancelIfEmpty): treat as cancel — stop listening.
        if (cancelIfEmpty) stop();
        return;
      }
      priorSessionsRef.current = '';
      sessionFinalRef.current = '';
      interimRef.current = '';
      stop();
      cb.current.onFinal(text);
    }
```

- [ ] **Step 5: Reset the new refs in `start`**

Replace the reset lines at the top of `start` (lines ~97–98):

```ts
      committedRef.current = '';
      interimRef.current = '';
```

with:

```ts
      priorSessionsRef.current = '';
      sessionFinalRef.current = '';
      interimRef.current = '';
```

- [ ] **Step 6: Rewrite `onresult` to rebuild from cumulative results**

Replace the `onresult` handler (lines ~108–120):

```ts
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) committedRef.current += transcript;
        else interim += transcript;
      }
      interimRef.current = interim;
      const running = (committedRef.current + interim).trim();
      if (running) cb.current.onInterim(running);
      armSilenceTimer();
    };
```

with:

```ts
    recognition.onresult = (event) => {
      // event.results is the cumulative list for THIS session. Rebuild the final
      // and interim text from index 0 every event (do not accumulate): some
      // engines (mobile) re-emit a growing final result[0] at index 0, which a
      // running `+=` would stack into "good itgood it first…". Rebuilding makes
      // the result idempotent — the new text replaces the old.
      let sessionFinal = '';
      let interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) sessionFinal += transcript;
        else interim += transcript;
      }
      sessionFinalRef.current = sessionFinal;
      interimRef.current = interim;
      const running = (priorSessionsRef.current + sessionFinal + interim).trim();
      if (running) cb.current.onInterim(running);
      armSilenceTimer();
    };
```

- [ ] **Step 7: Fold the ended session forward in `onend` before restart**

Replace the `onend` handler (lines ~122–134):

```ts
    recognition.onend = () => {
      // Continuous mode can still end (network / browser timeout). If we still
      // intend to listen, restart so the user isn't silently cut off.
      if (shouldListenRef.current) {
        try {
          recognition.start();
        } catch {
          // start() throws if a session is already active; ignore.
        }
      } else {
        cb.current.setListening(false);
      }
    };
```

with:

```ts
    recognition.onend = () => {
      // Continuous mode can still end (network / browser timeout). If we still
      // intend to listen, fold the just-ended session's final text into the
      // carry-over accumulator — so the restarted session (whose event.results
      // resets to empty and is rebuilt from index 0) neither drops it nor
      // double-counts it — then restart so the user isn't silently cut off.
      if (shouldListenRef.current) {
        priorSessionsRef.current += sessionFinalRef.current;
        sessionFinalRef.current = '';
        try {
          recognition.start();
        } catch {
          // start() throws if a session is already active; ignore.
        }
      } else {
        cb.current.setListening(false);
      }
    };
```

- [ ] **Step 8: Run — confirm all tests pass**

Run: `npx vitest run src/components/main/useSpeechRecognition.test.tsx`
Expected: PASS (12 tests) — the mobile re-emit test now gets `'good it first on the skill'`, the cross-restart test gets `'hello world'`, and all pre-existing tests stay green.

- [ ] **Step 9: Commit**

```bash
git add src/components/main/useSpeechRecognition.ts src/components/main/useSpeechRecognition.test.tsx
git commit -m "fix(stt): rebuild transcript from cumulative results to stop mobile duplication (#30)"
```

---

### Task 3: Quality gate + finish branch

**Files:** none (verification only).

- [ ] **Step 1: Full quality gate**

```bash
npm run typecheck && npm run test:run && npm run lint
```
Expected: all green — typecheck clean, full Vitest suite passing (including the STT suite), lint clean apart from the pre-existing `ArticleHero` `<img>` warning.

- [ ] **Step 2: Finish the branch**

Use `superpowers:finishing-a-development-branch`. Push `fix/stt-transcript-dedup` and open a PR against `main` that references the spec, this plan, and closes #30.

---

## Self-review notes (author)

- **Spec coverage:** rebuild model → Task 2 (Steps 3–6); cross-restart fold → Task 2 Step 7; corrected test mock → Task 1; mobile re-emit regression → Task 2 Step 1/8; cross-restart regression → Task 2 Step 1/8; quality gate → Task 3.
- **Type consistency:** refs `priorSessionsRef` / `sessionFinalRef` / `interimRef` used identically across `onresult`, `onend`, `commit`, `start`; `makeCumulativeEvent` signature matches its Task 2 call sites; public hook API (`supported` / `toggle` / `sendNow`) unchanged.
- **RED proof:** the mobile re-emit test fails on current code (Task 2 Step 2) — it is the executable demonstration of issue #30. The cross-restart test additionally guards the new `onend` fold (a naive rebuild without it would drop pre-restart text).
- **Desktop safety:** `continuous`/`interimResults`/`lang` untouched; for a standards-compliant cumulative engine the rebuilt projection equals the previous accumulated value, so desktop output is unchanged.
