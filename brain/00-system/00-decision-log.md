# Decision Log — AI News Tutor (ai-tutor)

> Living record of decisions with rationale + trade-off. Newest at the bottom.
> This file is the **shared memory** of the dual loop: workers have no memory
> across sessions, so anything not written here gets re-argued 50 times.
> Decisions are **settled** — sessions cite D-numbers, they never re-litigate.
>
> **Precedence — when artifacts disagree:**
> 1. The newer decision wins on the same topic (follow Superseded pointers).
> 2. For questions about *current behavior*, live code beats any document —
>    read the code, then flag the stale doc in your report. The spec of the
>    item in flight still states intent: the verify gate holds the diff to
>    it.
> 3. Agents cite and propose, they never resolve: this file changes only by
>    a human's hand — directly, or through the human-led `/design-session`
>    locking what the human just chose. A worker's labeled default surfaces
>    in the run review as a ready-to-paste **Proposed** row; a human pastes
>    it here and locks it, or rejects it.
>
> Status legend: **Locked** (agreed) · **Proposed** (a built, running default
> awaiting ratification) · **Open** (still being decided) · **Superseded by
> Dn** (no longer current — follow the pointer).

## Alert rules — changes that wait for a human

Some changes are hard to revert. A worker that touches any surface below still
builds the full change, but the PR **parks for human review before merging**:

| Rule | Surface | Why |
|---|---|---|
| A1 | `contracts/` — how components talk to each other | Every parallel lane depends on it; a silent change breaks all of them. |
| A2 | Data schema (migrations, table shapes) | Data structure mistakes outlive the session that made them. |
| A3 | Visual design (UI components, layout, styling) | The area where agent judgment is weakest. Drop this rule once your visual direction is set and speed matters more. |

| A4 | `eval/dataset.json`, `eval/baseline.json`, prompts, retrieval, citations | Quality gate doesn't cover RAG quality — `npm run eval` (live tokens) must run before these merge (D4). |

## Decisions

Seeded 2026-08-27 at harness adoption (ADOPTING.md step 6) from what the repo
has already settled — 21 shipped specs, live deploy.

| # | Date | Decision | Rationale | Trade-off / alternative rejected | Status |
|---|---|---|---|---|---|
| D1 | 2026-08-27 | Stack = Next.js 14 + React 18 + TS 5 + Tailwind 3; @anthropic-ai/sdk (explanations), ElevenLabs (TTS + timestamps, STT Scribe v2 + Web Speech fallback), Voyage embeddings → Supabase pgvector (optional), Langfuse tracing/evals (optional); Vitest. | Shipped and live — 21 specs built on it; optional keys degrade gracefully. | Locked into ElevenLabs latency/pricing; pgvector over a dedicated vector DB. | Locked |
| D2 | 2026-08-27 | Deploy = Vercel via GitHub Actions (`.github/workflows/deploy.yml`), live at https://ai-tutor-elevenlabs.vercel.app; PR-based flow into `main`. | Zero-ops, preview per PR. | Vercel lock-in; serverless limits on long-running audio jobs. | Locked |
| D3 | 2026-08-27 | Visual direction = whiter/cleaner, conversation-first UI (specs 00, 01, 03); Impeccable is the design playbook (local detector hook — one playbook per task). | Direction proven across specs 00–06. | Colour harmonization still queued (O4) — direction not final, so alert rule A3 stays on. | Locked |
| D4 | 2026-08-27 | Quality gate = `npm run lint` + `npm run typecheck` + `npm run test:run`, all green before push. `npm run eval` is separate — run before merging anything touching retrieval, prompts, or citations. | Gate stays fast and keyless; eval spends real tokens and needs keys + DB. | RAG regressions can pass the gate — eval discipline is procedural (alert rule A4). | Locked |
| D5 | 2026-08-27 | Harness adoption: `spec/` frozen read-only (specs 00–21 + FEATURE-BACKLOG.md + FEATURE-NOTES.md preserved in place); `brain/02-backlog/` is the only live queue; item numbering continues at **22+**, never reused; worktrees = `../ai-tutor-<item-slug>` per `/orchestrate` (replaces `ai-tutor-wt-<feature>`). | One queue, one numbering line, zero data loss at migration. | Old docs/branches still reference the `wt-` worktree naming. | Locked |
| D6 | 2026-08-27 | Persist article digests in Postgres: `digest JSONB` + `digest_hash` columns on `articles`; generation moves into the ingest pipeline (`scrapeAndPersist` → `digestStaleArticles`, cron-driven); `/api/digest` becomes a pure DB read — no request-time generation. Missing digest → existing description-fallback card until next ingest. | Cold instances regenerated ~24 Sonnet digests per boot (O7/C7, `maxDuration=60` existed for this); a DB read closes the drawer's cold-start cost. | New articles show a degraded card up to ~24h (cron cadence); rejected: request-time lazy backfill (reintroduces the cold-start LLM burst). Trips A2 at merge. | Locked |
| D7 | 2026-08-27 | Design-session outputs (spec, plan, decision log, BACKLOG regen, bead export) commit **directly to `main`** — no PR. PRs belong to the build loop; the harness's "no docs-only PRs" rule binds the build loop only, and brain-file updates ride the orchestrator's PRs. | Design output is always docs-only, so a PR-gate on it can never satisfy the no-docs-only-PR rule; direct commit keeps the queue on `main` where the loops read it. | Loses PR review on design docs — the human already reviewed in the interview; a bad spec is still caught by the verify gate. | Locked |
<!-- Every /design-session appends its locked decision here. -->
