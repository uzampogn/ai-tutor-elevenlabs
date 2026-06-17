import { NextResponse } from 'next/server';
import { getClaudeArticles, getIngestionStatus } from '@/lib/scraper';

// Run at runtime, NOT statically prerendered at build. As a default-cached GET
// Route Handler, this otherwise runs at `next build` time in CI — so summaries
// (and article freshness) get frozen into a static asset and never reflect the
// runtime key or the live feed. force-dynamic restores runtime execution; the
// scraper's own in-memory cache + fetch revalidate keep it cheap.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  const articles = await getClaudeArticles();
  // `articles` stays at the top level for back-compat (AppShell reads `d.articles`);
  // `status` is additive and surfaces freshness/staleness (P0-4 / enables P1-1).
  return NextResponse.json({ articles, status: getIngestionStatus() });
}
