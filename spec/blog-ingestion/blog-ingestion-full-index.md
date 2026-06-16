# Spec — Full-Index Blog Ingestion (all articles, full-body, summarized, auto-refreshing)

> Status: Draft · Owner: TBD · Date: 2026-06-16
> Scope: evolve the existing live scraper (`src/lib/scraper.ts`) from a **count window (top 10)** to **every article available in a single index fetch** (~24 today), capture **full article bodies**, generate a **lightweight per-article summary on ingest**, and make ingestion **stay current automatically**.

## Implementation specs

This PRD (the *what/why*) is split into three sequential, independently shippable dev specs (the *what to build/how*), each with its own testing strategy and Definition of Done:

1. **[`dev-01-full-index-ingestion.md`](./dev-01-full-index-ingestion.md)** — P0-1/P0-2/P0-6: ingest all articles, full body, junk filtering. *(no deps)*
2. **[`dev-02-summarization-and-context.md`](./dev-02-summarization-and-context.md)** — P0-3/P0-5: per-article summary on ingest + bounded chat context. *(needs 01)*
3. **[`dev-03-auto-refresh.md`](./dev-03-auto-refresh.md)** — P0-4: scheduled refresh + observable staleness. *(needs 01; parallel with 02)*

Order: 01 first, then 02 and 03 in parallel.

## Problem Statement

AI News Tutor grounds every answer in the Claude blog, but its ingestion is both **too narrow** and **silently stale**. Today `getClaudeArticles()` keeps only the 10 most recent posts (`MAX_ARTICLES = 10`) and stores a 2,500-char excerpt each — so older-but-still-relevant posts the blog still surfaces are dropped, and the tutor can't reason over full content. Worse, ingestion can fall behind without anyone noticing: the live app showed June 10 as the newest article while the blog had already published on June 15. The cost is a tutor that answers from a partial, sometimes-outdated knowledge base — directly undermining the product's core "always current, grounded in primary sources" promise.

**Evidence (measured 2026-06-16 against `claude.com/blog` and the deployed `/api/scrape`):**
- The blog index server-HTML exposes **24 real posts in a single fetch** (spanning ~76 days). Ingesting all of them is a **2.4× jump** over the 10 currently shown — 14 posts are silently dropped today.
- The deployed API returned an "article" literally titled **"Read more"**, and `/blog/category/*` nav links satisfy the article selector — both pollute the knowledge base and the LLM context.
- `getClaudeArticles()` swallows fetch errors and returns the last cache (`catch → return cachedArticles ?? []`), so a transient claude.com error or bot rate-limit can pin the app to stale data indefinitely.
- The chat route inlines **every** article's text into the system prompt (`src/app/api/chat/route.ts:59`). At ~24 full bodies this overflows a sane token/cost budget unless each article is condensed first.

## Goals

1. **Complete index coverage** — the knowledge base contains every valid post the blog index returns in a single fetch (~24 today), not a fixed count, with no date cut-off.
2. **Full-body grounding** — each article carries its full body text (not just a 2,500-char excerpt), so detailed questions and citations are accurate.
3. **Token-bounded grounding at any article count** — a lightweight per-article summary feeds the chat context, so cost/latency stay flat whether the index has 10 posts or 30.
4. **Never silently stale** — under normal operation the newest in-app article is never more than ~24h behind the blog; staleness beyond a threshold is detectable, not hidden.

## Non-Goals

- **Standalone export/dataset to disk or DB.** This evolves the *live* in-app KB only; persisting a reusable corpus is a separate initiative. (User chose "Evolve the live KB.")
- **Crawling beyond the single index fetch.** We ingest exactly what one `claude.com/blog` fetch returns; we do **not** paginate, follow "load more", or crawl category/archive pages for older posts. *Why:* one fetch already covers the full surfaced set; deeper crawling adds cost for posts the blog no longer features.
- **Multi-source ingestion** (anthropic.com/research, news, X, etc.). Claude blog remains the single source. *Why:* keeps citations trustworthy and scope tight.
- **Semantic retrieval / vector search over the corpus.** Per-article summaries (not embeddings + retrieval) keep the context bounded for now. *Why:* avoid infra until summaries prove insufficient.
- **Time-windowed selection.** No "last N days" filter — superseded by "ingest all available." *Why:* the index already self-limits to a sensible recent set; a date bound adds boundary edge-cases for no benefit.

## User Stories

**End user (the learner)**
- As a curious PM, I want the tutor to know about *every* post the blog currently features so that "what shipped recently?" returns the complete set, not just the last 10.
- As a user asking a detailed question, I want answers drawn from the **full article** so that follow-ups about specifics are accurate and cited correctly.
- As a daily reader, I want the app to reflect a post published today so that I'm not re-told yesterday's news.

**Operator / maintainer**
- As the maintainer, I want ingestion to refresh on a regular cadence without a manual redeploy so that the KB stays current on its own.
- As the maintainer, I want chat cost/latency to stay flat as the article count grows so that a busy publishing week doesn't blow the token budget.
- As the maintainer, I want a stale or failing scrape to be **observable** so that "stuck on an old date" is caught instead of shipped silently.
- As the maintainer, I want junk links ("Read more", category/tag pages) excluded so that the KB and citations stay clean.

## Requirements

### Must-Have (P0)

**P0-1 — Ingest all articles from a single index fetch (replaces top-10 / replaces any time window).**
Emit every valid article candidate from one `claude.com/blog` fetch — no `MAX_ARTICLES` cap and **no date filter**. Sort newest-first for display.
- Given the index fetch yields 24 valid posts, when the KB loads, then all 24 appear, newest-first.
- Given a valid article whose date is unparseable, then it is still included (real content is never dropped for a missing date) and sorted to the bottom.
- Given the index later grows or shrinks, then the KB count tracks it automatically with no code change.
- [ ] `MAX_ARTICLES` slice removed; no `WINDOW_DAYS`/date-boundary logic introduced.
- [ ] `MAX_CANDIDATES` retained only as a sanity safety cap (document the value); not used to trim the result set under normal cadence.

**P0-2 — Full article body capture.**
Extract the article's full body text, not just the JSON-LD `description`/first paragraph. Keep extraction precedence (JSON-LD `articleBody` → main content DOM → fallback) but stop capping at an excerpt; apply only a generous safety cap to bound pathological pages.
- Given a page with `articleBody` in JSON-LD, when fetched, then the stored text is the full body (whitespace-normalized), not a 2,500-char slice.
- Given a page with no structured body, then we extract concatenated `main/article` paragraph text as the body.
- [ ] `DESCRIPTION_CAP` replaced by a body-level safety cap (document value + rationale).
- [ ] `Article` type extended: `body` (full text) + `summary` (see P0-3) + a short `description`/excerpt for the sidebar card.

**P0-3 — Lightweight per-article summary on ingest.** *(Promoted from P1 — with ~24 full bodies this is now required to keep the chat context viable.)*
During ingestion, condense each article's full body into a compact summary (target a few sentences capturing key points + any product/impact angle). Store it alongside the body. The chat context (P0-5) is built from summaries, not raw bodies.
- Given an article is ingested, when its body is captured, then a summary is generated and stored with it.
- Given an article was already summarized and its content is unchanged, then it is **not** re-summarized on the next refresh (cache by slug; recompute only on cold start or content change).
- Given summarization fails for one article, then ingestion degrades gracefully (fall back to a truncated body excerpt for that article) and logs the failure — it does not drop the article.
- [ ] Summaries generated with a cheap/fast model (default: `claude-haiku-4-5`) to bound cost across ~24 calls; model id configurable.
- [ ] Summaries cached with the article cache so a refresh of unchanged content costs ~0 extra tokens.
- [ ] Summary length capped to a defined token/char budget that makes P0-5 satisfiable.

**P0-4 — Automatic, regular refresh (fix the stale-date bug).**
Ingestion must refresh on a regular cadence with no manual redeploy, and must not serve indefinitely-stale data.
- Given the blog publishes a new post, when a user opens the app within the refresh interval + cache TTL, then the new post appears (target ≤24h end-to-end; ≤1h with warm cache).
- Given a scrape fails, then the app may serve the last good cache **but** records the failure and the data's age, and does not reset its freshness clock to "fresh".
- [ ] Lazy 1h cache retained, **plus** a scheduled refresh (Vercel Cron hitting a refresh route, or route/page ISR `revalidate` aligned to the cadence) so freshness doesn't depend on organic traffic.
- [ ] Silent stale-fallback fixed: on error, log + expose `lastSuccessfulFetch` age; cache TTL is re-checked, not extended, after a failure.
- [ ] Scheduled refresh accounts for the summarization step (P0-3) so ~24 summaries run in the background, not in a user request.
- [ ] Refresh mechanism + interval documented in code + README.

**P0-5 — Bounded chat context (no quality/cost regression).**
`buildArticleContext` (`src/app/api/chat/route.ts`) must assemble grounding from **summaries**, keeping the system prompt within an agreed token ceiling regardless of article count.
- Given ~24 summarized articles, when a chat request is built, then the assembled context stays under the defined token ceiling.
- Given the article count doubles, then the context size grows roughly linearly in summaries (small), not in full bodies.
- [ ] `buildArticleContext` consumes `summary`, not full `body`.
- [ ] Define + enforce a token/char ceiling for the assembled context.
- [ ] System-prompt copy updated from "the Claude blog's 10 most recent articles" to reflect all-recent posts (`chat/route.ts:59`).

**P0-6 — Junk-link / data-quality filtering.**
Exclude non-article links and generic anchor text so the KB and citations stay clean (more important now that we ingest *all* candidates).
- Given an anchor whose visible text is generic ("Read more", "Read article", "Learn more"), then it is not emitted as its own article; the card's heading title is used instead.
- Given a `/blog/category/*` or `/blog/tag/*` link, then it is excluded from candidates.
- Given two anchors resolving to the same slug, then they dedupe to one card keeping the richest (non-generic) title.
- [ ] No item titled "Read more" (or other generic text) can reach the KB. *(Regression test seeded from the observed bug.)*
- [ ] `slugFromHref`/selector rejects `category`/`tag` and other non-post paths.

### Nice-to-Have (P1)

- **P1-1 — Per-article freshness/age surfaced in the sidebar** (e.g. "updated 2h ago") so users trust currency.
- **P1-2 — Graceful empty/partial states** in the sidebar when a refresh is degraded (some bodies/summaries missing) rather than blank cards.
- **P1-3 — Summary quality tuning** — iterate the summarization prompt for consistent length/voice and a reliable "business impact" angle, since summaries now carry the grounding load.

### Future Considerations (P2)

- **P2-1 — Index pagination / "load more"** if the blog ever surfaces posts across multiple pages and we want older ones. (Keep the candidate-fetch loop pluggable.)
- **P2-2 — Persisted corpus + summary cache** (KV/blob) to decouple freshness/summaries from serverless instance lifetime, avoid re-summarizing on every cold start, and enable a future "export" use case.
- **P2-3 — Semantic retrieval** over full bodies if summaries limit answer depth.

## Success Metrics

**Leading (days)**
- **Coverage:** in-KB articles ÷ valid posts on the index = **100%** in a single fetch (baseline 24/24), spot-checked daily for a week.
- **Freshness:** max age of newest in-app article vs. blog ≤ **24h** (alert if > 48h). Directly closes the June 10 vs June 15 gap.
- **Context budget:** assembled chat context ≤ the defined token ceiling on **100%** of requests, even as article count rises; chat p95 latency within +X% of current.
- **Summary efficiency:** a steady-state refresh of unchanged content makes **0** new summary calls (cache hit rate ~100%).
- **Cleanliness:** **0** junk items (generic-text or category/tag) in `/api/scrape` output across daily checks.

**Lagging (weeks)**
- **Answer accuracy:** manual eval set of detail questions — pass rate up vs. excerpt-only baseline, with no drop from summarizing.
- **Cost:** per-chat token cost flat or lower despite ~2.4× more articles (summaries offset full bodies); ingest summary cost within budget.
- **Reliability:** scrape success rate ≥ 99%; zero multi-day stale incidents.

## Open Questions

- **[eng] Confirmed root cause of the June 10→15 gap?** Evidence points to the silent stale-fallback + lazy-only refresh, but verify whether claude.com rate-limits the `AI-Tutor-Bot/1.0` UA or whether ISR/module-cache on Vercel held old data. *(Blocking P0-4 design.)*
- **[eng] Refresh mechanism:** Vercel Cron + refresh route vs. route-segment ISR `revalidate` vs. on-demand revalidation webhook? Cron is most explicit. *(Blocking P0-4.)*
- **[eng/data] Summary spec:** target length, format (plain vs. structured), and whether to bake in the "business impact" line. What token ceiling for the assembled context, and does the chosen summary length meet it for ~24 articles? *(Blocking P0-3/P0-5 final sizing; non-blocking to start.)*
- **[eng] Summary cache key:** slug only, or slug + content hash (to re-summarize on edits)? Where does it live before P2-2 (module cache vs. persisted)?
- **[eng] Ingest cost/latency:** ~24 body fetches + up-to-24 summary calls on a cold refresh — confirm it fits the function timeout and is fully gated by cache (never per-user).
- **[eng] Body safety cap value** — what per-article char/token cap bounds pathological pages without losing real content (and still gives the summarizer enough input)?

## Timeline / Phasing

No hard external deadline. Suggested phasing:

- **Phase 1 (P0-1, P0-2, P0-6):** ingest all articles + full body + junk filtering in `scraper.ts`; rewrite `scraper.test.ts` (currently asserts "returns the 10 most recent") and add a "no 'Read more' / no category links" regression. Ships coverage + cleanliness behind the existing cache.
- **Phase 2 (P0-3, P0-5):** per-article summary on ingest + bounded chat context + copy update. Required before chat is exercised against ~24 articles. *(Can start as soon as P0-2 lands.)*
- **Phase 3 (P0-4):** automatic refresh + observable staleness — closes the reported bug; should run the summarization step in the background. *(Parallelizable with Phase 2.)*
- Then P1s as fast-follows.

## Affected code (for implementers)

- `src/lib/scraper.ts` — remove top-10 cap; ingest all candidates; full-body extraction; junk filtering; refresh/cache; `Article` type gains `body` + `summary`. *(core)*
- `src/lib/summarize.ts` *(new)* — per-article summarization on ingest (Anthropic SDK, cheap model, slug-keyed cache).
- `src/lib/scraper.test.ts:117` — rewrite "10 most recent" assertions for "all articles"; add no-junk regression; cover the dateless-article inclusion case.
- `src/app/api/chat/route.ts:10-11,59` — `buildArticleContext` consumes summaries + enforces the budget; system-prompt copy.
- `src/app/api/scrape/route.ts` — refresh/revalidate wiring if route-level; optional `lastSuccessfulFetch` in the payload.
- `src/components/AppShell.tsx:82` — client fetch; variable article count; optional freshness surfacing (P1).
- `src/components/sidebar/*` — variable article count; optional age/category fixes.
- `README.md` — update "10 most recent posts" claims and document the refresh cadence.
