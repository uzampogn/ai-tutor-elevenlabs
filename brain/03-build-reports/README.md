# Build reports — how workers talk to the orchestrator

Data folder: 1 folder per worker, `<NN-item-slug>/` — same name as the
item's backlog folder, branch, and worktree — holding `report.md` (what's
done · evidence · blockers) plus screenshots, so `ls` here reads as shipping
history. The contract lives in the worker rules of
[`DUAL-LOOP-HARNESS.md`](../00-system/DUAL-LOOP-HARNESS.md); worked example:
[`00-example-metric-drawer/report.md`](00-example-metric-drawer/report.md).
