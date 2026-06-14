import { NextRequest, NextResponse } from 'next/server';
import { stripMarkdown } from '@/lib/readAlong/stripMarkdown';
import {
  splitIntoChunks,
  stitchAlignments,
  reconcileAlignment,
  type ChunkAlignment,
} from './chunking';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

/** Raw ElevenLabs `/with-timestamps` alignment shape (snake_case arrays). */
interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}
interface WithTimestampsResponse {
  audio_base64: string;
  alignment?: ElevenLabsAlignment | null;
  normalized_alignment?: ElevenLabsAlignment | null;
}

/** Map an ElevenLabs alignment to our internal ChunkAlignment (camelCase). */
function toChunkAlignment(a: ElevenLabsAlignment | null | undefined): ChunkAlignment | undefined {
  if (!a || !Array.isArray(a.characters)) return undefined;
  return {
    chars: a.characters,
    charStartTimesSec: a.character_start_times_seconds ?? [],
    charEndTimesSec: a.character_end_times_seconds ?? [],
  };
}

/** Decode a base64 string to bytes (Node / edge runtime safe via atob). */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encode bytes to a base64 string. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function POST(req: NextRequest) {
  const { text } = await req.json();

  if (!text?.trim()) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ELEVENLABS_API_KEY not set' }, { status: 500 });
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM';

  // The client now sends doc.spokenText (already stripped). Strip defensively
  // anyway so a raw-markdown caller still degrades gracefully; for canonical
  // input this is a no-op (stripMarkdown is idempotent on stripped text).
  const spokenText = stripMarkdown(text);
  const chunks = splitIntoChunks(spokenText);

  const audioParts: Uint8Array[] = [];
  const perChunkAlignments: ChunkAlignment[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const res = await fetch(
        `${ELEVENLABS_BASE}/text-to-speech/${voiceId}/with-timestamps`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: chunk,
            model_id: 'eleven_turbo_v2',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
        },
      );

      if (!res.ok) {
        const msg = await res.text();
        console.error(`[speak] ElevenLabs error (chunk ${i}):`, msg);
        // Fail-soft: stop here and return what we have stitched so far.
        break;
      }

      const data = (await res.json()) as WithTimestampsResponse;
      if (data.audio_base64) audioParts.push(base64ToBytes(data.audio_base64));

      // Reconcile this chunk's alignment back onto the exact chunk text so
      // chars.join('') === chunk (handles any normalized/input divergence).
      const reconciled = reconcileAlignment(
        chunk,
        toChunkAlignment(data.alignment),
        toChunkAlignment(data.normalized_alignment),
      );
      perChunkAlignments.push(reconciled);
    } catch (err) {
      console.error(`[speak] fetch failed (chunk ${i}):`, err);
      // Fail-soft: return the partial stitched result for prior chunks.
      break;
    }
  }

  // If the very first chunk failed there is nothing to return — surface a 500
  // so the client falls back gracefully (audio simply won't play).
  if (audioParts.length === 0) {
    return NextResponse.json(
      { error: 'speech synthesis failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Concatenate MP3 bytes (frames concatenate playably for eleven_turbo_v2).
  const totalLen = audioParts.reduce((n, p) => n + p.length, 0);
  const merged = new Uint8Array(totalLen);
  let off = 0;
  for (const part of audioParts) {
    merged.set(part, off);
    off += part.length;
  }
  const audioBase64 = bytesToBase64(merged);

  const alignment = stitchAlignments(perChunkAlignments);

  return NextResponse.json(
    { audioBase64, alignment },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
