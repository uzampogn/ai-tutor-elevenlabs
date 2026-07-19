# Spec 02 — TTS with timestamps + chunking (kills the 1200-char truncation)

**Series:** [Read-Along TTS](./00-overview.md) · **Milestone:** Solution 3.5
**Status:** 📋 Proposed · **Date:** 2026-06-14
**Depends on:** `01` (canonical `spokenText`) · **Unblocks:** `03`
**User-visible change:** **long answers now read aloud in full** (truncation bug fixed). No highlight yet.

---

## Goal

Change `/api/speak` from "raw audio of the first 1200 stripped chars" to "**full** audio **plus** character-level timing for the whole answer." Two coupled changes:

1. **Switch the ElevenLabs endpoint** from `…/{voice}/stream` (audio only) to `…/{voice}/with-timestamps` (JSON: `audio_base64` + `alignment`).
2. **Remove `slice(0, 1200)` and chunk** the spoken text into ≤2000-char pieces (ElevenLabs' recommended ceiling), synthesize each, then **stitch** audio + alignment into one continuous result so the highlight (Spec 04) can track the whole answer.

This independently fixes a real bug that exists **today**: long answers (body + Business Impact) are silently cut off in audio at `route.ts:43`.

---

## Context — today's route

`src/app/api/speak/route.ts`:
- `:36` `fetch(\`${ELEVENLABS_BASE}/text-to-speech/${voiceId}/stream\`, …)` — returns raw `audio/mpeg`.
- `:43` `text: stripMarkdown(text).slice(0, 1200)` — **the truncation**. `stripMarkdown` moves to `src/lib/readAlong/` in Spec 01; this route imports it.
- `:44` `model_id: 'eleven_turbo_v2'` — keep (turbo is fast and supports timestamps).
- Client side: `AppShell.playVoice` (`:54`) and `readAloud` (`:145`) do `res.blob()` → `new Audio(URL.createObjectURL(blob))`. They must change to decode `audioBase64` → Blob.

ElevenLabs reference: [Create speech with timing](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps) returns `audio_base64`, `alignment`, and `normalized_alignment`, where `alignment` has parallel arrays `characters`, `character_start_times_seconds`, `character_end_times_seconds`.

---

## Design

### Request / response contract

`POST /api/speak` accepts the **canonical** spoken text (the client now sends `doc.spokenText` from Spec 01, not raw markdown — so the route no longer strips; it may still defensively strip if a raw string is detected, but the contract is canonical-in):

```ts
// request body
{ text: string }   // = SpokenDoc.spokenText
// response  (see 00-overview → SpeakResult)
{
  audioBase64: string,                 // full stitched MP3, base64
  alignment: {
    chars: string[],                   // chars.join('') === request.text
    charStartTimesSec: number[],
    charEndTimesSec: number[],
  }
}
```

### Chunking

```
spokenText ──split on sentence boundaries, packing ≤ MAX_CHARS──> [chunk0, chunk1, …]
```
- `MAX_CHARS`: hard ceiling **2000** (ElevenLabs guidance). **Recommended pack target ~600–800** to lower time-to-first-audio and keep each request cheap; never split mid-word, and prefer splitting on **sentence boundaries** (reuse Spec 01's sentence offsets, passed alongside or recomputed) so prosody doesn't break awkwardly mid-clause.
- Concatenating all chunks (with their original separators) must reproduce `spokenText` exactly — **no characters added or dropped at seams**. This is the load-bearing invariant for alignment continuity.

### Stitching (the careful part)

For each chunk `i` synthesized in order:
- **Audio:** concatenate the MP3 bytes. (MP3 frames concatenate playably; if seams click, fall back to returning per-chunk audio + offsets, or switch container — note as a risk, validate in test/manual.)
- **Alignment:** the chunk's `character_*_times_seconds` are relative to that chunk's own audio. Offset them by `cumulativeDurationSec` = sum of prior chunks' audio durations, then append. Append `characters` verbatim. Result: three arrays over the **whole** `spokenText`, with monotonic non-decreasing times.
- `cumulativeDurationSec` for chunk `i` = max `character_end_times_seconds` of chunk `i-1` (or decode the audio duration; the alignment max-end is simplest and sufficient).

```
final.chars              = concat(chunk[i].characters)
final.charStartTimesSec  = concat(chunk[i].start + offset_i)
final.charEndTimesSec    = concat(chunk[i].end   + offset_i)
offset_{i+1}             = offset_i + duration(chunk[i])
```

### Normalization reconciliation

ElevenLabs may return `normalized_alignment` (timing over normalized text) in addition to `alignment` (over the input). **Use `alignment`** (keyed to the input we sent) so `chars.join('')` matches `spokenText`. If, for a given model/locale, only normalized timing is reliable, reconcile by aligning normalized chars back to input chars (simple two-pointer over whitespace/case differences) **before** returning — the route must always honor the invariant `chars.join('') === request.text`. Cover this in tests with a fixture where the two differ.

### Errors & limits
- Any chunk failing → return the partial stitched result for successful chunks **plus** a `truncatedAt` marker, or fail the whole request (choose fail-soft: return what synthesized, so the user still hears most of the answer). Log like today (`route.ts:54`).
- Keep `Cache-Control: no-store`.
- Cap total chunks (e.g. ≤ 8 → ~6.4k chars) as a guardrail; answers are short editorial text, but Claude can ramble.

### Client changes (`AppShell.tsx`)
- `playVoice`/`readAloud`: replace `res.blob()` with `const { audioBase64, alignment } = await res.json()`, then `base64 → Uint8Array → Blob('audio/mpeg') → URL.createObjectURL`. Play exactly as before.
- **Send `spokenText`**, not raw content: build it from the message's `SpokenDoc` (Spec 01) and pass that as `text`. (Keeps audio identical to today for short answers and adds the rest for long ones.)
- **Stash the `alignment`** on the speaking message so Spec 03 can consume it. In this spec it can be ignored after fetch — but plumb it into state now (e.g. `speakingAlignment`) to avoid a second refactor.
- `onplay`/`onended`/`onpause` and `speakingContent` semantics unchanged.

---

## Test plan

### Unit — `src/app/api/speak/chunking.test.ts` (pure helpers, no network)
| Assert | Detail |
|---|---|
| Reconstruction | `chunks.join('') === spokenText` for short, exactly-2000, and >2000 inputs. |
| Sentence-boundary packing | Chunks break on sentence ends where possible; never mid-word; each ≤ `MAX_CHARS`. |
| Stitch continuity | Given mocked per-chunk alignments, the stitched `charStartTimesSec` are **monotonic non-decreasing**, `chars.join('') === spokenText`, and chunk `i+1`'s first start ≥ chunk `i`'s last end. |
| Offset math | Times of chunk 1 are shifted by chunk 0's duration exactly. |
| Normalization reconcile | Fixture where `normalized_alignment` ≠ `alignment` → returned `chars.join('') === request.text`. |
| Guardrails | Empty text → 400 (today's behavior, `route.ts:25`); >cap chunks → bounded. |

### Integration — `src/app/api/speak/route.test.ts` (mock `fetch` to ElevenLabs)
| Assert | Detail |
|---|---|
| Endpoint | Calls `…/with-timestamps` (not `/stream`), `model_id: 'eleven_turbo_v2'`, voice from env/default (`route.ts:34`). |
| Multi-chunk | A >2000-char body triggers N>1 upstream calls and one stitched response. |
| Response shape | Matches `SpeakResult`; `audioBase64` decodes to non-empty bytes. |
| Fail-soft | One chunk 500s → partial result returned (or documented fail mode), error logged. |

### Manual / Playwright
- Ask a question that yields a **long** answer (body + Business Impact > 1200 chars). Confirm the **entire** answer is spoken end-to-end (previously cut off). Confirm short answers sound identical to `main`.

---

## Definition of Done
- `/api/speak` returns `{ audioBase64, alignment }` over the **full** answer; no 1200 cap.
- Chunk/stitch helpers unit-tested against the reconstruction + continuity invariants.
- `AppShell` plays base64 audio and stashes `alignment` in state.
- Long answers audibly read in full; short answers unchanged. `test:run` / `tsc` / `build` green.

---

## Files touched
- **Modified:** `src/app/api/speak/route.ts` (endpoint, no slice, chunk+stitch, JSON response), `src/components/AppShell.tsx` (`playVoice`/`readAloud` → base64 decode + send `spokenText` + stash `alignment`).
- **New:** `src/app/api/speak/chunking.ts` (split + stitch helpers, pure), `src/app/api/speak/chunking.test.ts`, `src/app/api/speak/route.test.ts`.

---

## Out of scope
- Mapping alignment → sentence/word time windows — Spec `03`.
- Any highlight or scroll — `04`/`05`.
- Streaming (start audio before all chunks return) — Spec `08`. This spec is **buffered**: it waits for all chunks, which is fine for current answer lengths and keeps the client simple. (If buffered latency on long answers proves annoying, `08` addresses it.)
