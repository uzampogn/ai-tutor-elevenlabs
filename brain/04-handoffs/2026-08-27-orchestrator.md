# Orchestrator run review — 2026-08-27

## 1. Headline

**0 items shipped, 1 held for your review, 0 blocked-on-deps.** The article
drawer's score-card digests now live in Postgres and `/api/digest` is a pure DB
read — built, verified, CI-green on [PR #57](https://github.com/uzampogn/ai-tutor-elevenlabs/pull/57),
parked only on the A2 schema gate. The queue is otherwise **empty** (1 of 4
lanes used).

## 2. Needs your decision

### 22-persist-article-digests — approve PR #57 (A2: schema)

- **Observation (verbatim, O7):** "Article drawer content isn't in Postgres." C7: cold-start latency.
- **What was built:** 2 columns (`digest JSONB`, `digest_hash`) on `articles`; digest generation moved into the ingest pipeline; `/api/digest` reads persisted digests only — no LLM in the request path, `maxDuration` removed. A no-DB deployment now skips digesting entirely instead of burning ~24 discarded Sonnet calls per scrape.
- **Evidence:** 582/582 tests green · live ingest wrote 23/23 digests, 0 failed · warm `/api/digest` 0.178s · drawer renders the persisted digest. **Until PR #57 merges, the report + screenshot exist only on the lane branch** (main's `brain/03-build-reports/` is empty): read them at `../ai-tutor-22-persist-article-digests/brain/03-build-reports/22-persist-article-digests/{report.md,drawer.png}` or in the [PR file view](https://github.com/uzampogn/ai-tutor-elevenlabs/pull/57/files).
- **The ask:** review + approve/merge [PR #57](https://github.com/uzampogn/ai-tutor-elevenlabs/pull/57) (CI green, 0 review comments), and ratify the 3 Proposed rows in §4. After you approve, the next `/orchestrate` merges, hits prod, closes the item, frees the lane. Post-merge operational step: one authenticated hit of `/api/scrape/refresh` (or the 06:00 cron) seeds prod digests.
- **Worth knowing:** the worker found and fixed a real serialization bug during empirical verification — postgres.js double-encodes a pre-stringified jsonb bind (`jsonb_typeof = 'string'`); the drawer would have received unusable values. Now regression-pinned in tests. The fresh-eyes gate then caught 2 HIGH defects (the no-DB guard gap, and plan-mandated project-module mocking) — both fixed by a second agent before the PR opened.

## 3. Shipped

Nothing merged this run — the single item is held at the A2 gate above.

## 4. Decisions & drift

Ready-to-paste **Proposed** rows for `brain/00-system/00-decision-log.md`:

| # | Date | Decision | Rationale | Trade-off / alternative rejected | Status |
|---|---|---|---|---|---|
| D8 | 2026-08-27 | `digestStaleArticles` runs only when a DB is configured (`db.isDbConfigured()`); no-DB deploys skip digesting entirely. | Digests are only ever read back from Postgres — generating them with nowhere to land burns ~24 Sonnet calls per scrape and discards every result (breaks D1 graceful degradation, D6 no-burst). | Diverges from `embedStaleArticles`, which guards on its capability key alone; harmonizing the embed path is a separate call. | Proposed |
| D9 | 2026-08-27 | `npm run eval:seed` reads persisted digests from the DB (no ad-hoc generation); operator must ingest first. | Consistent with D6 — generation lives in ingest only. | Seeding against an empty DB yields 0 candidates until an ingest runs. | Proposed |
| D10 | 2026-08-27 | `scraper.test.ts` cache-hit test mocks the digest step so its Anthropic call count measures summarization caching only. | Ingest now digests through the same mocked client; without the mock the count conflates 2 features. | A project-module mock in a test file whose convention already allows it (`scraper.db.test.ts` precedent). | Proposed |

Drift, no action needed: the item's file boundary was amended at the verify
gate (+`scripts/eval/seedDataset.ts`, +`src/lib/scraper.test.ts`) — deleting
`getArticleDigests()` forced its 2 out-of-plan consumers; justification on the
bead. The plan's Task 2 test seam contradicted the spec's own carve-out
(project-module mock) — caught by fresh-eyes, re-seamed onto the `postgres`
driver.

## 5. Next queue

**Empty — queue-starved.** 0 ready items vs the 3–4 an unattended run wants.
Candidates for the next `/design-session`: remaining O1 surface (cold-start of
the article list when the DB is empty — self-heal scrape on the request path),
O4 colour harmonization (would also retire alert rule A3), and the older
FEATURE-BACKLOG.md notes (skills, email summary) per D5 renumbering.

## 6. Successor state

- **Lane 1:** `../ai-tutor-22-persist-article-digests`, branch
  `22-persist-article-digests` — **keep until merge**; worktree + branch are
  removed post-merge per the loop. Bead AT-oxb `blocked` (human A2 review), PR
  state on the bead.
- **Open PRs:** [#57](https://github.com/uzampogn/ai-tutor-elevenlabs/pull/57) — CI green, 0 pending comments, awaiting human (A2).
- **Next actions:** (1) human reviews PR #57 + pastes/ratifies D8–D10 → next
  `/orchestrate` rebases if needed, merges, browser-hits prod `/api/digest`,
  seeds prod digests via `/api/scrape/refresh`, closes AT-oxb, frees the lane;
  (2) run `/design-session` — the queue is empty.
- **Re-verify volatile claims** (CI, comments, branch position) with `gh pr view 57`
  / `gh pr checks 57` — this note describes 2026-08-27 ~15:15Z.
- **Failure-mode ledger:** `queue-starved`, `plan-defect` (plan carried a
  wrong jsonb bind + a spec-contradicting test seam; gates caught both),
  `stop-hook-noise` (fires on every orchestrator wait with a live lane).
