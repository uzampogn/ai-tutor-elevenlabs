/**
 * Ingest-time embedding (spec/rag-retrieval-citations). Runs inside the cron's
 * scrapeAndPersist path AFTER articles are upserted; embeds only articles whose
 * content (or the embedding model) changed. Failures are logged and swallowed —
 * embedding must never block or fail article ingestion. NULL embeddings are
 * simply retried on the next cron.
 */
import * as db from './db';
import { embedTexts, embeddingsEnabled, EMBEDDING_MODEL } from './embeddings';
import { contentHash } from './summarize';

// Cap the embedded input (~7.5k tokens) — plenty of signal for whole-article
// similarity; full bodies can reach 60k chars.
export const EMBED_INPUT_CAP = 30_000;

// Per-cron-run ceiling on embed API calls. Voyage's free tier caps both
// requests/min and tokens/min, so a burst of stale articles must drain across
// runs rather than in one oversized call. 3 matches the free tier's 3 RPM.
export const EMBED_MAX_PER_RUN = 3;

/** Staleness key: model + content hash. Model swap ⇒ every article re-embeds. */
export function embeddedHashFor(title: string, body: string): string {
  return `${EMBEDDING_MODEL}:${contentHash(title, body)}`;
}

/** Outcome of one embedding pass — `backlog` is the embedding-health flag. */
export interface EmbedRunResult {
  embedded: number;
  /** Stale articles left unembedded after this run (cap or failure). */
  backlog: number;
}

export async function embedStaleArticles(
  articles: { title: string; url: string; body: string }[],
): Promise<EmbedRunResult> {
  try {
    if (!embeddingsEnabled() || articles.length === 0) return { embedded: 0, backlog: 0 };
    const states = await db.getEmbeddingStates();
    const stale = articles.filter((a) => {
      if (!a.body.trim()) return false; // nothing meaningful to embed
      return states.get(db.slugFromUrl(a.url)) !== embeddedHashFor(a.title, a.body);
    });
    if (stale.length === 0) return { embedded: 0, backlog: 0 };

    // One article per API call, persisted immediately. A single all-or-nothing
    // batch ratchets: once the stale set outgrows the free tier's token/min
    // budget, every nightly run 429s wholesale and the backlog only grows.
    // Per-article persistence makes every success durable, so a failure (e.g.
    // Voyage 429) just defers the remainder to the next cron.
    let embedded = 0;
    for (const a of stale.slice(0, EMBED_MAX_PER_RUN)) {
      const vecs = await embedTexts([`${a.title}\n\n${a.body.slice(0, EMBED_INPUT_CAP)}`], 'document');
      if (!vecs) break; // logged inside embedTexts; remainder retried next cron
      await db.updateEmbeddings([
        {
          slug: db.slugFromUrl(a.url),
          embedding: vecs[0],
          embeddedHash: embeddedHashFor(a.title, a.body),
        },
      ]);
      embedded++;
    }
    console.log(`[embed] embedded ${embedded}/${stale.length} stale article(s)`);
    const backlog = stale.length - embedded;
    if (backlog > 0) {
      // error level on purpose: Vercel's runtime-error clustering picks this up,
      // so a persistently unembedded backlog is visible/alertable instead of
      // silently degrading retrieval (as the 2026-08 Voyage-429 incident did).
      console.error(`[embed] backlog: ${backlog} article(s) still unembedded after this run`);
    }
    return { embedded, backlog };
  } catch (err) {
    console.error('[embed] embedStaleArticles failed (non-fatal):', err);
    return { embedded: 0, backlog: 0 };
  }
}
