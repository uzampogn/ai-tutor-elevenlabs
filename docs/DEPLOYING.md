# Deploying AI News Tutor

Everything you need to run your own instance in production. For a local quick start (two keys, no database), see the [README](../README.md#quick-start).

## Environment variables

```env
ANTHROPIC_API_KEY=sk-ant-...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM   # optional; defaults to "Rachel"
CRON_SECRET=...                            # required in prod for the scheduled refresh
DATABASE_URL=postgresql://...pooler.supabase.com:6543/postgres?sslmode=require   # Supabase transaction pooler
VOYAGE_API_KEY=...                         # optional; enables RAG retrieval (unset ⇒ retrieval off)
```

| Variable | Required | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| `ELEVENLABS_API_KEY` | yes | [elevenlabs.io/app/settings/api-keys](https://elevenlabs.io/app/settings/api-keys) |
| `ELEVENLABS_VOICE_ID` | no | Browse [elevenlabs.io/voice-library](https://elevenlabs.io/voice-library); defaults to Rachel |
| `CRON_SECRET` | prod | Any strong random string. Set in Vercel project settings; the cron sends it as `Authorization: Bearer $CRON_SECRET` to `/api/scrape/refresh`. Without it the refresh route fails closed (401). |
| `DATABASE_URL` (or `POSTGRES_URL`) | prod | Supabase Postgres connection string — the **transaction pooler** (host `...pooler.supabase.com`, port `6543`), not the direct 5432 connection (IPv6-only, unreachable from Vercel functions). The [Supabase Vercel integration](https://vercel.com/marketplace/supabase) auto-provisions `POSTGRES_URL`; the app reads `DATABASE_URL \|\| POSTGRES_URL`, so no manual alias is needed. Optional locally — without it the app live-scrapes every request. |
| `VOYAGE_API_KEY` | no | [dash.voyageai.com](https://dash.voyageai.com) — enables RAG retrieval (embeds articles with `voyage-3.5-lite` → pgvector). Unset ⇒ retrieval is off and chat behaves exactly as before (summaries-only grounding, title-match source chips). |

Voice **input** uses ElevenLabs Scribe v2 Realtime (needs `ELEVENLABS_API_KEY`; tokens are minted server-side at `/api/stt-token`). Without a key it falls back to the browser-native Web Speech API (Chrome/Edge).

## Auto-refresh & freshness

Supabase Postgres is the durable source of truth for the knowledge base (articles + their summaries), so a fresh serverless instance reads precomputed rows instead of re-scraping the blog and re-issuing ~24 summary calls on every cold start.

- A daily [Vercel Cron](https://vercel.com/docs/cron-jobs) (`vercel.json` → `crons`, `0 6 * * *`) hits `/api/scrape/refresh` and is the only writer: it scrapes, summarizes only new/changed posts (a durable content hash skips unchanged ones), and upserts the result.
- Reads are DB-first and self-heal: if the table is empty or stale (first deploy, a missed cron run, a DB hiccup), a read scrapes + summarizes inline and writes back, so the KB is never permanently empty.
- On a scrape failure the app serves the last-good rows without resetting the freshness clock; `/api/scrape` exposes `status.stale` (age > 26h, i.e. a missed daily run) and `status.ageMs`, so a stuck scrape is observable rather than silent.
- The daily cadence is a Vercel Hobby cron limit; on Pro, tune `vercel.json` to a tighter schedule.

Set `CRON_SECRET` and `DATABASE_URL` in the Vercel project for all of this to work in production.

## RAG retrieval (optional)

When `VOYAGE_API_KEY` is set, the cron also embeds each new/changed article ([Voyage](https://dash.voyageai.com) `voyage-3.5-lite`, 1024 dims → `pgvector` on Supabase), gated by a `<model>:<content-hash>` so unchanged content never re-embeds. At question time the chat route embeds the user's latest message and retrieves the top-3 most similar articles (cosine distance, similarity floor `0.35` so off-topic questions retrieve nothing); their full bodies are appended to the prompt as a second, uncached system block, leaving the cached summaries block byte-identical so prompt caching is preserved. The response's `X-Sources` header drives the source chips.

The feature degrades cleanly: without `VOYAGE_API_KEY` — or on any Voyage error, timeout, or missing DB — the app falls back to the summaries-only path.

The pgvector schema is created idempotently at runtime; if `CREATE EXTENSION vector` is refused on the pooled role, enable the `vector` extension once in the Supabase dashboard (Database → Extensions).

## Vercel + GitHub Actions

Deploys to Vercel via GitHub Actions: pull requests get a preview URL commented on the PR; pushes to `main` promote to production. Set `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` as repo secrets and the runtime keys above in the Vercel project settings.

## Langfuse (optional)

Every production chat turn is traced to Langfuse (trace `chat` → `retrieval` span + `generation` observation with token usage), and a Faithfulness LLM evaluator samples 20% of live `chat` traces. Set `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL`; unset ⇒ tracing and evals are silent no-ops. Setup details: [`spec/eval-harness/langfuse-setup.md`](../spec/eval-harness/langfuse-setup.md).
