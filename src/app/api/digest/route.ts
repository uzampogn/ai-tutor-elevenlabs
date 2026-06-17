import { NextResponse } from 'next/server';
import { getArticleDigests } from '@/lib/digest';

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
