import { getClaudeArticles, getIngestionStatus } from '@/lib/scraper';

/**
 * Scheduled refresh endpoint (P0-4). Hit by Vercel Cron on a fixed cadence so the
 * knowledge base stays current without depending on organic traffic or a redeploy.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. We fail closed —
 * a missing/incorrect secret returns 401 and never triggers a scrape. The forced
 * re-scrape (and, with dev-spec-02, re-summarization of misses) runs here, so its
 * cost/latency lands on the cron, never on a user request.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  await getClaudeArticles({ force: true });
  return Response.json(getIngestionStatus());
}

export const dynamic = 'force-dynamic';
