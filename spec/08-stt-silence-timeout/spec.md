# Spec — Longer silence window before STT auto-sends

**Project:** AI News Tutor (`Projects/ai-tutor`, Next.js 14 + TS + Tailwind)
**Branch:** `main`
**Status:** 📋 Proposed (not yet implemented)
**Date:** 2026-06-16
**Visual system:** Aurora Mist — **locked** (no palette/font/radius/shadow/`@keyframes` changes)
**Touches:** `src/components/main/useSpeechRecognition.ts`, `src/components/main/VoiceDock.tsx`, tests

---

## Goal

Voice input cuts off before the user finishes a sentence: a short pause is treated as "done"
and the request fires immediately. Give the user a **comfortable ~2.5s pause** to think mid-sentence
before the app auto-sends, while keeping a way to **send right away** (tap the orb) when they're clearly
finished.

Behaviour, before → after:

```
BEFORE: speak …  (brief pause)  → browser decides "final" → SEND immediately   ← cuts you off
AFTER:  speak …  (pause < 2.5s, keep talking) → keeps listening, transcript grows
        speak …  (silence ≥ 2.5s)             → SEND
        speak …  (tap the orb)                → SEND now, don't wait
```

---

## Root cause — the browser owns the cutoff, and it's not configurable

STT uses the browser-native **Web Speech API** via `useSpeechRecognition.ts`. Today it runs in
**non-continuous** mode (`useSpeechRecognition.ts:41-44`):

```ts
recognition.lang = 'en-US';
recognition.interimResults = true;
recognition.continuous = false;   // ← browser auto-stops after its own short silence
```

In `continuous = false` mode the **browser** decides when speech has ended — it emits an `isFinal`
result after a brief, **non-configurable** internal silence window and then fires `onend`. The moment a
final arrives, `VoiceDock.tsx:31-34` sends:

```ts
onFinal: (t) => {
  setInput(t);
  onSend(t);     // ← fires the instant the browser calls "final"
},
```

There is **no Web Speech API knob** to extend that silence window. The only way to control it is to stop
letting the browser end the turn and **run our own silence timer** instead.

---

## Decision — Approach A: continuous mode + our own silence timer

Set `continuous = true` so recognition never auto-stops, accumulate the transcript as the user speaks,
and reset a **2.5s timer on every new result**. When the timer expires (genuine silence) → send. A new
`sendNow()` (wired to the orb tap while listening) sends immediately. All timing lives in one hook and is
unit-testable with fake timers.

Rejected alternatives:
- **B — keep `continuous = false`, debounce the send.** After the browser's premature "final" the
  recognizer has already stopped; catching more speech means restarting it, and the restart gap drops the
  first word(s) of the next phrase. Fragile, lossy. ❌
- **C — server-side streaming STT with tunable endpointing** (Deepgram/Whisper-stream). True configurable
  silence + better accuracy, but a big lift (mic-audio streaming, new infra, latency, per-minute cost) for
  a problem Approach A solves client-side for free. Out of scope now. ❌

---

## Design — `useSpeechRecognition.ts`

A single named constant controls the window:

```ts
/** Silence (no new speech result) after which we auto-send. Tunable. */
const SILENCE_TIMEOUT_MS = 2500;
```

### New internal state (refs, so the recognition instance is still built once)

| Ref | Purpose |
|-----|---------|
| `committedRef: string` | Accumulated **final** transcript segments for the current turn. |
| `interimRef: string` | Latest interim text (uncommitted). |
| `silenceTimerRef: ReturnType<typeof setTimeout> \| null` | The pending auto-send timer. |
| `shouldListenRef: boolean` | Whether we *intend* to be listening — distinguishes a deliberate stop from an unexpected `onend` (used to restart). |

### Recognition config

```ts
recognition.lang = 'en-US';
recognition.interimResults = true;
recognition.continuous = true;   // ← was false
```

### `onresult` — accumulate + (re)arm the timer

Iterate from `event.resultIndex`; append finals to `committedRef`, collect the rest as interim. Surface
the **full running transcript** (`committed + interim`) via `onInterim` so the input box stays live, then
re-arm the silence timer:

```ts
recognition.onresult = (event) => {
  let interim = '';
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const r = event.results[i];
    if (r.isFinal) committedRef.current += r[0].transcript;
    else interim += r[0].transcript;
  }
  interimRef.current = interim;
  const running = (committedRef.current + interim).trim();
  if (running) cb.current.onInterim(running);
  armSilenceTimer();           // every new result pushes the deadline back
};
```

### Silence timer + commit

```ts
function armSilenceTimer() {
  if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
  silenceTimerRef.current = setTimeout(() => {
    silenceTimerRef.current = null;
    commit({ cancelIfEmpty: false });   // genuine silence → send if we have words
  }, SILENCE_TIMEOUT_MS);
}

function commit({ cancelIfEmpty }: { cancelIfEmpty: boolean }) {
  if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  const text = (committedRef.current + interimRef.current).trim();
  committedRef.current = '';
  interimRef.current = '';

  if (!text) {
    // Nothing said yet. On a timer fire: keep listening (the next result re-arms).
    // On an explicit tap (cancelIfEmpty): treat as cancel — stop listening.
    if (cancelIfEmpty) stopListening();
    return;
  }
  stopListening();              // sets shouldListenRef=false, then recognition.stop()
  cb.current.onFinal(text);     // → VoiceDock sets input + onSend
}
```

### `sendNow()` — orb-tap, send immediately

```ts
function sendNow() {
  commit({ cancelIfEmpty: true });   // empty + explicit tap = cancel; otherwise send now
}
```

`sendNow` is added to the hook's return (`{ supported, toggle, sendNow }`).

### Start / stop helpers + restart on unexpected `onend`

```ts
function stopListening() {
  shouldListenRef.current = false;     // mark the stop as intentional
  recognitionRef.current?.stop();
  cb.current.setListening(false);
}

recognition.onend = () => {
  // In continuous mode Chrome can still end the session (network / its own timeout).
  // If we still intend to listen and didn't commit, restart so the user isn't cut off.
  if (shouldListenRef.current) {
    try { recognitionRef.current?.start(); } catch { /* already starting */ }
  } else {
    cb.current.setListening(false);
  }
};

recognition.onerror = () => stopListening();   // errors end the turn (unchanged intent)
```

`toggle()`: when idle → `committedRef/interimRef = ''`, `shouldListenRef = true`, `start()`,
`setListening(true)`. When listening → `stopListening()` (a plain toggle-off cancels without sending; the
*send* path is `sendNow`).

### Cleanup & disabled

- Unmount and the `disabled && listening` effect (`useSpeechRecognition.ts:74-79`): also
  `clearTimeout(silenceTimerRef.current)` and set `shouldListenRef = false` before `abort()`.

---

## Design — `VoiceDock.tsx` (orb tap = send now while listening)

The orb currently calls `toggle` always (`VoiceDock.tsx:51`). Make a tap **while listening** send
immediately; a tap **while idle** still starts listening:

```ts
const { supported, toggle, sendNow } = useSpeechRecognition({ /* …unchanged… */ });
// …
<Orb
  state={orbState}
  onClick={listening ? sendNow : toggle}
  disabled={isLoading || !supported}
/>
```

`onInterim`/`onFinal` callbacks are unchanged — the hook now decides *when* `onFinal` fires. `Orb.tsx`
needs no change (it just calls `onClick`).

---

## Edge cases

| Case | Behaviour |
|------|-----------|
| Pause < 2.5s mid-sentence | Each word re-arms the timer; nothing sends, transcript keeps growing. |
| Silence ≥ 2.5s with words captured | Auto-send the accumulated transcript; stop listening. |
| Silence ≥ 2.5s with **no** words | Timer fires, nothing to send → keep listening (no empty request). |
| Tap orb with words captured | Send immediately, cancel timer, stop listening. |
| Tap orb with no words (cancel) | Stop listening, send nothing. |
| Browser ends session early (`onend`) while still listening | Restart recognition — user isn't silently cut off. |
| Send already in flight (`disabled`/`isLoading`) | Existing abort path runs **and** clears the timer. |
| Unmount | Clear timer, mark intentional, abort. |

---

## Testing — `useSpeechRecognition.test.tsx` (Vitest, fake timers)

The existing mock (`vitest.setup.ts:40-50`) already exposes `continuous`, `interimResults`, `onresult`,
`onend`, `start/stop/abort` — **no mock changes needed**. New cases use `vi.useFakeTimers()`:

1. **Does not send before 2.5s** — fire an interim result; `vi.advanceTimersByTime(2400)` → `onFinal` not
   called; advance past 2500 → `onFinal` called with the transcript.
2. **Each result resets the timer** — interim at t0; advance 2000; another interim; advance 2000 (4000
   total) → not sent; advance 600 → sent. Confirms the window is *rolling*.
3. **Accumulates final segments** — two separate final events, then timer fires → `onFinal` gets both
   segments concatenated.
4. **`sendNow()` sends immediately** — fire a result, call `sendNow()` with no timer advance → `onFinal`
   called now; timer cleared (no double-send after advancing).
5. **Empty + timer fire = no send, still listening** — no results; advance past 2500 → `onFinal` not
   called; `setListening(false)` not called.
6. **Empty + `sendNow()` = cancel** — call `sendNow()` with no transcript → `onFinal` not called;
   `setListening(false)` called.
7. **Restart on unexpected `onend`** — start listening, invoke `onend` with no preceding intentional stop
   → `recognition.start` called again.
8. Keep the existing supported / interim / final / disabled-abort tests green.

---

## Verification

1. **Automated** — `npm run typecheck` clean; `npm run test:run` green (new + existing cases).
2. **Dev server** (`PORT=3838 npm run dev`, load `http://localhost:3838`, Voice mode):
   - Speak a sentence with a ~1.5s pause in the middle → it keeps listening, no premature send; the
     transcript keeps growing in the input.
   - Stop talking → after ~2.5s the request fires once.
   - Mid-listening, tap the orb → sends immediately without waiting.
   - Tap the orb with nothing said → listening stops, no empty request.
3. **Build** — run `npm run build` **only after stopping `next dev`** (a prod build against a live dev
   server corrupts `.next`).

---

## Files touched
- `src/components/main/useSpeechRecognition.ts` — `continuous = true`; `SILENCE_TIMEOUT_MS`; accumulate
  `committed/interim` refs; `armSilenceTimer` / `commit` / `sendNow` / `stopListening`; restart-on-`onend`;
  timer cleanup in unmount + disabled effect; return `sendNow`.
- `src/components/main/VoiceDock.tsx` — destructure `sendNow`; orb `onClick={listening ? sendNow : toggle}`.
- `src/components/main/useSpeechRecognition.test.tsx` — add the fake-timer cases above.

---

## Out of scope
- No UI/visual changes — Aurora Mist orb, palette, type, animations all inherited verbatim (`Orb.tsx`
  untouched).
- No user-facing setting/slider for the duration yet — `SILENCE_TIMEOUT_MS` is one named constant, easy to
  promote to a setting later if wanted.
- No hands-free auto-resume after the AI replies, and no server-side/cloud STT (Approach C).
- Text-mode composer (`Composer.tsx`) send behaviour is unchanged.
