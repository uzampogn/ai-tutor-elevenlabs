# Contract · Repo Layout & File Ownership
> v1.0 · FROZEN 2026-08-27 · owner: orchestrator. Change = version bump + alert rule A1.

| Path | Contents | Who writes |
|---|---|---|
| `src/app/` | Next.js routes + API handlers | item lane owning the feature |
| `src/components/` | React components | item lane owning the feature |
| `src/lib/` | Shared logic (TTS, STT, RAG, Langfuse) | item lane; cross-lane change = blocker, route via orchestrator |
| `src/test/` | Vitest suites | each lane, tests for its own seams |
| `db/schema.sql` | Postgres/Supabase schema | orchestrator-reviewed (alert rule A2) |
| `eval/` | Golden dataset + baseline | frozen (alert rule A4) |
| `spec/` | Historical specs 00–21 | **nobody** — read-only reference (D5) |
| `brain/02-backlog/<item>/` | spec.md + plan.md per item | design sessions only |
| `brain/03-build-reports/<item>/` | report.md + evidence | each worker, **own folder only** |
| `contracts/` | This folder | **orchestrator only** |

1. A worker never writes outside its plan's file boundary. Cross-boundary need → record in report, stop that task.
2. Parallel lanes touching `src/lib/` or `src/app/api/` need their shared shape frozen here first (api-contract.md + fixture) — single-lane runs may skip that.
