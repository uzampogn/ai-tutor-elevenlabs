# Build Strategy — the dual loop, in detail

> How this repo gets built: 1 orchestrator + up to 4 parallel worker sessions,
> coordinated by contracts, plans, and the backlog. Grounded in:
> [decision log](00-decision-log.md) · [backlog](../02-backlog/BACKLOG.md).

## Topology

```text
                    Human (curation: decisions, reviews, taste calls)
                        │
              Orchestrator session (repo root, persistent)
              plans · contracts · beads (single writer) · reviews · merges
                        │ dispatch / monitor
   ┌──────────┬─────────┴┬──────────────┐
   W1          W2          W3             W4
   (worktree)  (worktree)  (worktree)     (worktree)
```

- **Why 4 workers, not more:** parallelism is bounded by independent *file
  boundaries* and contract stability, not CPU or tokens. A 5th lane that
  shares files creates merge churn that costs more than it parallelizes.
- **4 is a target, not a ceiling to drift under** — the refill rule rides
  with the loop in `/orchestrate`. Fewer than 4 items ready → say so in the
  report, so the design loop can deepen the queue (it should keep 3-4 items
  ready at all times).
- **Each worker session** = own git worktree + own branch + 1 plan file +
  model/effort per §Model & effort + the canonical launch command
  (verbatim in `/orchestrate` step 4).

- **Workers run bare** — no extra workflow skills, no tribal context; their
  rules live in `DUAL-LOOP-HARNESS.md` §Session roles (imported by `CLAUDE.md`). Consequence: the plan is the only
  quality input, so plans carry full code + exact commands, written in the
  design loop (or by the orchestrator).

## Model & effort

**Principle: cheapest tier the item actually needs.** Cost scales with
model × effort; over-provisioning burns budget with no quality gain,
under-provisioning burns it on failed verify gates. The orchestrator decides
per item, at dispatch.

- **Orchestrator: always the frontier model + high effort.** Never downgrade:
  planning, contracts, reviews, and verify gates all ride on this session.
- **Workers: pass both flags explicitly** (never inherit defaults). Rubric:

| Item shape | Model | Effort |
|---|---|---|
| Mechanical / templated (fixture regen, copy sweep, config, doc port) | small (e.g. `claude-sonnet-5`) | `medium` |
| Standard implementation from a complete plan | mid (e.g. `claude-opus-5`) | `high` |
| Cross-cutting, gnarly debugging, contract-adjacent, or plan is thin | frontier (e.g. `claude-fable-5`) | `high` |

- **Escalate on failure, don't pre-pay:** a worker that fails its verify gate
  relaunches 1 tier up rather than retrying at the same tier.
- Record the choice in the plan file header (`model:` / `effort:`) so a
  recovery session relaunches the worker identically.

## The build loop (per item)

The complete per-item loop — take → branch → spec/plan → dispatch → verify
gate → PR → review-comment loop → merge → post-merge → blocked-handling,
with the dispatch command and the fresh-eyes prompt verbatim — lives in
[`/orchestrate`](../../.claude/commands/orchestrate.md), the file guaranteed
in context when the loop runs. Every operating constant lives there and
nowhere else; this playbook holds what the loop assumes: the topology above,
the rubric, and the rules below.

## Coordination rules (what makes parallel safe)

1. **Contracts first, frozen by the orchestrator.** Before workers start,
   `contracts/` holds the interfaces lanes share: data schema, API shape (+ a
   golden fixture), repo layout with per-path ownership. Workers *consume*
   contracts; only the orchestrator changes them (bump = all affected lanes
   notified).
2. **File ownership.** Each lane owns disjoint paths per the repo-layout
   contract, recorded as the item's Owns boundary **on the bead**. A worker
   never edits outside its boundary; cross-boundary needs go to the
   orchestrator.
3. **Beads is the source of truth; BACKLOG.md is a generated view.** Status,
   dependencies and the Owns boundary live on the bead. Only the orchestrator
   (and human-led design sessions) run `bd`, and whoever touches beads
   regenerates `brain/02-backlog/BACKLOG.md` from `bd list --json` in the same
   step — it is never hand-edited, and never syncs back. Workers report via
   plan checkboxes + their own report folder `brain/03-build-reports/<item>/` (1 folder
   per worker/worktree — every file attributable to its lane at a glance) —
   this avoids tracker write conflicts across parallel worktrees. `bv` gives
   the same state as a board + dependency graph if you prefer a TUI.
4. **The orchestrator orchestrates only.** It never writes code, fixes a test,
   or edits an app file itself — dispatch, verify, merge, queue, contracts and
   beads, nothing else. MR-comment fixes, small repairs and investigations all
   go to a background agent or a worker. A hands-on orchestrator stops
   watching the other lanes.
5. **Merges.** Workers commit to their branch; the orchestrator reviews and
   merges. Nothing merges red.
6. **Empirical verification is non-negotiable.** Queries run against the real
   database before commit; any UI change gets a screenshot before DONE; the
   deploy gets a real browser hit.

## Queue sources (where backlog items come from)

The backlog is the buffer between decided work and running lanes — it never
self-feeds. 3 inflows, all through the design loop or the orchestrator:

1. **Design-loop output** — observations turned into spec+plan items by
   `/design-session`: one folder + one bead each, dependencies wired
   (`bd dep`).
2. **Loop exhaust** — verify-gate failures too big to fix inline, deferred
   review comments, deploy breakage. Rule: >15 min of work or outlives the
   current session → backlog item + bead; smaller → fix on the spot.
3. **Answered open questions** — a settled decision usually spawns a build item.

## Human-bound queue (agents can't do these)

Blocked beads surface as 🙋 rows in `brain/02-backlog/BACKLOG.md` — the steps only
you can do: account creation, secrets, access approvals, picking 1 of N visual
directions, scheduling a user preview. The orchestrator parks items on these as `blocked`
and moves on; batch-clear them when you're back at the keyboard.

## Recovery

Beads + plans + reports survive compaction and session death.

- **Worker recovery:** a new session reads `CLAUDE.md` → its plan file → its
  report file, and resumes at the first unchecked task.
- **Orchestrator recovery:** read beads first — `bd ready` (what's unblocked)
  and `bd list --status=in_progress` (what a dead lane left claimed) → `git log`
  + `brain/03-build-reports/` (what actually happened) → resume the loop, regenerating
  `brain/02-backlog/BACKLOG.md` once state is straight. The markdown is the human
  view; never recover from it. `/status` gives a human the same read, read-only.
- **Session handoff:** an orchestrator close-out (or an interrupted design
  session) writes `brain/04-handoffs/<date>-<role>.md` per the handoff contract
  in [`02-handoff-contract.md`](02-handoff-contract.md). A successor reads the
  newest handoff first, then **re-verifies its volatile claims** (CI state,
  branch position, pending comments) with commands — a handoff describes the
  world as of its writing.
- **Session close:** `bd export -o .beads/issues.jsonl` before ending any session; the
  Stop hook (`.claude/hooks/stop-bead-check.sh`) blocks a session from ending
  with unhandled in-progress beads.
