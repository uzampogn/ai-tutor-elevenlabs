# 22-persist-article-digests — build report

**Status:** goal achieved. Digests are persisted in Postgres, generated only at
ingest, and `/api/digest` is a pure DB read. Full quality gate green.

**Branch:** `22-persist-article-digests` · **Worktree:**
`Projects/ai-tutor-22-persist-article-digests`

**Alert rule A2 (data schema) tripped** — `db/schema.sql` + `ensureSchema()`
gained 2 columns. The PR parks for human review before merge.

---

## Done

| Task | Outcome |
|---|---|
| 1 — digest columns + db accessors | `digest JSONB` + `digest_hash TEXT NOT NULL DEFAULT ''` on `articles`; `getDigestStates()`, `updateDigests()`, `getDigests()` in `src/lib/db.ts` |
| 2 — `digestStaleArticles` | Ingest step in `src/lib/digest.ts`; `getArticleDigests()` + the in-memory `digestCache` deleted; `digest.ts` no longer imports `./scraper` |
| 3 — wire into ingest | `scrapeAndPersist()` calls `digestStaleArticles(rows)` after `embedStaleArticles` |
| 4 — `/api/digest` | Rewritten as a pure `getDigests()` read; `maxDuration = 60` removed; no Anthropic import in the request path |
| 5 — gate + empirical verification | See below |

All plan steps followed TDD: failing test → implement → pass → commit. 6 commits.

## Evidence

### Quality gate — green

```
npm run lint       → clean (1 pre-existing warning: ArticleHero.tsx <img>)
npm run typecheck  → clean
npm run test:run   → Test Files 61 passed (61) · Tests 581 passed (581)
```

### Real ingest against the live DB + live Anthropic

Run via a throwaway `tsx --env-file-if-exists=.env.local` harness calling
`getClaudeArticles({ force: true })` (the same path `/api/scrape/refresh`
takes). `CRON_SECRET` is absent from `.env.local`, so the HTTP cron route
fails closed — invoking the ingest function directly exercises identical code.

```
[scraper] digests: 23 written, 0 failed
[verify] forced ingest: 23 articles in 59757ms
[verify] getDigests(): 23 persisted digests in 139ms
```

### Rows in Postgres

```
{ total: '23', with_digest: '23', with_hash: '23' }

slug: ai-ci-cd-on-call                              digest_hash: lkhyax  takeaways: 4  jsonb_typeof: object
slug: anthropics-approach-to-teaching-and-learning  digest_hash: ju9824  takeaways: 4  jsonb_typeof: object
slug: artifacts-in-claude-code                      digest_hash: p0z8v4  takeaways: 4  jsonb_typeof: object
```

`with_digest == total` — no failures to retry.

### `/api/digest` is a pure, fast DB read

```
http=200 bytes=34911   1.293s (first, cold route compile)
http=200 bytes=34911   0.178s (warm)
digest count: 23
value type: dict
keys: ['questions', 'tags', 'takeaways', 'tldr', 'whyItMatters']
```

Well under the 1s target, and no LLM call is structurally possible — the route
imports only `next/server` and `@/lib/db`.

### Client contract holds (drawer no-regression)

Cross-checked the live `/api/digest` keys against the article URLs
`/api/scrape` renders (what `AppShell.tsx:173` consumes):

```
articles rendered: 23
digest keys: 23
articles WITH a digest: 23
articles WITHOUT a digest: []
orphan digest keys: []
```

## Bug found and fixed during empirical verification

The plan's `updateDigests` binding — `${JSON.stringify(r.digest)}::jsonb` —
**silently double-encodes**. postgres.js JSON-encodes a value bound to a
jsonb-cast parameter, so the pre-stringified object landed as a jsonb *string*
(`jsonb_typeof = 'string'`) and `getDigests()` returned strings, not
`ArticleDigest` objects. The drawer would have received unusable values.

Probed all 3 forms against the live DB:

| binding | `jsonb_typeof` | JS type read back |
|---|---|---|
| `${JSON.stringify(obj)}::jsonb` | `string` | `string` |
| `${sql.json(obj)}` | `object` | `object` |
| `${JSON.stringify(obj)}::text::jsonb` | `object` | `object` |

Fixed with `::text::jsonb` (`sql.json()` isn't reachable — `db.ts` wraps the
postgres.js client in a serializing function, per the `max: 1` pooler comment
at `db.ts:23`). Cleared the 23 bad rows, re-ran ingest, re-verified: all
`object`. `db.test.ts` now asserts the `::text::jsonb` cast so a regression
fails a test.

**This class of bug is invisible to the mocked-postgres seam** — the test
asserts SQL text only. Worth remembering for future JSONB columns.

## Deviations from the plan — need orchestrator sign-off

Two consumers of `getArticleDigests()` outside the plan's file boundary broke
`npm run typecheck` once Task 2 deleted it. The gate cannot go green without
them, so I made the minimal repair in each rather than stopping. Both are
non-production files (a test and a dev script); neither changes app behavior.

1. **`scripts/eval/seedDataset.ts`** (`default — unratified`) — now reads
   `db.getDigests()` instead of generating digests on the fly. Consistent with
   D6 (no ad-hoc generation). *Behavior change:* `npm run eval:seed` yields 0
   candidates against an unseeded DB; the operator must run an ingest first.
   Noted in the file's header comment.
2. **`src/lib/scraper.test.ts`** (`default — unratified`) — its cache-hit test
   counts `createMock` calls to assert *summarization* caching; ingest now also
   digests through the same mocked Anthropic client, so the count doubled
   (11 → 22). Added `vi.mock('@/lib/digest', …)` so the test measures what it
   names. No assertion values were weakened.

## Not done

- **Drawer screenshot** (`Task 5 Step 4`). Browser automation (Playwright MCP)
  was not permitted in this non-interactive session, so
  `brain/03-build-reports/22-persist-article-digests/drawer.png` does not
  exist. Substituted the key-intersection check above, which proves the drawer
  receives a well-formed digest for every article it renders. **A human should
  still eyeball the drawer before merge** — the A3 UI gate isn't tripped (no
  `src/components/**` change), but this is the one claim I could not verify
  visually. Marked `unverified`.

## Proposal for the decision log (not built)

`digestStaleArticles` runs whenever `ANTHROPIC_API_KEY` is set, even with no
`DATABASE_URL`/`POSTGRES_URL` — but digests are only ever read back from
Postgres, so a no-DB deployment burns ~23 Sonnet calls per ingest and discards
every result. Guarding the step on "DB configured" would remove that waste.
Not built: it changes ingest semantics beyond this plan, and it would diverge
from `embedStaleArticles`, which guards on its capability key alone. Worth a
decision.

## Blockers

None.
