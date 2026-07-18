import { NextResponse } from 'next/server';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Mint a single-use realtime-Scribe token for client-side STT.
 * The ElevenLabs API key stays server-side; the returned token is
 * time-bound (15 min) and consumed on first use.
 */
export async function POST() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'STT is not configured' },
      { status: 503, headers: NO_STORE },
    );
  }
  const res = await fetch(`${ELEVENLABS_BASE}/single-use-token/realtime_scribe`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: 'Token mint failed' },
      { status: 502, headers: NO_STORE },
    );
  }
  const { token } = (await res.json()) as { token: string };
  return NextResponse.json({ token }, { headers: NO_STORE });
}
