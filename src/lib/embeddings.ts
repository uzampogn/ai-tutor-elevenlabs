/**
 * Voyage AI embeddings client (spec/rag-retrieval-citations). Anthropic has no
 * embeddings API; Voyage is its recommended partner. Thin fetch wrapper — no SDK.
 * Mirrors the db.ts degradation pattern: no VOYAGE_API_KEY → every call no-ops
 * (returns null) and the app behaves exactly as before RAG existed.
 */

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
// Overridable for tuning without a redeploy. Changing the model re-embeds all
// articles on the next cron (embedded_hash is prefixed with the model name).
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'voyage-3.5-lite';
export const EMBEDDING_DIMS = 1024; // must match vector(1024) in db/schema.sql
const BATCH_CAP = 128; // Voyage per-request input cap
const DEFAULT_TIMEOUT_MS = 10_000; // ingest path; the chat path passes a tighter signal

export function embeddingsEnabled(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

/**
 * Embed texts. `input_type` matters for retrieval quality: 'document' at ingest,
 * 'query' for user questions. Returns null when disabled or on any failure —
 * callers must degrade, never throw.
 */
export async function embedTexts(
  texts: string[],
  inputType: 'document' | 'query',
  opts: { signal?: AbortSignal } = {},
): Promise<number[][] | null> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) return null;
  if (texts.length === 0) return [];

  const out: number[][] = [];
  try {
    for (let i = 0; i < texts.length; i += BATCH_CAP) {
      const batch = texts.slice(i, i + BATCH_CAP);
      const res = await fetch(VOYAGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ input: batch, model: EMBEDDING_MODEL, input_type: inputType }),
        signal: opts.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Voyage HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { embedding?: number[] }[] };
      const vecs = (json.data ?? []).map((d) => d.embedding);
      if (vecs.length !== batch.length || vecs.some((v) => !Array.isArray(v))) {
        throw new Error('Voyage: malformed embeddings response');
      }
      out.push(...(vecs as number[][]));
    }
    return out;
  } catch (err) {
    console.error('[embeddings] embed failed:', err);
    return null;
  }
}
