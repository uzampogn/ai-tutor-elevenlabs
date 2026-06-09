import { NextResponse } from 'next/server';
import { getAnthropicArticles } from '@/lib/scraper';

export async function GET() {
  const articles = await getAnthropicArticles();
  return NextResponse.json({ articles });
}
