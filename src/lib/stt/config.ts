import { CommitStrategy } from '@elevenlabs/client';

/** All Scribe STT tuning constants in one place (spec § Scribe configuration). */
export const STT_MODEL_ID = 'scribe_v2_realtime';
/** ISO 639-3 — explicit hint beats locale guessing for accented English. */
export const STT_LANGUAGE = 'eng';
export const STT_COMMIT_STRATEGY = CommitStrategy.VAD;
/** SDK range 0.3–3.0; matches the old app-side SILENCE_TIMEOUT_MS (2500ms). */
export const STT_VAD_SILENCE_SECS = 2.5;
/** Tokens expire at 15 min; refresh anything older than 10 before connecting. */
export const STT_TOKEN_MAX_AGE_MS = 10 * 60_000;
/** Mic constraints — AEC/NS/AGC on as defense in depth (echo is primarily
 * handled by pausing TTS playback when listening starts). */
export const STT_MIC = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};
/** Deferred (spec § Deferred). Max 50 terms × 20 chars on realtime.
 * Wire-ready: passed to connect() whenever non-empty. */
export const STT_KEYTERMS: string[] = [];
