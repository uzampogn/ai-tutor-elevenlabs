# Spec 08 — Streaming timestamps (optional latency polish)

**Series:** [Read-Along TTS](./00-overview.md) · **Milestone:** Solution 3 (enhancement)
**Status:** 📋 Proposed — **OPTIONAL** · **Date:** 2026-06-14
**Depends on:** `02` (and benefits `04`–`07`) · **Unblocks:** nothing
**User-visible change:** audio (and highlight) **start sooner** on long answers — playback begins before the whole answer is synthesized.

---

## Goal

Reduce time-to-first-audio. Specs 02–07 are **buffered**: `/api/speak` waits for every chunk before returning, so a long (~2000-char) answer incurs the full synth time before a sound plays. This spec switches to ElevenLabs' **streaming** timestamp endpoint so audio begins on the first chunk and timing arrives progressively.

**Pursue only if** buffered latency on long answers is actually annoying in practice. For current editorial answer lengths it may not be worth the added complexity — hence optional and last.

---

## Context

- Spec 02 calls `…/{voice}/with-timestamps` (buffered JSON). ElevenLabs also offers [**Stream speech with timing**](https://elevenlabs.io/docs/api-reference/text-to-speech/stream-with-timestamps): `…/{voice}/stream/with-timestamps` returns a **stream of JSON objects**, each `{ audio_base64, alignment }` for a portion of the text.
- Client playback today is a single `new Audio(blobUrl)` (`AppShell.tsx:66`). Streaming requires progressive audio (MediaSource Extensions / `SourceBuffer`, or sequential chunk playback) and a progressively-extended timing map.

---

## Design

### Route: proxy the stream
- `/api/speak` calls `…/stream/with-timestamps` and **passes the upstream stream through** to the client (like the original `/stream` proxy at `route.ts:58`, but now NDJSON/JSON-chunks instead of raw audio). Still chunk the input text (Spec 02) if needed, but each ElevenLabs stream already emits incrementally, so a single upstream call may suffice for ≤2000 chars; keep the chunker for >2000.
- Define a stable wire format to the client, e.g. **NDJSON**: one `{ audioBase64, alignment }` object per line, times already offset to be continuous (reuse Spec 02's stitch offsetting, applied as chunks arrive).

### Client: progressive playback + timing
- **Audio:** feed decoded MP3 chunks into a `MediaSource`/`SourceBuffer` so playback starts on chunk 0 and continues seamlessly; fall back to sequential `Audio` elements if MSE/MP3 support is shaky on a target browser.
- **Timing:** maintain a growing `ReadAlongTimings` — append sentence/word windows as each chunk's alignment arrives. The controller (Specs 04–07) already reads from `timings`; make it tolerant of timings that **grow** during playback (the active-index scan already moves forward; just guard against indexing past what's arrived yet — clamp to the last known sentence/word until more lands).
- **Backpressure / underrun:** if highlight outruns delivered audio (shouldn't, since audio leads), clamp the active index to delivered timing.

### Keep buffered as the fallback
- Behind a flag (`readAlongStreaming`), default **off**. If the stream errors mid-way, fall back to the buffered path (Spec 02) for the remainder or the next answer. Streaming is purely a latency optimization layered on the same contracts — it must never regress correctness.

---

## Test plan

### Unit
| Assert | Detail |
|---|---|
| Stream parse | NDJSON chunk parser yields `{ audioBase64, alignment }` objects; partial/last-line handling is safe. |
| Progressive offsetting | Times across streamed chunks remain monotonic and continuous (reuse Spec 02 stitch tests against a streamed sequence). |
| Growing timings | `buildTimings`/append produces a consistent, monotonic `ReadAlongTimings` as chunks are added; `activeIndexAt` clamps to delivered data. |

### Component
| Assert | Detail |
|---|---|
| Controller tolerates growth | `useReadAlong` with timings that grow over time keeps `.s-active`/`.w-active` correct and never indexes undelivered tokens. |
| Fallback | Stream error → buffered path engaged; no crash; highlight still works for delivered audio. |

### Manual / Playwright
- Long answer with streaming **on**: first audio is audibly faster than buffered; highlight starts promptly and stays in sync to the end. Toggle streaming **off**: behaves exactly as Specs 02–07. Test on the primary target browsers (MSE/MP3 support varies).

---

## Definition of Done
- `/api/speak` can stream `{ audioBase64, alignment }` chunks; client plays progressively and extends timing live; highlight (sentence + word) stays in sync.
- Behind `readAlongStreaming` (default off); buffered path remains the safe fallback and is never regressed.
- Measurable drop in time-to-first-audio on long answers. `test:run` / `tsc` / `build` green.

---

## Files touched
- **Modified:** `src/app/api/speak/route.ts` (stream endpoint + NDJSON passthrough, gated), `src/components/AppShell.tsx` (MSE/progressive playback + growing timings), `src/components/main/useReadAlong.ts` (tolerate growing timings), relevant test files.
- **New:** `src/app/api/speak/streamParse.ts` (+ test), MSE playback helper (+ test).

---

## Out of scope
- Any new highlight behavior — this spec only changes **when** audio/timing arrive, not what's shown.
- Replacing the buffered path — buffered (Spec 02) stays as the default and fallback.
