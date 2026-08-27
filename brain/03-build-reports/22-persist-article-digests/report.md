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
npm run test:run   → Test Files 61 passed (61) · Tests 582 passed (582)
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

## Verify-gate findings — fixed

Two findings from the orchestrator's verify pass. File boundary respected
(`src/lib/digest.ts`, `src/lib/digest.test.ts`, `src/lib/db.ts`,
`src/lib/db.test.ts` only); gate re-run green afterwards.

### 1 — no-DB guard on `digestStaleArticles` (`default — unratified`)

The step guarded only on the Anthropic client. With `ANTHROPIC_API_KEY` set and
no `DATABASE_URL`/`POSTGRES_URL`, `getDigestStates()` returns an empty map, so
every article reads as stale → a full ~24-call Sonnet burst per scrape whose
results `updateDigests()` silently discards. Spec §Desired behavior 4 / D6 want
a no-DB deploy to degrade, not to pay.

- `db.ts` exports `isDbConfigured()` (`sql !== null` — the same connection-string
  detection every accessor already no-ops on), and `digestStaleArticles()`
  returns `{ digested: 0, failed: 0 }` early when it's false.
- TDD: the test was written first and failed with `{ digested: 1, failed: 0 }`
  — i.e. it reproduced the wasted call — then passed once the guard landed.

Labelled `default — unratified`: it makes the digest step diverge from
`embedStaleArticles`, which still guards on its capability key alone. That
divergence is the decision worth ratifying (the argument is unchanged from the
proposal this section replaces).

### 2 — `digestStaleArticles` tests re-seamed onto the postgres driver

The new tests mocked `./db`, a project module. The spec's §Known tension
carve-out permits new tests to mock **only** system boundaries, and this is the
precise seam where the `::text::jsonb` double-encoding bug hid — a `./db` mock
is blind to it by construction.

- The `sqlMock`/`postgresMock` pattern from `db.test.ts` now backs the block, so
  the real `db.ts` executes. The stub routes on SQL text rather than call order,
  so schema DDL can grow without rewriting expectations.
- All 4 behaviors kept, none weakened: persists a digest, skips unchanged
  content with 0 API calls, counts a null digest failed without persisting,
  degrades to zero counts on a DB error. The persist assertion is now
  *stronger* — it asserts the `::text::jsonb` cast, the parsed digest payload,
  the bound slug, and a non-empty hash on the actual UPDATE.
- Older `getArticleDigests`-era tests and other files' conventions untouched.

```
npm run lint       → clean (1 pre-existing warning: ArticleHero.tsx <img>)
npm run typecheck  → clean
npm run test:run   → Test Files 61 passed (61) · Tests 582 passed (582)
```

Both fixes are unit-verified only; no live-DB or live-Anthropic re-run was
needed, since neither changes the configured-DB path exercised by the empirical
evidence above.

## Blockers

None.
