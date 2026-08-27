# Contract · Data schema
> v1.0 · FROZEN 2026-08-27 · owner: orchestrator · alert rule A2.

The authoritative schema is **live code**: [`db/schema.sql`](../db/schema.sql)
(precedence rule 2 — code beats documents). This contract freezes the rule, not
a copy:

- Any migration or table-shape change goes through the orchestrator; the PR
  parks for human review (A2).
- Embedding storage is Supabase pgvector as wired in `src/lib` — dimensions and
  index type follow `db/schema.sql`, never a worker's assumption.
- Golden fixture for retrieval/eval work: [`eval/dataset.json`](../eval/dataset.json)
  with scores baselined in [`eval/baseline.json`](../eval/baseline.json) — both
  frozen under alert rule A4; workers consume, never regenerate.
