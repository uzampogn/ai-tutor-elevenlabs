---
description: Where the build stands — read-only, no dispatching
---

# Status

Report where the build stands. **Read-only:** do not claim, dispatch,
merge, or edit anything.

1. Run `bd ready` and `bd list --status=in_progress` first — beads is the
   source of truth. Then read `brain/02-backlog/BACKLOG.md` (its generated human
   view), the newest `brain/04-handoffs/` note, and scan the latest entries in
   `brain/03-build-reports/*/report.md` and `git log --oneline -15`.
2. Summarize in one short block: items done / in progress / ready /
   blocked (one-line reason each) · evidence worth a look (screenshots,
   failed gates, parked PRs) · suggested next action (`/orchestrate`, a
   `/design-session`, or a human review of a parked PR).
