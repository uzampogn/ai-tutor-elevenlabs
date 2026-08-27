# Observations — the design loop's raw input

Data folder: one file per day, `<YYYY-MM-DD>-observations.md`, created by
`/observe` — O-numbers are global across files, so an id like `O17` stays
unique forever. As the first user of your app, jot what doesn't work in 2
unpolished lines per item — **O** = what you observed, **C** = the
consequence (why it matters) — then run 1 `/design-session` per observation.
Example pair, showing the level of polish (i.e. none):

O1: Metric drawer UI/UX is poor. Too much text, formula not rendered.
C1: Users skip the drawer, so they act on numbers they don't understand.

A covered observation gets `→ <NN-item-slug>` appended to its O line. Day 0,
no app yet? `O0` = your 2-line app pitch — the first `/design-session`
bootstraps the build from it.
