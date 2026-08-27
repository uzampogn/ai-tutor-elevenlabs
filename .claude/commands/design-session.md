---
description: Run one design-loop session — turn a 2-line observation into a locked decision, a spec, and a plan in the backlog
argument-hint: [observations file — default: newest in brain/01-observations/] [observation id, e.g. O3]
---

# Design session: $ARGUMENTS

You are running one session of the **design loop**: observations in, decisions
out. The human decides what to build; you turn 2-line observations into
build-ready backlog items. The output of this session is one
`brain/02-backlog/<item>/` folder containing a spec and a plan.

## Step 1 — Pick the observation

Read the observations file given in `$ARGUMENTS` — none given → the newest
`<date>-observations.md` in `brain/01-observations/`. If an observation id was
given (e.g. `O3`), work on that one; otherwise list the observations not yet
covered by a backlog item and ask the human which to take (one session per
item — don't batch).

**Day 0 — no app yet?** The pitch is the observation: take `O0` (the 2-line
app idea) and run this session on it. Its output is the opening backlog
items — the walking skeleton (repo skeleton + CI green + hello-world deploy)
and the v1 `contracts/` freeze — per the playbook's bootstrap step.

## Step 2 — Interview the human (brainstorm)

Use the Superpowers **brainstorming** workflow if the plugin is installed;
otherwise run the same shape yourself:

- Explore how the app currently works in the area the observation touches —
  read the code, run the app if needed. Ground the conversation in reality.
- Ask questions **one at a time**, like a pairing partner. Bounce ideas back
  and forth. The human has broad context you don't — extract it.
- Check `brain/00-system/00-decision-log.md` first: settled decisions are not
  re-opened, they are cited.
- Propose 2–3 options with trade-offs and your recommendation. For UI work,
  show mockups (Superpowers visual companion) rather than describing layouts
  in prose.

The human picks one option. That's the session's decision point.

## Step 3 — Lock the decision

Append the decision to `brain/00-system/00-decision-log.md`: what was decided,
the rationale, the trade-off accepted, the alternative rejected. If the
decision changes a contract, a schema, or the visual direction, say so
explicitly — those trigger the alert rules at merge time.

## Step 4 — Write the spec and the plan

Take the next free number `NN` in `brain/02-backlog/` and create
`brain/02-backlog/<NN-item-slug>/`. The number is a historical record (when
design started): append-only, never reused, never renumbered — beads owns
priority and sequencing. The branch, worktree, and build-report folder all
reuse this exact `NN-item-slug` name. The folder holds:

- **`spec.md`** — what to build and why: the observation, the locked decision,
  the desired behavior, what's explicitly out of scope.
- **`plan.md`** — how to build it, written for a **bare worker with no tribal
  context**. Use the Superpowers **writing-plans** workflow if installed. The
  plan must carry:
  - a header with `model:` and `effort:` (see the rubric in
    `brain/00-system/01-build-strategy.md`),
  - the **file boundary** — exact paths the worker owns, and the paths it must
    never touch,
  - the **seams under test** — the public interfaces where behavior is
    verified, agreed with the human in the interview; the worker writes no
    test at any other surface,
  - complete code snippets and exact commands, not descriptions,
  - checkbox steps, TDD-ordered (test first, then implementation),
  - the empirical verification the worker must produce (test command,
    query, screenshot).

## Step 5 — Register the item

Beads is the source of truth, so the bead carries everything:

1. `bd create "<item title>"`, then put the **1-line user outcome** (what
   this item buys the user — distilled from the observation's C line and the
   locked decision), the **file boundary** (the paths the item owns), and the
   `brain/02-backlog/<NN-item-slug>/spec.md` + `plan.md` paths in its
   description or notes. Wire dependencies with `bd dep`.
2. Regenerate `brain/02-backlog/BACKLOG.md` from `bd list --json` — it is a
   generated human view (item, outcome, status, files owned, deps, bead id),
   never hand-edited.
3. Mark the observation covered in the observations file: append
   `→ <item-slug>` to its `O` line.

If several items are queued, identify dependencies between them so the build
order is clear — items with disjoint file boundaries and no dependency can
run as parallel lanes.

## Step 6 — Hand off

Close the session with exactly three things:

1. **What landed where:** the `brain/02-backlog/<item>/` folder, the bead id, the
   decision number.
2. **What's still uncovered:** the observations without a backlog item yet.
3. **The build handoff, verbatim** — how many items `bd ready` now shows
   against the 3–4 an unattended run wants (below that the loop starves
   mid-run — name the uncovered observation to design next), and the next
   command, so the human can paste it:

   > N of the 3–4 items an unattended run wants are ready. To start the
   > build loop, open a fresh session and run:
   >
   > ```
   > claude --model claude-fable-5 --effort high
   > > /orchestrate
   > ```

**Interrupted mid-session?** Write `brain/04-handoffs/<date>-design.md` per
the design contract in `brain/00-system/02-handoff-contract.md`: the
observation, what the interview established, the options on the table — so
the next session resumes instead of restarting the conversation.
