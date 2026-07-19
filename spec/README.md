# Specs

Feature specs for ai-tutor, one folder per feature, numbered in the order the spec
was first written. The numbering is a historical record — it reflects when work
started, not priority or dependency order. Numbers are never reused or renumbered.

Each folder typically holds `spec.md` (what and why) and `plan.md` (how), plus any
supporting docs. Larger features chunk into numbered sub-specs (`00-overview.md`,
`01-…`) with their own plans.

| # | Spec | Started |
|---|---|---|
| 00 | [ui-reskin-whiter-cleaner](00-ui-reskin-whiter-cleaner) | 2026-06-10 |
| 01 | [conversation-first-redesign](01-conversation-first-redesign) | 2026-06-13 |
| 02 | [testing-strategy](02-testing-strategy) | 2026-06-13 |
| 03 | [conversation-first-cleanup](03-conversation-first-cleanup) | 2026-06-13 |
| 04 | [layout-fix-sidebar-content-centering](04-layout-fix-sidebar-content-centering) | 2026-06-13 |
| 05 | [center-welcome-composition](05-center-welcome-composition) | 2026-06-13 |
| 06 | [reduce-orb-size](06-reduce-orb-size) | 2026-06-13 |
| 07 | [blog-ingestion](07-blog-ingestion) | 2026-06-16 |
| 08 | [stt-silence-timeout](08-stt-silence-timeout) | 2026-06-16 |
| 09 | [sidebar-collapse-animation](09-sidebar-collapse-animation) | 2026-06-17 |
| 10 | [sidebar-mark-toggle](10-sidebar-mark-toggle) | 2026-06-17 |
| 11 | [tailored-tutor-prompt](11-tailored-tutor-prompt) | 2026-06-17 |
| 12 | [article-score-card](12-article-score-card) | 2026-06-17 |
| 13 | [chat-latency](13-chat-latency) | 2026-06-18 |
| 14 | [mobile-responsive-design](14-mobile-responsive-design) | 2026-06-19 |
| 15 | [stt-transcript-dedup](15-stt-transcript-dedup) | 2026-06-19 |
| 16 | [kb-postgres-store](16-kb-postgres-store) | 2026-06-19 |
| 17 | [kb-supabase-migration](17-kb-supabase-migration) | 2026-07-04 |
| 18 | [read-along](18-read-along) | 2026-07-14 |
| 19 | [rag-retrieval-citations](19-rag-retrieval-citations) | 2026-07-14 |
| 20 | [eval-harness](20-eval-harness) | 2026-07-18 |
| 21 | [scribe-stt-migration](21-scribe-stt-migration) | 2026-07-18 |

Not specs, kept at the root of this folder:

- `FEATURE-BACKLOG.md` — candidate features not yet specced.
- `FEATURE-NOTES.md` — running notes across features.

## Adding a spec

Take the next free number and create `NN-<kebab-name>/`. Follow the feature
workflow in the repo `CLAUDE.md`: research → spec → sync → plan → implement.
