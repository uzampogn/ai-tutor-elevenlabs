# STT Silence Timeout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the user a comfortable ~2.5s pause before voice input auto-sends, with a tap-the-orb gesture to send immediately.

**Architecture:** Switch the Web Speech API recognizer to `continuous = true` so the browser never ends the turn, accumulate the transcript in refs, and run our own rolling silence timer in `useSpeechRecognition.ts`. The timer (or an explicit `sendNow()`) is the only send path. `VoiceDock` wires an orb tap to `sendNow()` while listening.

**Tech Stack:** Next.js 14, React 18, TypeScript, Web Speech API (`SpeechRecognition`), Vitest + @testing-library/react.

**Spec:** [`spec.md`](./spec.md)

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/components/main/useSpeechRecognition.ts` | Owns recognition lifecycle + the silence timer + transcript accumulation. Exposes `toggle` / `sendNow`. | Modify (near-rewrite of the mount effect) |
| `src/components/main/useSpeechRecognition.test.tsx` | Unit tests for the hook. | Modify (add silence-timer tests; replace the immediate-final test) |
| `src/components/main/VoiceDock.tsx` | Wires the hook to the orb; orb tap = start / send-now. | Modify (~2 lines) |
| `src/components/main/VoiceDock.test.tsx` | Component tests for VoiceDock. | Modify (final-transcript path now timer-driven; add tap-to-send) |

No new files. `Orb.tsx` is untouched (it just calls `onClick`).

---

## Task 1: Silence timer core (continuous mode + accumulate + send on silence)

Switch to continuous recognition, accumulate the transcript, and send only after `SILENCE_TIMEOUT_MS` of no new results. Empty transcript on timer-fire keeps listening (no empty sends). Restart if the browser ends the session early. `sendNow` comes in Task 2.

**Files:**
- Modify: `src/components/main/useSpeechRecognition.ts`
- Test: `src/components/main/useSpeechRecognition.test.tsx`

- [ ] **Step 1: Add test helpers + replace the immediate-final test with timer tests**

In `src/components/main/useSpeechRecognition.test.tsx`, change the import line:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

Add these module-level helpers just below the imports (above the `Harness` component). They build a recognition-result event and render the hook while capturing the live recognition instance:

```tsx
function makeResultEvent(transcript: string, isFinal: boolean, resultIndex = 0): SpeechRecognitionEvent {
  return {
    resultIndex,
    results: Object.assign(
      [
        Object.assign([{ transcript, confidence: 1 }], {
          isFinal,
          length: 1,
          item: () => ({ transcript, confidence: 1 }),
        }),
      ],
      { length: 1, item: (i: number) => ([] as SpeechRecognitionResult[])[i] },
    ) as SpeechRecognitionResultList,
  } as unknown as SpeechRecognitionEvent;
}

function renderWithInstance(
  args: Omit<HarnessProps, 'onResult'>,
): {
  instance: () => SpeechRecognition;
  hook: () => { supported: boolean; toggle: () => void; sendNow?: () => void };
  restore: () => void;
} {
  let captured: SpeechRecognition | undefined;
  let hookResult: { supported: boolean; toggle: () => void; sendNow?: () => void } | undefined;
  const OrigCtor = window.SpeechRecognition!;
  const MockCtor = vi.fn().mockImplementation(() => {
    const inst = new OrigCtor();
    captured = inst;
    return inst;
  }) as unknown as SpeechRecognitionStatic;
  window.SpeechRecognition = MockCtor;
  render(<Harness {...args} onResult={(r) => { hookResult = r as typeof hookResult; }} />);
  return {
    instance: () => captured!,
    hook: () => hookResult!,
    restore: () => { window.SpeechRecognition = OrigCtor; },
  };
}
```

Delete the existing test `it('onFinal callback fires when recognition produces a final result', ...)` (lines 81–127) — that behavior is now timer-driven and is covered below.

Add this new describe block at the end of the file (inside the outer `describe('useSpeechRecognition', ...)`):

```tsx
describe('silence timer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('does not send before 2.5s of silence, then sends', () => {
    const onFinal = vi.fn();
    const { instance, restore } = renderWithInstance({
      listening: true, setListening: vi.fn(), onInterim: vi.fn(), onFinal,
    });

    act(() => { instance().onresult?.(makeResultEvent('hello there', true)); });
    act(() => { vi.advanceTimersByTime(2400); });
    expect(onFinal).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(200); }); // crosses 2500ms
    expect(onFinal).toHaveBeenCalledWith('hello there');
    restore();
  });

  it('each new result resets the silence timer (rolling window)', () => {
    const onFinal = vi.fn();
    const { instance, restore } = renderWithInstance({
      listening: true, setListening: vi.fn(), onInterim: vi.fn(), onFinal,
    });

    act(() => { instance().onresult?.(makeResultEvent('part one ', true)); });
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { instance().onresult?.(makeResultEvent('part two', true)); });
    act(() => { vi.advanceTimersByTime(2000); }); // 4000ms total, but only 2000 since last result
    expect(onFinal).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(600); });
    expect(onFinal).toHaveBeenCalledWith('part one part two');
    restore();
  });

  it('does not send an empty transcript when the timer fires', () => {
    const onFinal = vi.fn();
    const setListening = vi.fn();
    const { restore } = renderWithInstance({
      listening: true, setListening, onInterim: vi.fn(), onFinal,
    });

    act(() => { vi.advanceTimersByTime(3000); }); // silence, nothing said
    expect(onFinal).not.toHaveBeenCalled();
    expect(setListening).not.toHaveBeenCalledWith(false);
    restore();
  });

  it('restarts recognition when the browser ends the session while still listening', () => {
    const { instance, restore } = renderWithInstance({
      listening: true, setListening: vi.fn(), onInterim: vi.fn(), onFinal: vi.fn(),
    });
    // toggle(start) marks shouldListen=true and calls start() once.
    act(() => { renderWithInstance; }); // no-op to keep act import used
    act(() => { instance().onresult?.(makeResultEvent('typing', false)); });
    const startCallsBefore = (instance().start as ReturnType<typeof vi.fn>).mock.calls.length;
    act(() => { instance().onend?.(new Event('end') as unknown as Event); });
    const startCallsAfter = (instance().start as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(startCallsAfter).toBeGreaterThan(startCallsBefore);
    restore();
  });
});
```

Note on the restart test: the hook restarts on `onend` only when `shouldListenRef` is true. `shouldListenRef` becomes true when `toggle()` starts a session. Drive that in the test by calling the hook's `toggle()` first; rewrite the restart test body to:

```tsx
  it('restarts recognition when the browser ends the session while still listening', () => {
    const { instance, hook, restore } = renderWithInstance({
      listening: false, setListening: vi.fn(), onInterim: vi.fn(), onFinal: vi.fn(),
    });
    act(() => { hook().toggle(); }); // start → shouldListen = true, start() called once
    const before = (instance().start as ReturnType<typeof vi.fn>).mock.calls.length;
    act(() => { instance().onend?.(new Event('end') as unknown as Event); });
    const after = (instance().start as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(after).toBe(before + 1);
    restore();
  });
```

(Use this second version; drop the first restart-test draft.)

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm run test:run -- useSpeechRecognition`
Expected: FAIL — the silence-timer tests fail because the current hook calls `onFinal` synchronously inside `onresult` (so `onFinal` is already called before any timer advance, and the rolling/empty/restart behaviors don't exist).

- [ ] **Step 3: Rewrite `useSpeechRecognition.ts` with the silence timer**

Replace the entire contents of `src/components/main/useSpeechRecognition.ts` with:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

/** Silence (no new speech result) after which we auto-send. Tunable. */
const SILENCE_TIMEOUT_MS = 2500;

export interface UseSpeechRecognitionOptions {
  listening: boolean;
  setListening: (v: boolean) => void;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  disabled?: boolean;
}

export interface UseSpeechRecognitionResult {
  supported: boolean;
  toggle: () => void;
}

export function useSpeechRecognition({
  listening,
  setListening,
  onInterim,
  onFinal,
  disabled = false,
}: UseSpeechRecognitionOptions): UseSpeechRecognitionResult {
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Accumulated transcript + silence-timer state for the current turn.
  const committedRef = useRef('');
  const interimRef = useRef('');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether we *intend* to be listening — lets onend tell a deliberate stop
  // (commit / cancel / disable) apart from the browser ending the session
  // early, so we can restart and not silently cut the user off.
  const shouldListenRef = useRef(false);

  // Imperative API built once inside the mount effect; toggle() calls through it.
  const apiRef = useRef<{ start: () => void; stop: () => void } | null>(null);

  // Latest callbacks held in a ref so the recognition instance is built once
  // but its handlers always call current props.
  const cb = useRef({ onInterim, onFinal, setListening });
  cb.current = { onInterim, onFinal, setListening };

  // Feature-detect and construct the recognition instance once on mount.
  useEffect(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      return;
    }

    const recognition = new Ctor();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;

    function clearSilenceTimer() {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    }

    function stop() {
      shouldListenRef.current = false;
      clearSilenceTimer();
      recognition.stop();
      cb.current.setListening(false);
    }

    function commit() {
      clearSilenceTimer();
      const text = (committedRef.current + interimRef.current).trim();
      if (!text) return; // nothing said yet — keep listening; next result re-arms
      committedRef.current = '';
      interimRef.current = '';
      stop();
      cb.current.onFinal(text);
    }

    function armSilenceTimer() {
      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(commit, SILENCE_TIMEOUT_MS);
    }

    function start() {
      committedRef.current = '';
      interimRef.current = '';
      shouldListenRef.current = true;
      try {
        recognition.start();
        cb.current.setListening(true);
      } catch {
        // start() throws if a session is already active; ignore.
      }
    }

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

    recognition.onerror = () => {
      shouldListenRef.current = false;
      clearSilenceTimer();
      cb.current.setListening(false);
    };

    recognitionRef.current = recognition;
    apiRef.current = { start, stop };

    return () => {
      clearSilenceTimer();
      shouldListenRef.current = false;
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.abort();
      recognitionRef.current = null;
      apiRef.current = null;
    };
  }, []);

  // Stop listening if the shell disables the mic (e.g. a send started).
  useEffect(() => {
    if (disabled && listening) {
      shouldListenRef.current = false;
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      recognitionRef.current?.abort();
      setListening(false);
    }
  }, [disabled, listening, setListening]);

  function toggle() {
    if (!apiRef.current) return;
    if (listening) apiRef.current.stop();
    else apiRef.current.start();
  }

  return { supported, toggle };
}
```

- [ ] **Step 4: Run the hook tests to verify they pass**

Run: `npm run test:run -- useSpeechRecognition`
Expected: PASS — all silence-timer tests plus the retained `supported` / `onInterim` / `toggle` / disabled-abort tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/main/useSpeechRecognition.ts src/components/main/useSpeechRecognition.test.tsx
git commit -m "feat(stt): continuous mode + 2.5s silence timer before auto-send"
```

---

## Task 2: `sendNow()` + explicit empty-cancel

Add the imperative `sendNow()` used by the orb tap: send immediately if there are words, otherwise (explicit tap with nothing said) cancel and stop listening.

**Files:**
- Modify: `src/components/main/useSpeechRecognition.ts`
- Test: `src/components/main/useSpeechRecognition.test.tsx`

- [ ] **Step 1: Write failing tests for `sendNow`**

Add to the `describe('silence timer', ...)` block in `useSpeechRecognition.test.tsx`:

```tsx
  it('sendNow() sends the transcript immediately, cancelling the countdown', () => {
    const onFinal = vi.fn();
    const { instance, hook, restore } = renderWithInstance({
      listening: true, setListening: vi.fn(), onInterim: vi.fn(), onFinal,
    });

    act(() => { instance().onresult?.(makeResultEvent('send me now', true)); });
    act(() => { hook().sendNow!(); });
    expect(onFinal).toHaveBeenCalledWith('send me now');

    onFinal.mockClear();
    act(() => { vi.advanceTimersByTime(3000); }); // timer must not fire a second send
    expect(onFinal).not.toHaveBeenCalled();
    restore();
  });

  it('sendNow() with no transcript cancels: stops listening, sends nothing', () => {
    const onFinal = vi.fn();
    const setListening = vi.fn();
    const { hook, restore } = renderWithInstance({
      listening: true, setListening, onInterim: vi.fn(), onFinal,
    });

    act(() => { hook().sendNow!(); });
    expect(onFinal).not.toHaveBeenCalled();
    expect(setListening).toHaveBeenCalledWith(false);
    restore();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:run -- useSpeechRecognition`
Expected: FAIL — `hook().sendNow` is `undefined` (not yet returned).

- [ ] **Step 3: Add `cancelIfEmpty` + `sendNow` to the hook**

In `src/components/main/useSpeechRecognition.ts`:

Change the result interface:

```tsx
export interface UseSpeechRecognitionResult {
  supported: boolean;
  toggle: () => void;
  sendNow: () => void;
}
```

Change the `apiRef` type to include `sendNow`:

```tsx
  const apiRef = useRef<{ start: () => void; stop: () => void; sendNow: () => void } | null>(null);
```

Change `commit` to take a flag, and `armSilenceTimer` to pass `false`:

```tsx
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

    function armSilenceTimer() {
      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(() => commit(false), SILENCE_TIMEOUT_MS);
    }
```

Expose `sendNow` on the api object:

```tsx
    recognitionRef.current = recognition;
    apiRef.current = { start, stop, sendNow: () => commit(true) };
```

Add the returned `sendNow` (just above `return { ... }`):

```tsx
  function sendNow() {
    apiRef.current?.sendNow();
  }

  return { supported, toggle, sendNow };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:run -- useSpeechRecognition`
Expected: PASS — all hook tests including the two new `sendNow` cases.

- [ ] **Step 5: Commit**

```bash
git add src/components/main/useSpeechRecognition.ts src/components/main/useSpeechRecognition.test.tsx
git commit -m "feat(stt): add sendNow() for immediate send / empty-cancel"
```

---

## Task 3: Wire the orb tap to `sendNow` in VoiceDock

A tap while listening sends immediately; a tap while idle starts listening.

**Files:**
- Modify: `src/components/main/VoiceDock.tsx`
- Test: `src/components/main/VoiceDock.test.tsx`

- [ ] **Step 1: Update the final-transcript test + add a tap-to-send test**

In `src/components/main/VoiceDock.test.tsx`:

Add `beforeEach`/`afterEach` to the vitest import:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

Replace the whole `describe('VoiceDock — final transcript path', ...)` block with a timer-aware version plus a tap-to-send test:

```tsx
describe('VoiceDock — send paths', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  function renderWithInstance(props: React.ComponentProps<typeof VoiceDock>) {
    let captured: SpeechRecognition | undefined;
    const OrigCtor = window.SpeechRecognition!;
    const MockCtor = vi.fn().mockImplementation(() => {
      const inst = new OrigCtor();
      captured = inst;
      return inst;
    }) as unknown as SpeechRecognitionStatic;
    window.SpeechRecognition = MockCtor;
    render(<VoiceDock {...props} />);
    return { instance: () => captured!, restore: () => { window.SpeechRecognition = OrigCtor; } };
  }

  function finalResult(transcript: string): SpeechRecognitionEvent {
    return {
      resultIndex: 0,
      results: Object.assign(
        [
          Object.assign([{ transcript, confidence: 1 }], {
            isFinal: true,
            length: 1,
            item: () => ({ transcript, confidence: 1 }),
          }),
        ],
        { length: 1, item: (i: number) => ([] as SpeechRecognitionResult[])[i] },
      ) as SpeechRecognitionResultList,
    } as unknown as SpeechRecognitionEvent;
  }

  it('calls onSend after the silence window, not immediately', () => {
    const onSend = vi.fn();
    const { instance, restore } = renderWithInstance({
      input: '', setInput: vi.fn(), isLoading: false, listening: true,
      setListening: vi.fn(), onSend, speaking: false,
    });

    act(() => { instance().onresult?.(finalResult('test question'); }); // see note
    expect(onSend).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2600); });
    expect(onSend).toHaveBeenCalledWith('test question');
    restore();
  });

  it('tapping the orb while listening sends immediately', async () => {
    const onSend = vi.fn();
    const { instance, restore } = renderWithInstance({
      input: '', setInput: vi.fn(), isLoading: false, listening: true,
      setListening: vi.fn(), onSend, speaking: false,
    });

    act(() => { instance().onresult?.(finalResult('hello')); });
    act(() => { screen.getByRole('button', { name: 'Stop listening' }).click(); });
    expect(onSend).toHaveBeenCalledWith('hello');
    restore();
  });
});
```

Fix the obvious paren typo when typing it in — the result-firing line must read:

```tsx
    act(() => { instance().onresult?.(finalResult('test question')); });
```

(The orb's aria-label while `listening` is `Stop listening`, per `Orb.tsx`; use `.click()` inside `act` rather than `userEvent` because fake timers are active.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:run -- VoiceDock`
Expected: FAIL — the tap-to-send test fails because the orb currently calls `toggle` (which stops without sending), so `onSend` is not called on tap.

- [ ] **Step 3: Wire `sendNow` into the orb**

In `src/components/main/VoiceDock.tsx`, destructure `sendNow` and use it for the orb tap when listening.

Change:

```tsx
  const { supported, toggle } = useSpeechRecognition({
```

to:

```tsx
  const { supported, toggle, sendNow } = useSpeechRecognition({
```

Change the orb element:

```tsx
      <Orb state={orbState} onClick={toggle} disabled={isLoading || !supported} />
```

to:

```tsx
      {/* Tap while listening = send now; tap while idle = start listening. */}
      <Orb
        state={orbState}
        onClick={listening ? sendNow : toggle}
        disabled={isLoading || !supported}
      />
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:run -- VoiceDock`
Expected: PASS — both send-path tests plus the retained orb-state / interaction / unsupported tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/main/VoiceDock.tsx src/components/main/VoiceDock.test.tsx
git commit -m "feat(stt): tap orb to send immediately while listening"
```

---

## Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: clean (no errors).

- [ ] **Step 2: Full test suite**

Run: `npm run test:run`
Expected: all green.

- [ ] **Step 3: Manual check in the dev server**

Run: `PORT=3838 npm run dev`, open `http://localhost:3838`, Voice mode. Verify:
- Speak with a ~1.5s mid-sentence pause → keeps listening, transcript grows, no premature send.
- Stop talking → request fires once after ~2.5s.
- Tap the orb mid-listening → sends immediately.
- Tap the orb with nothing said → listening stops, no empty request.

- [ ] **Step 4: Production build (only after stopping dev)**

Stop the `next dev` process first (a prod build against a live dev server corrupts `.next`).
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(stt): verification fixups for silence timeout"
```

(Skip if Tasks 1–3 left a clean tree.)

---

## Self-Review

**Spec coverage:**
- 2.5s silence window → `SILENCE_TIMEOUT_MS` + Task 1. ✅
- Continuous mode + own timer (Approach A) → Task 1. ✅
- Accumulate transcript; show running transcript via `onInterim` → Task 1 `onresult`. ✅
- No empty sends on timer-fire → Task 1 `commit` empty-guard + test. ✅
- `sendNow` / tap-to-send → Task 2 (hook) + Task 3 (wiring) + tests. ✅
- Empty + explicit tap = cancel → Task 2 `cancelIfEmpty` + test. ✅
- Restart on unexpected `onend` → Task 1 `onend` + test. ✅
- Timer cleanup on disable/unmount → Task 1 cleanup + disabled effect. ✅
- No visual changes (`Orb.tsx` untouched) → confirmed; only `VoiceDock.tsx` onClick prop changes. ✅
- Tests with fake timers, existing mock unchanged → Tasks 1–3. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the one deliberate typo in the test draft is explicitly corrected in the same step. ✅

**Type consistency:** `committedRef`/`interimRef`/`silenceTimerRef`/`shouldListenRef`/`apiRef` names are consistent across tasks. `commit()` (no-arg, Task 1) → `commit(cancelIfEmpty: boolean)` (Task 2) — the signature change is explicit in Task 2 Step 3, and `armSilenceTimer` is updated in the same step to call `commit(false)`. `sendNow` added to both `UseSpeechRecognitionResult` and `apiRef` in Task 2. ✅
