import { revalidateTag } from 'next/cache';
import { getClaudeArticles, getIngestionStatus, GROUNDING_TAG } from '@/lib/scraper';

/**
 * Scheduled refresh endpoint (P0-4). Hit by Vercel Cron on a fixed cadence so the
 * knowledge base stays current without depending on organic traffic or a redeploy.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. We fail closed —
 * a missing/incorrect secret returns 401 and never triggers a scrape. The forced
 * re-scrape (and re-summarization of misses) runs here, so its cost/latency lands on
 * the cron, never on a user request. After scraping we invalidate the cross-instance
 * grounding cache (see spec/chat-latency) so /api/chat picks up fresh content on its
 * next read — refreshed off the user's turn, via stale-while-revalidate.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  await getClaudeArticles({ force: true });
  revalidateTag(GROUNDING_TAG);
  return Response.json(getIngestionStatus());
}

export const dynamic = 'force-dynamic';
