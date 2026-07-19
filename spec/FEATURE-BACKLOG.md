# AI Tutor — Feature Backlog (Beginner → Intermediate)

## Objective

Push this agentic app from "beginner" to **intermediate** engineering sophistication — as a portfolio piece proving I can architect and ship non-trivial AI systems solo. Each new capability must earn its place through a real **user outcome**, not just a reviewer checklist.

## Capabilities

| # | New technical capability | User outcome | Intermediate signal | Depends on | Effort |
|---|---|---|---|---|---|
| 1 | **Multi-source ingestion** — YouTube transcripts, GitHub repos, Substack/blogs | "I learn from practitioners, talks, and real code — not just Claude's official posts. Broader, more current, less vendor-framed." | Heterogeneous ETL / connectors | — | L |
| 2 | **RAG retrieval + citations** | "I can ask about a *topic* across everything, and every claim links to a source I can check. I trust it and can go deeper." | Embeddings, retrieval, grounding | 1 (or today's source) | M |
| 3 | **Multi-perspective debate** — optimist / skeptic / practitioner | "Instead of one confident answer, I see how experts disagree — I grasp the tradeoffs and don't get false certainty." | Multi-agent orchestration | 2 | M |
| 4 | **Adversarial critique / red-team pass** | "Before I act, the tutor attacks the recommendation and surfaces risks & failure modes — I avoid predictable mistakes." | Reflection / self-critique loop | 3 or 5 | S–M |
| 5 | **Use-case → actionable plan with milestones** | "I bring *my own* problem and leave with a concrete staged plan — what to do first, next, how to tell it's working." | Structured/typed output + planning | 3 (or standalone) | M |
| 6 | **Comprehension checks / active recall** | "It quizzes me on what I just learned so I actually retain it — active learning, not passive listening." | Pedagogy loop, structured gen | — (scaffolding exists) | S |
| 7 | **Personalized memory / learner profile** | "It remembers what I know and what I'm building, stops re-explaining basics, and tailors depth to me over time." | State/memory, personalization | persistence layer | M–L |
| 8 | **Reasoning & source trace ("show your work")** | "I can see which sources and which experts shaped the answer, so I can trust and verify it." | Observability (user-facing + dev tracing) | 2 / 3 | S |
| 9 | **Eval harness / quality scoring** | *(indirect)* "Answers stay reliably good and don't silently regress as the app grows — quality is measured, not vibed." | Eval-driven development | scores 2/3/5 | M |

## Existing scaffolding (affects sequencing)

- **#6** — `digest.ts` already generates a `questions[]` array per article (produced, not yet used in a learning loop). Low-hanging.
- **#7** — a `spec/kb-postgres-store/` spec already exists (unimplemented). Persistence is partly designed.

## Build sequence

_TBD — next step. Natural spine forming: 1 → 2 → 3 → 5, with 9 wrapping around it._
