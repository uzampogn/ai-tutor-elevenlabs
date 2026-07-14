/**
 * Query-time retrieval (spec/rag-retrieval-citations): embed the user's latest
 * question and return the top-k most similar articles above a similarity floor.
 * Returns [] on ANY failure or when embeddings/db are unconfigured — the chat
 * route then behaves exactly as before RAG existed.
 */
import * as db from './db';
import { embedTexts } from './embeddings';

export const RETRIEVAL_K = 3;
// Cosine-similarity floor so off-topic questions ("hello!") retrieve nothing.
// Starting guess — tune against real questions before raising/lowering.
export const SIM_FLOOR = 0.35;
// The chat stream must not wait long for Voyage; on timeout we degrade.
const QUERY_EMBED_TIMEOUT_MS = 1_500;
// Sanity cap on the embedded question (Voyage input, not a UI limit).
const QUESTION_CAP = 2_000;

export type { SimilarArticleRow as RetrievedArticle } from './db';

export async function retrieveArticles(
  question: string,
  k = RETRIEVAL_K,
): Promise<db.SimilarArticleRow[]> {
  try {
    const q = (question ?? '').trim();
    if (!q) return [];
    const vecs = await embedTexts([q.slice(0, QUESTION_CAP)], 'query', {
      signal: AbortSignal.timeout(QUERY_EMBED_TIMEOUT_MS),
    });
    if (!vecs || vecs.length === 0) return [];
    const rows = await db.similarArticles(vecs[0], k);
    return rows.filter((r) => r.similarity >= SIM_FLOOR);
  } catch (err) {
    console.error('[retrieval] failed (degrading to no retrieval):', err);
    return [];
  }
}
