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

/** Staleness key: model + content hash. Model swap ⇒ every article re-embeds. */
export function embeddedHashFor(title: string, body: string): string {
  return `${EMBEDDING_MODEL}:${contentHash(title, body)}`;
}

export async function embedStaleArticles(
  articles: { title: string; url: string; body: string }[],
): Promise<void> {
  try {
    if (!embeddingsEnabled() || articles.length === 0) return;
    const states = await db.getEmbeddingStates();
    const stale = articles.filter((a) => {
      if (!a.body.trim()) return false; // nothing meaningful to embed
      return states.get(db.slugFromUrl(a.url)) !== embeddedHashFor(a.title, a.body);
    });
    if (stale.length === 0) return;

    const inputs = stale.map((a) => `${a.title}\n\n${a.body.slice(0, EMBED_INPUT_CAP)}`);
    const vecs = await embedTexts(inputs, 'document');
    if (!vecs) return; // logged inside embedTexts; retried next cron

    await db.updateEmbeddings(
      stale.map((a, i) => ({
        slug: db.slugFromUrl(a.url),
        embedding: vecs[i],
        embeddedHash: embeddedHashFor(a.title, a.body),
      })),
    );
    console.log(`[embed] embedded ${stale.length} article(s)`);
  } catch (err) {
    console.error('[embed] embedStaleArticles failed (non-fatal):', err);
  }
}
