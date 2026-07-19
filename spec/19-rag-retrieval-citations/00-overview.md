# RAG Retrieval + Citations — Overview (backlog #2)

**Status:** Proposed (2026-07-14), from a brainstorming session. Pending review.
**Origin:** `spec/00_feature_backlog.md` #2 — "RAG retrieval + citations". User outcome: *"I can ask about a topic across everything, and every claim links to a source I can check. I trust it and can go deeper."* Intermediate signal: embeddings, retrieval, grounding.
**Base:** builds directly on the Supabase KB store (`spec/kb-supabase-migration/`), which was adopted specifically to be pgvector-ready. That spec's explicit hand-off: *"#2 owns the vector schema."*

---

## Why now / what's wrong with today

Today the chat prompt stuffs **all ~24 article summaries** (≤700 chars each) into a cached system block, and citations are **title-substring matches** (`matchSources`) rendered as `SourceChips`. Two ceilings:

1. **Depth** — the model never sees article bodies (up to 60k chars each, already in Postgres). Answers can't go deeper than the summaries.
2. **Trust** — citations depend on the model echoing titles verbatim; nothing links a *claim* to a *source*, and the mechanism breaks silently when phrasing drifts.

RAG relieves both: retrieval picks the articles most relevant to the question and injects their **full bodies**; citations come from the retrieval result instead of string matching.

## Spec split (stacked)

| Spec | Delivers | Branch |
|---|---|---|
| `01-retrieval-chips.md` | pgvector schema, Voyage embeddings, query-time retrieval, top-k bodies in the prompt, retrieval-driven `SourceChips` | `feat/rag-01-retrieval` off `main` |
| `02-inline-citations.md` | inline `[n]` claim-level markers → superscript links + numbered footnote list; TTS-safe stripping; retire `matchSources` | `feat/rag-02-inline-citations` stacked on 01 |

Each is independently shippable; 01 is valuable without 02.

## Decisions (from brainstorm, 2026-07-14)

| Decision | Choice | Rationale |
|---|---|---|
| **Granularity** | **Whole-article embeddings** (one vector per article) | 24-article corpus; retrieval only needs to pick *which* articles. No chunker, lean schema. Chunking deferred until #1 (multi-source) grows the corpus. |
| **Embedding provider** | **Voyage AI**, `voyage-3.5-lite`, 1024 dims | Anthropic's recommended embeddings partner; free tier dwarfs this volume; keeps the portfolio story on the Anthropic stack. New env: `VOYAGE_API_KEY`. |
| **Prompt strategy** | **Cached summaries block unchanged + per-query top-k bodies block** | Broad questions ("what's new?") keep working off the summary block; prompt cache stays hot (cached block stays byte-identical and first); depth comes from retrieved bodies. |
| **Citations** | **Phased**: retrieval-driven chips (01), then inline `[n]` markers (02) | Ships the safe half first; the TTS-interacting half is isolated in its own spec. |
| **Vector index** | **None** (sequential scan) | 24 rows — an HNSW/IVFFlat index costs more than it saves. Comment marks the threshold to revisit (~1k rows / #1). |
| **Degradation** | **RAG is purely additive** | No `VOYAGE_API_KEY`, no DB, or Voyage down ⇒ retrieval returns `[]` ⇒ prompt and behavior byte-identical to today. Mirrors the `db.ts` no-op pattern. |
| **Multi-turn** | Embed **latest user message only** | Documented limitation; query rewriting is future work (pairs with backlog #3). |

## Non-goals (YAGNI)

- **No chunking / passage-level retrieval** — whole-article only (revisit with #1).
- **No vector index** — seq scan at this scale.
- **No hybrid search** (BM25/keyword fusion), **no reranker model**.
- **No embedding of user questions for analytics/memory** — query vectors are ephemeral, never stored.
- **No changes to scraping, summarization, digest, TTS synthesis, or the cron cadence.**

## Hard constraints (must not break)

- **Prompt cache** — the existing cached grounding block stays byte-identical and first in the system array; the retrieved block is appended after it, uncached.
- **Chat latency** — retrieval adds one Voyage call (~50–150 ms) + one SQL query *before* the stream opens; the grounding Data Cache (`unstable_cache` + `revalidateTag('grounding')`) is untouched.
- **Read-along** — spec 01 touches no spoken text. Spec 02 must strip markers so TTS never speaks them and word-highlight alignment holds.
- **No-op guards** — unset `VOYAGE_API_KEY` and/or `DATABASE_URL` ⇒ today's exact behavior. Existing `db.test.ts` no-op cases stay green.
- **Quality gate (all pass):** `npm run lint`, `npm run typecheck`, `npm run test:run`. Node 24+.

## Sequencing

1. **Merge `feat/kb-supabase-migration` to `main` first** (RAG assumes the Supabase store + `postgres.js` driver are on main).
2. `feat/rag-01-retrieval` off fresh `main` → PR → merge.
3. `feat/rag-02-inline-citations` stacked on 01 → PR into 01's branch (or main after 01 merges).
4. Provisioning (user, dashboard): create a Voyage AI account, set `VOYAGE_API_KEY` in Vercel (Production + Preview) and `.env.local`; redeploy.
