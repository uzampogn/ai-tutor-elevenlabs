import { NextResponse } from 'next/server';
import { getClaudeArticles } from '@/lib/scraper';

export async function GET() {
  const articles = await getClaudeArticles();
  return NextResponse.json({ articles });
}
