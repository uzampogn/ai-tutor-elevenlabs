# Tailored Tutor — personalized, natural system prompt

**Status:** Approved design (2026-06-17)
**Scope:** Rewrite the `systemPrompt` string in `src/app/api/chat/route.ts`. **Prompt-only** — no UI, no storage, no parser changes.
**Backlog item:** #1 in `spec/feature-backlog.md` — *"Improve Anthropic system prompt. Fine tune it for a learning experience tailored to the user — What is your job? Do you have a use case / task in mind? Make it more natural."*

---

## Problem

The current system prompt makes the AI News Tutor read like a rigid template:

- It dictates a fixed block shape (lede → themed emoji groups → list) for **every** answer.
- It forces a `💼 Business Impact` section onto **every** answer — even a one-line clarifier or a quick conversational turn gets one.
- It never adapts to *who is asking*. A founder, a PM, and an engineer all get the same register and the same framing.
- The tone is mechanical; it does not behave like a tutor who teaches at your level.

We want it to feel like a knowledgeable, natural tutor: it learns who you are when that helps, teaches at your level, and formats for comprehension — **without** breaking the UI parser or the read-along feature.

## Goals

1. **Personalize** answers to the user's role and use case, captured conversationally.
2. **Natural interaction** — ask about the user only when it sharpens the answer, never interrogate.
3. **Adaptive formatting** — structure that fits the content, not a forced template.
4. **Conditional, tailored takeaway** — the `💼 Business Impact` section appears only when it earns its place, and speaks to the user's role.
5. Preserve all parser / read-along invariants and keep the change to a single file.

## Non-goals (YAGNI)

- No onboarding screen or Welcome-screen profile capture.
- No `localStorage` profile or cross-session memory.
- No renamed or role-specific Impact card (that heading is parser-keyed; renaming is UI work).
- No model, streaming, or route-plumbing changes.

---

## Hard constraints (must not break)

The UI parser (`src/lib/parseAnswer.ts`) and read-along only understand a small markdown surface. The rewritten prompt **must** keep these invariants:

- Blocks separated by **blank lines**.
- Unordered list items start with `- ` (one idea per line).
- Ordered list items start with `1. `, `2. `, …
- Inline emphasis only: `**bold**` (used sparingly) and `*italic*`.
- **No** `#`/`##`/`###` headings, tables, nested/indented lists, or code fences — they render as literal text and break read-along.
- In prose, never use `" - "` (space-hyphen-space) as a separator; use an em dash `—` or rewrite.
- When citing a source, write the article title **verbatim** as it appears in the knowledge base (this is how `matchSources` produces source chips).
- The closing takeaway, when present, uses the exact heading line `💼 Business Impact` so `parseAnswer` extracts it into the Impact card.

## Session memory

No persistence is needed. The `/api/chat` route already forwards the full `messages` history on every call, so once the user states their role/use case in a turn, the model retains it for the rest of the session for free. The prompt instructs the model to **reuse a known role and never re-ask**.

---

## Design

### 1. Interaction model (adaptive, just-in-time)

- **Clear / "keep me up to date" questions** → answer immediately. Optionally close with **one** light, prose offer to tailor (e.g. "Want this angled for your work? Just tell me what you do.").
- **Ambiguous / advice / "should we…" questions** → ask **one** natural clarifier first (role + the task or stack in mind), then answer.
- Once the user states their role/use case, **reuse it for the rest of the session; never re-ask.**
- **Clarifiers and tailoring offers are always plain prose** — no bullets, no `💼 Business Impact` card — so they read naturally and speak cleanly in voice-first mode.

### 2. Learning experience (register + teaching moves)

- **Register:** match business-vs-technical depth and vocabulary to the stated role. When the role is unknown, default to a clear, accessible middle and offer to go deeper.
- **Teaching moves:** use a quick analogy for genuinely unfamiliar concepts; define jargon inline in a few words; connect the news to the user's use case when it is known.
- **Natural follow-up:** end substantive answers with a short, prose next-step offer ("want the technical mechanism, or how this maps to your roadmap?") — phrased naturally, not as a templated menu.

### 3. Formatting (adaptive structure)

- Keep every **hard constraint** above verbatim.
- **Relax the mandate:** *format for comprehension.* Short answers stay clean prose. Bullets only for genuine multi-item lists. Emoji + `**bold**` group labels become an **optional** tool, used only when grouping several items genuinely helps — not a required opening shape. Scale length to the question.

### 4. Closing takeaway (conditional + tailored)

- Use the exact `💼 Business Impact` heading on its own line (card depends on it).
- Include it **only on substantive answers** — omit on clarifiers, short conversational turns, and the personalization exchange.
- Tailor the 1–2 sentence "so what" to the user's role / use case when known; otherwise keep it general.

---

## Validation

- **Existing tests:** `parseAnswer` / `parseBlocks` / `matchSources` tests must still pass (invariants preserved). Run the suite: `npm run test:run`.
- **Verify during implementation:** `AiRow` renders cleanly when an answer has **no** Business Impact (`parseAnswer` → `impact: null`). This is expected to already work (it is the same state as "heading not streamed yet"), but confirm explicitly.
- **Manual smoke (representative turns):**
  1. A clear keep-up question ("what's new with Claude this week?") → answers immediately, adaptive formatting, tailored-offer optional, Impact card present.
  2. An advice question ("should we adopt MCP?") → one natural clarifier first, no Impact card on the clarifier turn.
  3. A follow-up after the user states a role → answer is in the right register, references the use case, Impact line speaks to that role.
  4. Read-along still plays for a substantive answer (no broken markdown).

## Files touched

- `src/app/api/chat/route.ts` — the `systemPrompt` template literal (only). The `KNOWLEDGE BASE` injection of `${articleContext}` stays unchanged at the end.

## Out-of-scope follow-ups (noted, not built here)

- A future UI pass could let the Impact card adopt role-specific labels (e.g. "What to try" for engineers), but that requires generalizing the parser's heading match and the card component.
