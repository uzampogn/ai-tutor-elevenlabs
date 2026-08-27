---
description: Start (or resume) the build loop — deliver every unblocked backlog item autonomously
argument-hint: [optional focus, e.g. "items 3-7 only" or "single lane"]
---

# Orchestrate: $ARGUMENTS

You are the **orchestrator** for this repository. This command carries the
complete per-item loop: every operating constant and command lives here and
nowhere else. The playbook, `brain/00-system/01-build-strategy.md`, carries
what the loop assumes — topology, the model/effort rubric, coordination
rules, queue sources, recovery — **read it now**. Decisions in the decision
log are settled; never re-litigate them.

## 1. Recover state

Read in order: repo `CLAUDE.md` → `brain/00-system/00-decision-log.md` (settled
decisions + alert rules) → the newest `brain/04-handoffs/*-orchestrator.md` →
`bd ready` + `bd list --status=in_progress` (**beads is the source of truth**)
→ `brain/02-backlog/BACKLOG.md` (its generated view), `git log`, `brain/03-build-reports/`.
Trust these over memory of past sessions — and treat every volatile claim
(CI state, branch position, pending comments, blocked reasons) as stale until
re-verified with a command, wherever it came from: docs, beads, and handoffs
describe the world as of their last edit. Acting on a stale claim is this
loop's #1 failure mode (e.g. resurrecting an already-fixed blocker as a live
P0).

## 2. Report before dispatching

Tell the human where the build stands in one short paragraph: items done / in
progress / ready / blocked (with the one-line reason per blocked item), how
many lanes can run right now against the target of **4**, and which item you
are starting with.

## 3. Run the per-item loop

Run the loop below until no unblocked backlog items remain (or per
`$ARGUMENTS`). **Saturate the lanes:** aim for 4 workers in parallel — at
every tick, refill every free lane with an unblocked item whose file boundary
is disjoint from the running lanes.

**Bootstrap runs once, before the loop:** repo skeleton → CI green →
hello-world deploy (a *walking skeleton*: prove the deploy path on day 1, or
consciously freeze it and build against a local run). Then `bd init`.

1. **Take** — `bd ready`; claim the item (`bd update <id> --status=in_progress`),
   then regenerate `brain/02-backlog/BACKLOG.md` from beads in the same step.
2. **Branch** — pull latest `main`; `git worktree add ../<repo>-<item> -b <item-slug>`.
3. **Spec → plan** — `brain/02-backlog/<item>/{spec,plan}.md`, normally produced by the
   design loop. Plan missing or thin → the orchestrator writes it first. The
   plan's file boundary must match the Owns boundary on the bead.
4. **Execute** — headless worker in the worktree, model + effort per the
   playbook's rubric:

   ```bash
   claude -p "/goal deliver everything in brain/02-backlog/<item>/plan.md until all tests pass. Verify your work empirically. Tests follow the plan's seams and the DUAL-LOOP-HARNESS.md test rules." \
     --model <model> --effort <effort> --permission-mode acceptEdits
   ```

   launched as a background process — its completion re-invokes the
   orchestrator; that notification **is** the loop tick (no polling).
   Residual permission prompts are smoothed by the allowlist in
   `.claude/settings.json`.

   *Optional — [herdr](https://github.com/herdrdev/herdr) for live lane
   visibility.* If installed, dispatch inside a pane instead:
   `herdr pane run w<n>:p1 "claude -p '…'"` (no trailing `&` — the herdr server
   does the backgrounding), with a background `herdr agent wait <pane> --until done`
   as the loop tick. All 4 lanes then stay watchable in 1 terminal. Not
   installed → plain background dispatch above, unchanged.
5. **Verify gate (4-part, before any PR):** tests green · **empirical proof**
   (run the app / execute the query / screenshot the UI) · **boundary check** —
   `git diff --name-only main...<item-slug>` lists only paths inside the
   item's Owns boundary (from the bead); any path outside fails the gate ·
   **spec + test-quality compliance** by a fresh-eyes agent, dispatched with
   exactly:

   > Fresh eyes — you know nothing about this build. Read
   > `brain/02-backlog/<item>/spec.md`, then the diff
   > (`git diff main...<item-slug>`). Report every place the diff contradicts
   > or silently drops a spec requirement, and every test that cannot fail:
   > expected values recomputed the way the code computes them, mocks of the
   > project's own modules, assertions on internals instead of the spec's
   > public surface. HIGH = spec broken or a test that can't fail, LOW =
   > cosmetic drift. HIGH findings block the PR.
6. **PR** — `gh pr create` (or `glab mr create`), then record the PR URL and
   state on the bead (`bd update <id> --notes` or a comment) — in-flight state
   lives on the bead, not in session memory. Merge gates: CI green ·
   review comments drained (step 7) · **alert-rule items wait for the human —
   never ship unseen**.
7. **Review-comment loop** — after *every* push to an open PR/MR, initial or
   fix: `sleep 120` (bots need ~2 min) → `gh pr view --comments` /
   `glab mr note list` → triage. For each important comment, first verify it
   is actually **right**; a wrong comment gets a reply, not a code change.
   Real ones go to a background fix agent — never fix in the orchestrator
   session. The fix push restarts this step; loop until no important comments
   remain.
8. **Merge** — merge when the pipeline succeeds; parallel lanes rebase on
   `main` before merging. Rebase conflicts have an owner: trivial ones the
   orchestrator resolves in the lane's worktree (the 1 exception to "never
   edits app files"); non-trivial ones → relaunch the worker with a
   rebase-first step prepended to its plan. Never leave a conflict unowned.
9. **Post-merge** — the item is done only after the deploy check: a real
   browser hit on the deployed app (or a local run if not deployed yet) →
   `bd close <id>` → regenerate `brain/02-backlog/BACKLOG.md` **in the same step**
   → free the lane: `git worktree remove ../<repo>-<item>` +
   `git branch -D <item-slug>` (a stale worktree blocks re-dispatch; plain
   `-d` refuses after a squash-merge, and post-merge the branch is
   disposable).
   A stale backlog breaks the human's read of the build.
10. **Blocked on a human?** `bd update <id> --status=blocked` with one line on
    what's needed, regenerate the backlog view, take the next unblocked item —
    never stall a lane silently. Park only what's genuinely human-bound: a
    missing low-risk decision gets a labeled, unratified default instead
    (worker rule in `DUAL-LOOP-HARNESS.md`); surface those defaults in the close-out
    handoff for ratification.

## 4. Close out

Before ending, every in-progress item is merged + closed, parked `blocked` with
a reason, or has a current report a successor can resume from. Then:

1. Write the **run review** `brain/04-handoffs/<date>-orchestrator.md` per
   the orchestrator contract in `brain/00-system/02-handoff-contract.md`
   (read it now — its section list is the law): the one document the human
   reads to review the run.
2. Regenerate `brain/02-backlog/BACKLOG.md` from `bd list --json`.
3. `bd export -o .beads/issues.jsonl` — beads is the restart point.
