# Spec 01 — Retrieval + Retrieval-Driven Source Chips

**Parent:** `00-overview.md`. **Branch:** `feat/rag-01-retrieval` off `main` (after the Supabase migration merges).
**Touch surface:** `db/schema.sql`, `src/lib/db.ts` (+test), **new** `src/lib/embeddings.ts` (+test), **new** `src/lib/retrieval.ts` (+test), `src/lib/scraper.ts` (ingestion hook, +test), `src/app/api/chat/route.ts` (+test), `src/components/AppShell.tsx`, `src/components/main/Thread.tsx`, `src/components/AiRow.tsx`, `.env.example`, `README.md`.

---

## Objective

1. Embed every KB article (Voyage `voyage-3.5-lite`, 1024 dims) during the cron refresh; store vectors in pgvector.
2. At question time, retrieve the top-k most relevant articles and append their bodies to the prompt (cached summary block untouched).
3. Populate `SourceChips` from the retrieval result (similarity order) instead of title-substring matching; keep `matchSources` as the retrieval-off fallback.

## Schema (`db/schema.sql` + `ensureSchema()`)

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedding vector(1024);
ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedded_hash TEXT;
-- No vector index: ~24 rows, seq scan beats index maintenance. Revisit at ~1k rows (backlog #1).
```

- `embedded_hash` = `"<model>:<hash>"` at embed time (e.g. `voyage-3.5-lite:8fa3c2`). Re-embed when it differs from the current `"<model>:" + hash` — covers both content changes and model swaps.
- Idempotent, single statements → safe over the transaction pooler. If `CREATE EXTENSION` is refused on the pooled role, enable `vector` once in the Supabase dashboard (Database → Extensions); `ensureSchema()` stays the safety net. Document in `.env.example`/README.
- **pgvector + postgres.js binding:** vectors bind as text — `${'[' + vec.join(',') + ']'}::vector`. A `toSqlVector(vec: number[]): string` helper in `db.ts`, unit-tested.

## `src/lib/embeddings.ts` (new)

Thin `fetch` wrapper — no SDK dependency.

```
POST https://api.voyageai.com/v1/embeddings
Authorization: Bearer $VOYAGE_API_KEY
{ "input": string[], "model": "voyage-3.5-lite", "input_type": "document" | "query" }
```

- `embedTexts(texts: string[], inputType: 'document' | 'query'): Promise<number[][] | null>`
- Constants: `EMBEDDING_MODEL` (env override, default `voyage-3.5-lite`), `EMBEDDING_DIMS = 1024`, request timeout 10s (ingestion) — the chat path wraps its own tighter timeout (below).
- **No-op guard:** `VOYAGE_API_KEY` unset ⇒ return `null` (no throw), mirroring `db.ts`. Non-2xx / network error / malformed response ⇒ log + `null`.
- Batch: one call per ≤128 inputs (Voyage batch cap; 24 articles fit in one).

## Ingestion (in `scrapeAndPersist`, forced/cron path)

After summarize + `upsertArticles`, embed only stale articles:

1. Stale = `embedding IS NULL` **or** `embedded_hash <> '<model>:' + hash`.
2. Input per article: `title + "\n\n" + body.slice(0, 30_000)` (≈7.5k tokens, well inside Voyage's context), `input_type: 'document'`.
3. New `db.ts` fns: `getEmbeddingStates(): Promise<Map<slug, embedded_hash>>`, `updateEmbeddings(rows: {slug, embedding: number[], embeddedHash: string}[])`.
4. **Failures never block the article upsert** — log, leave `embedding` NULL, retried next cron. Steady-state cron cost: 0 embedding calls (hashes match).

## `src/lib/retrieval.ts` (new)

`retrieveArticles(question: string, k = 3): Promise<RetrievedArticle[]>`

1. Guard: empty/whitespace question, or embeddings/db no-oping ⇒ `[]`.
2. Embed question (`input_type: 'query'`) with a **1.5s timeout** — on timeout return `[]` (chat must not hang on Voyage).
3. `db.ts` fn `similarArticles(vec, k)`:
   ```sql
   SELECT slug, title, url, pub_date, summary, body,
          1 - (embedding <=> ${toSqlVector(vec)}::vector) AS similarity
   FROM articles WHERE embedding IS NOT NULL
   ORDER BY embedding <=> ${toSqlVector(vec)}::vector
   LIMIT ${k};
   ```
4. Filter by `SIM_FLOOR = 0.35` (constant; tune after manual eval) so off-topic questions retrieve nothing.
5. `RetrievedArticle = { slug, title, url, pubDate, body, similarity }`. Any error ⇒ log + `[]`.

## Chat route (`src/app/api/chat/route.ts`)

- Extract the **latest user message** text; `await retrieveArticles(question)` before opening the stream.
- **System prompt becomes an array of two blocks:**
  1. Existing grounding block — **byte-identical**, keeps `cache_control: { type: 'ephemeral' }`. (Cache prefix covers block 1 only; a varying block 2 after it does not invalidate it.)
  2. New retrieved block (only when retrieval returned articles, **uncached**):
     ```
     ## Retrieved sources (most relevant to the user's question)
     ### [Source 1] <title> — <url>
     <body.slice(0, 8_000)>
     ...
     Ground your answer in these sources when relevant. Cite by writing the article title EXACTLY as given.
     ```
     Caps: k = 3, `BODY_EXCERPT_CAP = 8_000` chars each (≤24k added; comfortable in a 200k window).
- **Response header** `X-Sources: slug1,slug2,slug3` (similarity order, comma-joined — slugs are ASCII-safe; set before streaming starts). Absent when retrieval returned nothing.
- Retrieval `[]` ⇒ single-block system prompt, no header — **byte-identical to today**.

## Frontend

- **`AppShell.tsx`** — read `res.headers.get('X-Sources')` before consuming the stream; store `sources: string[]` (slugs) on the assistant message.
- **`Thread.tsx`** — pass `message.sources` through to `AiRow`.
- **`AiRow.tsx`** — chips source: if `sources` present, map slugs → `Article[]` via the loaded `articles` (preserving header order; drop slugs not found); else fall back to `matchSources(content, articles)` (retrieval-off path). `SourceChips` component itself unchanged.

## Config / docs

- `.env.example`: `VOYAGE_API_KEY` block (what it's for, where to get it, "optional — unset ⇒ retrieval off, app behaves as before").
- `README.md`: architecture section gains a short "RAG retrieval" paragraph + env table row; note the dashboard fallback for enabling pgvector.

## Edge cases

| Case | Behavior |
|---|---|
| `VOYAGE_API_KEY` unset (local dev default) | embeddings no-op ⇒ retrieval `[]` ⇒ today's exact prompt & UI |
| `DATABASE_URL` unset | db no-ops ⇒ same as above |
| Voyage 4xx/5xx/timeout at query time | `[]` within 1.5s; chat proceeds ungrounded-by-bodies |
| Voyage down during cron | articles persist without embeddings; retried next cron; retrieval serves whatever is embedded |
| All embeddings NULL (first deploy before cron) | `similarArticles` returns 0 rows ⇒ today's behavior until the first refresh |
| Off-topic question ("hello") | similarity floor filters all ⇒ no retrieved block, no header |
| Article deleted between retrieval and render | frontend drops unknown slugs; chips render remainder |
| Duplicate slugs in header | impossible by construction (`LIMIT k` on PK-distinct rows) |

## Testing (Vitest; network + DB mocked)

| Suite | Cases |
|---|---|
| `embeddings.test.ts` | no key ⇒ `null`, no fetch; happy path posts correct body (model, input_type); non-2xx ⇒ `null`; batching ≤128 |
| `db.test.ts` (extend) | `toSqlVector` formatting; `similarArticles` SQL shape + vector bind; `updateEmbeddings` upsert; no-op guards |
| `retrieval.test.ts` | floor filters low-sim rows; k cap; empty question ⇒ `[]`; embed timeout ⇒ `[]`; db error ⇒ `[]` |
| `scraper` ingestion test | only stale articles embedded; embed failure doesn't block upsert; steady-state ⇒ 0 embed calls |
| chat route test | retrieval `[]` ⇒ system is single cached block, no `X-Sources`; retrieval hit ⇒ block 2 present with excerpt caps, block 1 byte-identical + still cached, header ordered by similarity |
| `AiRow` test | slugs ⇒ chips in header order; unknown slugs dropped; no `sources` ⇒ `matchSources` fallback |

## Definition of Done

| Check | Criterion |
|---|---|
| Quality gate | lint, typecheck, test:run all green |
| Schema live | `vector` extension on; `embedding`/`embedded_hash` columns exist (Supabase table editor) |
| Cron embeds | after one refresh, all articles have non-NULL `embedding` and matching `embedded_hash` |
| Retrieval works | a topical prod question returns `X-Sources` and chips match retrieval order |
| Degradation verified | unset `VOYAGE_API_KEY` locally ⇒ behavior/UI identical to main |
| Prompt cache intact | cache-read tokens on turn 2 of a conversation ≈ turn 1 (no regression from block 2) |
| Docs | `.env.example` + README updated |
