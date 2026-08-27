---
name: observe
description: Create or open today's observations file in brain/01-observations/ with the O-numbering continued from previous days. Use when the user wants to jot a new observation, idea, or piece of feedback about the app.
---

# /observe — today's observations file

1. `date +%F` → today. Target: `brain/01-observations/<today>-observations.md`.
2. If the file doesn't exist, find the highest O-number across the dated
   files (`grep -h '^O[0-9]' brain/01-observations/*-observations.md`; the
   README's examples don't count; no dated files yet → start at `O0`, the app
   pitch — see the folder README). Create the file seeded with one empty
   pair: `O<next>: ` / `C<next>: `.
3. If the user dictated observations in the invocation, write them in as O/C
   pairs — 2 lines each, unpolished, numbering onward. Otherwise just report
   the file path and the next free id.
4. Nothing else: no beads, no backlog edits. `/design-session` takes it from
   here — it defaults to the newest file in the folder.
