# Observations — 2026-08-27

Seeded at harness adoption from `spec/FEATURE-NOTES.md` (source kept, read-only).

O1: Cold start is slow — articles + summaries fetched on demand.
C1: First interaction feels broken; users bounce before the tutor says a word.

O2: Read-along highlighting lags when the text is long.
C2: The product's signature feature (word-level sync) degrades exactly on the content it exists for.

O3: Orb takes too much space on screen.
C3: Less room for the text users are supposed to read along with. (Prior art: spec/06-reduce-orb-size + WIP stash on feat/orb-size-reduction.)

O4: Colour scheme is disharmonious — red should move toward green, "like a sunshine".
C4: Visual tone fights the calm-tutor positioning.

O5: No /handoff + /teach skills (matt pocock style) in the repo.
C5: Session knowledge and teaching flows aren't reusable across sessions.

O6: No email with the conversation script + high-level summary after a session.
C6: Learning evaporates when the tab closes; nothing to review later.

O7: Article drawer content isn't in Postgres. → 22-persist-article-digests
C7: Cold-start latency (see O1) — every session rebuilds what a DB read would answer.
