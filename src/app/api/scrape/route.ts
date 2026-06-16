import { NextResponse } from 'next/server';
import { getClaudeArticles, getIngestionStatus } from '@/lib/scraper';

export async function GET() {
  const articles = await getClaudeArticles();
  // `articles` stays at the top level for back-compat (AppShell reads `d.articles`);
  // `status` is additive and surfaces freshness/staleness (P0-4 / enables P1-1).
  return NextResponse.json({ articles, status: getIngestionStatus() });
}
