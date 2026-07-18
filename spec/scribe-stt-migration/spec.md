# Spec — Migrate STT to ElevenLabs Scribe v2 Realtime (Web Speech fallback)

**Project:** AI News Tutor (`Projects/ai-tutor`, Next.js 14 + TS + Tailwind)
**Branch:** `main`
**Status:** 📋 Proposed (not yet implemented)
**Date:** 2026-07-18
**Visual system:** Aurora Mist — **locked** (no palette/font/radius/shadow/`@keyframes` changes)
**Touches:** `src/components/main/useVoiceInput.ts` (new), `src/components/main/useScribeRecognition.ts` (new),
`src/lib/stt/config.ts` (new), `src/app/api/stt-token/route.ts` (new), `src/components/main/VoiceDock.tsx`,
`src/components/main/MicBtn.tsx`, `src/components/AppShell.tsx`, `vitest.setup.ts`, `.env.example`, tests

---

## Goal

Speech recognition mishears the user too often — the user has a strong French accent and the current
engine (browser-native Web Speech API, i.e. Chrome's ASR) offers **no lever to fix it**: no model
choice, no language biasing, no vocabulary hints (`spec/stt-silence-timeout/spec.md` already
documented this wall). Replace the recognition engine with **ElevenLabs Scribe v2 Realtime** — a
modern streaming STT model with strong accented-speech performance — while keeping the existing
voice UX byte-for-byte: live interim text in the composer, auto-send after 2.5s of silence,
tap-the-orb to send now, tap-with-empty-transcript to cancel.

Non-goals (explicitly deferred, see § Deferred):

- **Keyterm biasing** — ship the engine swap first, measure, add keyterms only if still needed.
- **`noVerbatim` disfluency stripping** — a second variable; separate experiment.
- **Barge-in with continued playback** — interrupting pauses the tutor instead (§ Echo).
- **Rate-limiting the token route** — accepted risk for a demo app (§ Security).

## Success criteria

1. Speaking the manual acceptance utterance list (§ Testing) through Scribe produces **fewer word
   errors** than the same list through Web Speech, judged by hand count.
2. All existing UX behaviors preserved (§ Parity checklist).
3. Voice input still works with **no ElevenLabs key configured** (falls back to Web Speech; local
   dev stays keyless).
4. Quality gate green: `npm run lint && npm run typecheck && npm run test:run`, with
   `useSpeechRecognition.test.tsx` passing **unchanged** and `VoiceDock.test.tsx` behavioral
   assertions unchanged (mock wiring may move to the new hook).

---

## Background — what exists today

- STT is 100% browser-native Web Speech API in
  `src/components/main/useSpeechRecognition.ts`. Config is three lines: `lang = 'en-US'`,
  `interimResults = true`, `continuous = true`.
- The app owns silence detection (`SILENCE_TIMEOUT_MS = 2500`) because Web Speech has no knob.
- `mergeTranscript` + a three-ref accumulator (`priorSessionsRef` / `sessionFinalRef` /
  `interimRef`) work around Android Chrome's growing-prefix re-finalization (issue #30) and
  mid-turn engine restarts.
- The hook's public contract — `{ supported, toggle, sendNow }` +
  `onInterim` / `onFinal` / `disabled` — is consumed only by `VoiceDock.tsx` (and `MicBtn.tsx`).
- ElevenLabs is already the TTS vendor (`/api/speak`); this spec adds STT under the same API key.

## Chosen approach (from brainstorm)

- **Realtime WebSocket** (not batch): live partial transcripts are core to the UX.
- **Web Speech kept as silent fallback** behind the same seam; the hook exposes an `engine`
  field (`'scribe' | 'webspeech'`) for console-level observability, unused by the UI.
- **Connect per turn**: connect on mic-tap, close after the committed transcript. Pay only for
  spoken minutes. Token prefetched on entering voice mode to hide handshake latency.
- **Echo handled by pausing playback**: starting to listen calls the existing `stopAudio()`
  (`AppShell.tsx:179`). AEC/NS/AGC enabled as defense in depth, not depended on.

---

## Architecture

```
VoiceDock.tsx
  └─ useVoiceInput()               NEW — engine selection + fallback latch
       ├─ useScribeRecognition()   NEW — Scribe realtime engine
       └─ useSpeechRecognition()   UNCHANGED — fallback engine
```

Both engine hooks are **always mounted** (React hook rules); an `active` flag gates which
engine's callbacks pass through and which may touch hardware/network. The inert engine must be
truly inert: Web Speech never `start()`s while inactive (already true); the Scribe hook must not
connect, prefetch tokens, or request the mic while inactive.

### New files

| File | Responsibility |
|---|---|
| `src/components/main/useVoiceInput.ts` | Same public contract as `useSpeechRecognition` plus `engine`. Decides Scribe vs Web Speech per turn; owns the fallback latch. |
| `src/components/main/useScribeRecognition.ts` | Scribe engine: token lifecycle, `Scribe.connect`, event→callback mapping, teardown. |
| `src/lib/stt/config.ts` | All tuning constants in one place (model id, language, VAD numbers, mic constraints, empty `KEYTERMS` slot). |
| `src/app/api/stt-token/route.ts` | Server route minting single-use realtime tokens. Returns 503 if `ELEVENLABS_API_KEY` unset. `Cache-Control: no-store`. Never exposes the API key. |

### Modified files

| File | Change |
|---|---|
| `VoiceDock.tsx` | Import `useVoiceInput` instead of `useSpeechRecognition`; accept + forward a new `onStartListening?: () => void` prop. |
| `MicBtn.tsx` | Same hook swap (text-mode composer mic gets the accent fix too). Voice and text mode are mutually exclusive UI states, so only one instance listens at a time — same as today. |
| `AppShell.tsx` | Pass `stopAudio` as `onStartListening` (≈3 lines). `stopAudio` is already idempotent — safe when nothing is playing. |
| `vitest.setup.ts` | Add a controllable `@elevenlabs/client` fake (§ Testing). |
| `.env.example` | Document that `ELEVENLABS_API_KEY` now also powers STT; note keyless = Web Speech fallback. |

### Dependency

`@elevenlabs/client` (^1.15.1, verified on npm; exports `Scribe`, `RealtimeConnection`,
`RealtimeEvents`, `CommitStrategy`, `AudioFormat`).

---

## Scribe configuration (`src/lib/stt/config.ts`)

```ts
import { CommitStrategy } from '@elevenlabs/client';

export const STT_MODEL_ID = 'scribe_v2_realtime';
export const STT_LANGUAGE = 'eng';            // ISO 639-3; explicit hint beats locale guessing
export const STT_COMMIT_STRATEGY = CommitStrategy.VAD;
export const STT_VAD_SILENCE_SECS = 2.5;      // SDK range 0.3–3.0; matches old SILENCE_TIMEOUT_MS
export const STT_MIC = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};
/** Deferred (§ Deferred). Max 50 terms × 20 chars on realtime. Wire-ready: pass to connect() when non-empty. */
export const STT_KEYTERMS: string[] = [];
```

`vadThreshold`, `minSpeechDurationMs`, `minSilenceDurationMs`: **omit** — server defaults
(0.4 / 100ms / 100ms) until measurement says otherwise. `noVerbatim`: omit (false).
`includeTimestamps` / `includeLanguageDetection`: omit — not consumed by anything.

---

## Token lifecycle

- **Server route** `POST /api/stt-token` → calls ElevenLabs token endpoint for realtime Scribe
  (single-use, expires 15 min) using `ELEVENLABS_API_KEY` → returns `{ token }`.
  *The exact ElevenLabs REST path/shape for token minting is **verify-during-implementation**;
  the docs name `/v1/tokens/realtime_scribe`.*
- **Prefetch:** on entering voice mode (Scribe active, not latched), fetch a token and cache it
  in a ref **with a fetched-at timestamp**.
- **Staleness guard:** at connect time, if the cached token is **older than 10 minutes**, fetch a
  fresh one first. Tokens are single-use: after a connect consumes one, prefetch the next in the
  background.
- **`AUTH_ERROR` retry:** on auth failure, retry **once** with a forced-fresh token before
  treating it as a real failure. A stale prefetched token must never latch the fallback.

## Connection lifecycle (per turn)

```
tap orb (idle)
  → onStartListening() [stopAudio]
  → ensure fresh token (staleness guard)
  → Scribe.connect({ token, modelId, languageCode, commitStrategy: VAD,
                     vadSilenceThresholdSecs: 2.5, microphone: STT_MIC })
  → SESSION_STARTED         → setListening(true)   ← orb animates HERE, not on tap
  → PARTIAL_TRANSCRIPT      → onInterim(text)      ← replace, never append
  → [2.5s silence, server VAD]
  → COMMITTED_TRANSCRIPT    → onFinal(text) → close() → setListening(false)
```

- One commit per turn: the first `COMMITTED_TRANSCRIPT` ends the turn (matches today's
  silence-auto-send). `close()` is terminal — a new turn creates a new connection.
- Between `SESSION_STARTED` and the first partial, the composer shows whatever interim text
  exists (none) — identical to today's listening-but-silent state.
- **Deleted complexity:** the 2.5s app timer, `mergeTranscript`, and the three-ref accumulator
  have no Scribe equivalent and are not ported. Issue #30 (growing-prefix re-emission) is a Web
  Speech quirk; Scribe partials replace wholesale.

### `sendNow()` (tap while listening)

- Latest partial text non-empty → fire `onFinal(partial)`, `close()`, `setListening(false)`.
  Sends a partial rather than a committed segment — acceptable for an impatience escape hatch.
  *If implementation shows `connection.commit()` works under VAD strategy (SDK docs say it's
  "only needed" for MANUAL — ambiguous), prefer commit-then-close for the accuracy win.*
- Latest partial empty → **cancel**: `close()`, `setListening(false)`, no `onFinal`. (Parity
  with `useSpeechRecognition.ts:110`.)

### Disable mid-listen (send in flight)

When `disabled` goes true while listening (a send started): `close()` immediately, drop all
in-flight events (a late `COMMITTED_TRANSCRIPT` after close **must not** fire `onFinal` — else
double-send), `setListening(false)`. (Parity with `useSpeechRecognition.ts:201-211`.)

### Teardown (unmount)

Remove listeners, `close()` if open, clear pending token fetches. Mirror of the existing
mount-effect cleanup.

---

## Fallback policy (`useVoiceInput`)

| Trigger | Behavior |
|---|---|
| Token route returns 503 (no key) | Never attempt Scribe this session. Web Speech throughout. Local dev works keyless. |
| `AUTH_ERROR` | Retry once with forced-fresh token (§ Token lifecycle). Retry also fails → latch. |
| `QUOTA_EXCEEDED`, `UNACCEPTED_TERMS`, `RESOURCE_EXHAUSTED` | **Latch** → Web Speech for the rest of the session (retrying can't help). |
| `RATE_LIMITED` | Fall back **this turn only**; try Scribe again next turn. |
| Socket error / `CLOSE` before `SESSION_STARTED` | Fall back this turn only. |
| Error mid-utterance (partials exist) | Fall back for this turn **and pass the last partial to `onInterim`** so the words already spoken land in the composer for manual send/edit. The audio is gone — silent re-transcription is impossible; preserving the partial is the honest behavior. |

- The latch is a session-scoped ref, not persisted.
- `engine: 'scribe' | 'webspeech'` is returned by the hook (console-observable; UI ignores it).
- Falling back mid-session re-uses the already-mounted Web Speech hook — its `supported` flag
  still gates the overall `supported` return when Scribe is unavailable **and** Web Speech is
  missing (e.g. keyless + Firefox → voice unsupported message, exactly today's behavior).

## Security note — token route is an open faucet (accepted risk)

`/api/stt-token` mints usable tokens without auth; a discovered deploy URL can drain ElevenLabs
quota. This matches the existing exposure of `/api/speak` (unauthenticated TTS) and is **accepted
for a demo app**. Mitigation if traffic ever becomes real: per-IP rate limit on the token route
(follow-up, not specced). Decision documented here so it is a choice, not an oversight.

---

## Parity checklist (must all hold)

- [ ] Live interim text fills the composer while speaking.
- [ ] 2.5s silence → auto-send (server VAD instead of app timer).
- [ ] Tap orb while listening with text → send immediately.
- [ ] Tap orb while listening with **no** text → cancel, stop listening.
- [ ] Tap orb while tutor is speaking → playback stops, listening starts (new: was overlap).
- [ ] Send in flight → mic hard-disabled; no late transcript can double-send.
- [ ] Engine session dies mid-turn → spoken words are not lost (partial lands in composer).
- [ ] No key / Scribe down → Web Speech; no key **and** no Web Speech → existing unsupported message.
- [ ] Orb animation states unchanged (speaking > thinking > listening > idle precedence).

## Open items (verify during implementation)

1. ~~**Token-mint REST call**~~ **Resolved during planning:**
   `POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe`, header `xi-api-key`,
   no body → `200 {"token": string}` (15-min expiry, consumed on use).
2. **`commit()` under VAD strategy** — works? If yes, use in `sendNow()`.
3. **Pre-`SESSION_STARTED` buffering** — does the SDK buffer mic audio captured before the socket
   opens? Load-bearing for fast tap-and-talk. Acceptance check regardless: *tap orb, speak
   immediately; first word appears in the transcript.*
4. **`PARTIAL_TRANSCRIPT` cumulativeness** — payload field verified during planning
   (`{ message_type: "partial_transcript", text: string }` per `@elevenlabs/types`); whether each
   `text` is the full segment (replace-wholesale, assumed) vs. a delta still needs a live check.
   If a delta, adjust the interim mapping; nothing else changes.

---

## Testing

### Unit (Vitest, jsdom)

- **SDK fake:** `@elevenlabs/client` uses `AudioContext`/`AudioWorklet` — absent in jsdom; the
  real module must never load in tests. Add a controllable fake (module mock) exposing
  `Scribe.connect` → fake connection with `on`/`off`/`send`/`commit`/`close` spies and an
  `emit(event, payload)` test helper, mirroring the existing `MockSpeechRecognition` pattern in
  `vitest.setup.ts`.
- `useScribeRecognition`: event→callback mapping (partial→interim, committed→final+close),
  sendNow with/without text, disabled mid-listen closes + suppresses late events, teardown.
- `useVoiceInput`: engine selection; every fallback-table row, incl. AUTH_ERROR single retry,
  latch persistence across turns, this-turn-only fallbacks retrying Scribe next turn, mid-turn
  partial preservation.
- Token route: 503 without key, `{ token }` with key (upstream fetch mocked), `no-store` header,
  API key never in the response body.

### Integration

- `VoiceDock`: tap while `speaking` calls `onStartListening`; orb does **not** show listening
  until `SESSION_STARTED` fires on the fake.

### Regression

- `useSpeechRecognition.test.tsx` and `VoiceDock.test.tsx` pass **unchanged** (VoiceDock's test
  may only change in how the hook is mocked, not in behavioral assertions).

### Manual acceptance — the accent measurement

Because keyterms are deferred, this is what answers "did the swap fix it":

1. Fix a list of ~15 utterances the current engine mishears (drawn from real usage: AI/Claude
   vocabulary, article questions, depth-steering commands).
2. Read each list item once per engine (Scribe deploy vs. Web Speech fallback forced by
   removing the key locally), same mic, same room.
3. Hand-count word errors per engine. Scribe must be strictly better; if not, activate the
   `STT_KEYTERMS` follow-up.

### Gate

`npm run lint && npm run typecheck && npm run test:run` — all green before push (project
quality gate).

---

## Deferred / follow-ups

| Item | Trigger to pick it up |
|---|---|
| `STT_KEYTERMS` (static AI-domain terms, later article-dynamic) | Manual acceptance still shows domain-term errors. |
| `noVerbatim` experiment | Engine swap validated; disfluencies annoying in transcripts. |
| Barge-in with continued playback (AEC-reliant) | User wants talk-over-the-tutor UX. |
| Token-route rate limiting | App gets real traffic / quota abuse observed. |
| Connection-lifecycle optimization (lazy-persistent + mute between turns) | Per-turn handshake latency measurably annoying. |
