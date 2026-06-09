import { NextRequest, NextResponse } from 'next/server';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, (m) => m.replace(/`/g, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)([\s\S]*?)\1/g, '$2')
    .replace(/(\*|_)([\s\S]*?)\1/g, '$2')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

  const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}/stream`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: stripMarkdown(text).slice(0, 1200),
      model_id: 'eleven_turbo_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!res.ok) {
    const msg = await res.text();
    console.error('[speak] ElevenLabs error:', msg);
    return NextResponse.json({ error: msg }, { status: res.status });
  }

  return new Response(res.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
}
