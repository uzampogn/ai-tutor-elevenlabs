import { NextResponse } from 'next/server';
import { getDigests } from '@/lib/db';

// Run at runtime, NOT statically prerendered at build: the digest map lives in
// Postgres and must be read with the runtime connection string. Generation
// happens at ingest (lib/digest.ts:digestStaleArticles) — this route never
// calls an LLM, so it needs no maxDuration headroom.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const digests = await getDigests();
    return NextResponse.json({ digests });
  } catch (err) {
    console.error('[api/digest] failed:', err);
    // Fail soft: the drawer renders its description-only fallback when the map is empty.
    return NextResponse.json({ digests: {} });
  }
}
