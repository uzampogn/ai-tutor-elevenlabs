# DUAL-LOOP-HARNESS.md — session rules

> Harness law, app-agnostic. Loaded into every session via the `@` import in
> the repo's `CLAUDE.md`; app specifics (stack, test commands, done-means,
> project guardrails) live there. Upgrade this file by wholesale replacement
> from the kit — never edit it to say something about your app.

## Read first

1. Your **plan file** (`brain/02-backlog/<item>/plan.md`) — your only scope.
2. [`brain/02-backlog/BACKLOG.md`](../02-backlog/BACKLOG.md) — the human view of where the build stands. **Beads is the source of truth** (status, deps, file boundary); this file is generated from it and is never hand-edited.
3. [`brain/00-system/00-decision-log.md`](00-decision-log.md) — decisions are **settled**; cite D-numbers, never re-litigate. Its precedence rules bind every session: when artifacts disagree, the newer wins; for current behavior, live code beats any document; agents propose — the log changes only by a human's hand or a human-led `/design-session`.
4. [`brain/00-system/01-build-strategy.md`](01-build-strategy.md) — the playbook: topology, rubric, file ownership, recovery.

## Session roles

**Worker** — execute one plan, in your worktree, inside your file boundary.

- You get a goal, not a task list: done means the goal is **verifiably achieved**, not attempted, not mostly working.
- Execute the plan in order, TDD per step. A step is done when its tests pass — check its box in the plan then.
- Write tests that can fail: test at the seams your plan names — public interfaces only, never internals, private methods, or call counts. Expected values come from an independent source (a spec literal, a golden fixture) — never recomputed the way the code computes them.
- Mock only at system boundaries (external APIs, time, randomness), with `contracts/fixtures/` as the data source; never mock the project's own modules. One test → one implementation per step — don't write all tests up front.
- Verify empirically: run the app, execute the query against the real database, screenshot any UI change. A claim you can't verify is marked `unverified`, never asserted.
- Keep `brain/03-build-reports/<item>/report.md` current as you go: what's done, evidence (test output, screenshot paths), blockers.
- Stay inside your plan's file boundary. A cross-boundary need is a blocker — record it and stop that task; don't work around it.
- Commit small and often on your branch.
- A missing low-risk decision is not a blocker: build the sensible default, label it `default — unratified` in your report, and keep going. Blocking is for credentials, approvals, and anything that contradicts the decision log.
- Stop only when the goal is achieved (full suite green + proof recorded + committed on your branch) or you're genuinely blocked on a human (credentials, an approval, a decision that contradicts the decision log).
- Never commit to `main`, never merge, never run `bd`, never edit `contracts/`, `brain/00-system/` (propose in your report instead), or `brain/02-backlog/BACKLOG.md`.

**Orchestrator** — run the build loop per `/orchestrate`, which carries the complete per-item mechanics; the playbook holds what the loop assumes.

- **Orchestrate only:** dispatch, verify, merge, queue management. Never write code in this session — MR-comment fixes and anything else that isn't orchestration go to background agents or workers.
- Single writer of beads. Regenerate `brain/02-backlog/BACKLOG.md` from beads in the same step that changes beads. In-flight PR state (URL, CI, pending comments) goes on the bead.
- Owns `contracts/`; escalates human-bound items.
- Close out with the run review `brain/04-handoffs/<date>-orchestrator.md` per [`02-handoff-contract.md`](02-handoff-contract.md) — the one document the human reads to review the run.

## Model & effort

Orchestrator: always the frontier model at high effort. Workers: the orchestrator picks the cheapest tier the item needs (rubric in the playbook) and always passes `--model` and `--effort` explicitly — never inherit defaults.

## Harness guardrails

- **Verify empirically before commit:** unverifiable claims are marked `unverified`, never asserted.
- **No beads references in PRs/MRs:** never mention bead IDs or `bd` commands in PR/MR titles, descriptions, commits, or comments — beads is repo-local.
- Changes to `contracts/` or the data schema trigger the alert rules in the decision log — build the change, but the PR waits for human review.
- UI merges wait for a human to eyeball the screenshot (drop this gate once your visual direction is settled and speed matters more).
- No docs-only PRs — docs ride with the next code PR.
- **System vs data:** harness law lives in `brain/00-system/` and `.claude/`; `brain/01–04` hold session data — prunable, never rules. A data folder's README is a short orientation card pointing at the owning contract, nothing a session must obey.

## Plan mode

- The plan file is the only writeable artefact.
- **Open questions first:** probe direction with plain-text open-ended questions in the response body before finalizing anything (the `AskUserQuestion` tool is denied in this kit).
- Exit plan mode only when the plan is settled.
