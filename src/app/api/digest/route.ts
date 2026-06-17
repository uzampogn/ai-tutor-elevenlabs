import { NextResponse } from 'next/server';
import { getArticleDigests } from '@/lib/digest';

// Run at runtime, NOT statically prerendered at build. Next.js caches GET Route
// Handlers as static assets by default, which would run digest generation during
// `next build` (in CI, where it produced null digests) and freeze the result.
// force-dynamic makes this execute per request with the runtime ANTHROPIC_API_KEY;
// the in-memory digest/article caches then keep subsequent calls fast.
export const dynamic = 'force-dynamic';
// First call on a cold instance generates ~24 digests — give it headroom.
export const maxDuration = 60;

export async function GET() {
  try {
    const digests = await getArticleDigests();
    return NextResponse.json({ digests });
  } catch (err) {
    console.error('[api/digest] failed:', err);
    // Fail soft: the drawer renders its description-only fallback when the map is empty.
    return NextResponse.json({ digests: {} });
  }
}
