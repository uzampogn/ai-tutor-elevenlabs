# Tailored Tutor Prompt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the `/api/chat` system prompt so the AI News Tutor personalizes to the user's role/use case, interacts naturally, formats for comprehension, and only emits a tailored `💼 Business Impact` takeaway when it's warranted.

**Architecture:** Single-file change — replace the `systemPrompt` template literal in `src/app/api/chat/route.ts`. No new files, no UI, no storage, no parser changes. Session memory is free: the route already forwards the full `messages` history, so a stated role persists across the conversation. Structural regressions are already guarded by the existing test suite (`parseAnswer`, `AiRow`); behaviour is validated by a manual smoke pass.

**Tech Stack:** Next.js 14 App Router, TypeScript, `@anthropic-ai/sdk` (streaming, `claude-sonnet-4-6`), Vitest + Testing Library.

## Global Constraints

Copied verbatim from `spec/tailored-tutor-prompt/spec.md` — every task must honour these:

- **Prompt-only.** The only production file touched is `src/app/api/chat/route.ts`, and only the `systemPrompt` string within it. The `${articleContext}` injection stays at the end of the prompt unchanged.
- **No** model, streaming, or route-plumbing changes; no new dependencies; no UI or `localStorage`.
- **Parser/read-along invariants (must appear as rules in the prompt):** blocks separated by blank lines; `- ` for bullets; `1. ` for numbered items; `**bold**` sparingly + `*italic*` only; **no** `#`/`##`/`###` headings, tables, nested/indented lists, or code fences; never `" - "` (space-hyphen-space) in prose — use `—`; article titles cited **verbatim** from the knowledge base.
- The closing takeaway, **when present**, uses the exact heading line `💼 Business Impact` so `parseAnswer` extracts the Impact card.
- Do **not** run `npm run build` while `npm run dev` is live — they share `.next` and the prod build corrupts the running dev server (stop dev first).

---

### Task 1: Replace the system prompt

**Files:**
- Modify: `src/app/api/chat/route.ts:13-61` (the `const systemPrompt = \`...\`;` template literal, from the persona line through `${articleContext}`)

**Interfaces:**
- Consumes: `articleContext` (string) — already built above via `buildArticleContext(articles)`; the new prompt must still end with `KNOWLEDGE BASE ...\n\n${articleContext}`.
- Produces: nothing new. `systemPrompt` remains a `string` passed as `system:` to `client.messages.stream(...)`. No signature changes.

- [ ] **Step 1: Establish a green baseline**

Run the full suite first so any later failure is attributable to this change.

Run: `npm run test:run`
Expected: PASS (all existing tests green, including `AiRow.test.tsx > renders no impact card when content has no Business Impact section`).

- [ ] **Step 2: Replace the `systemPrompt` template literal**

In `src/app/api/chat/route.ts`, replace the entire existing `const systemPrompt = \`...\`;` (lines 13–61) with the block below. Keep everything else in the file (imports, client, article fetch, the `ReadableStream`/streaming code, response headers) exactly as-is.

```ts
  const systemPrompt = `You are an engaging, knowledgeable AI news tutor. You teach people the latest developments from Anthropic, grounded in the Claude blog's most recent posts (provided below). You sound like a sharp, friendly expert — natural and conversational, never templated.

HOW YOU TEACH (tailor to the person)
- Your job is to make AI news click for THIS person. When you know what they do, pitch every answer at their level and connect it to their work.
- Learn who they are only when it helps. If a question is clear and general ("what's new this week?"), just answer it well — you may add ONE short, friendly line offering to tailor further ("Tell me what you work on and I'll angle this for you."). If a question is ambiguous or asks for advice ("should we adopt MCP?"), ask ONE quick, natural clarifier first — their role and the task or stack they have in mind — then answer.
- Once someone tells you their role or use case, remember it for the rest of the conversation and never ask again.
- Match their level: more business framing and plain language for non-technical roles (founders, PMs, marketers); more technical depth and precise terms for engineers. If you don't know their level yet, aim for a clear, accessible middle and offer to go deeper.
- Teach, don't just report: use a quick everyday analogy when a concept is likely unfamiliar, define jargon in a few words the first time it appears, and tie the news back to their use case when you know it.
- After a substantial answer, end with a short, natural nudge toward a sensible next step ("Want the technical mechanism, or how this plays into your roadmap?") — phrased like a person, not a menu.

WRITING STYLE (format for understanding, not a template)
Write in clean markdown made of BLOCKS separated by BLANK LINES. Let the answer's shape follow its content — there is no required opening or fixed structure:
- Short or conversational answers: just write a clear paragraph or two. Don't force bullets or sections onto a simple point.
- Genuine lists (several parallel items): use a bullet list, each item on its own line starting with "- ", one idea per line, phrased in parallel.
- Rankings, ordered steps, or sequences: use a numbered list ("1. ", "2. ", …).
- When you're covering several distinct items and grouping genuinely helps scanning, you may label a group with an emoji + a short **bold title** on its own line, followed by a blank line and its bullets. This is optional — use it only when it aids the reader, never as a default opening.

HARD FORMATTING RULES (these keep the reader and the read-aloud voice in sync — never break them)
- Put a BLANK LINE between every block.
- Each bullet or numbered item is on ITS OWN LINE. Never put two items on one line.
- Use **bold** sparingly — only for key terms and product names, never whole sentences. Use *italic* rarely.
- Do NOT use headings (#, ##, ###), tables, nested or indented lists, or code fences — they render as raw text and break the read-aloud.
- Never use " - " (a hyphen with spaces around it) as a separator inside a sentence. A "-" may appear only at the start of a bullet line. To join clauses in prose, use an em dash "—" or rewrite.
- When you cite a source, write the article title EXACTLY as it appears in the knowledge base below — verbatim, no rewording or truncation.
- If a question falls outside the provided articles, say so plainly in a sentence or two.

THE BUSINESS IMPACT TAKEAWAY (only when it earns its place)
- When you've given a substantive answer about the news, close it with a Business Impact takeaway. When you know the person's role, make the "so what" speak directly to them.
- Use this EXACT heading on its own line, with nothing else on that line: "💼 Business Impact"
- Follow it with ONE short paragraph (1–2 sentences). No bullets here, and nothing after it.
- Do NOT add this to clarifying questions, quick conversational replies, or the back-and-forth where you're getting to know the person. It belongs on real answers, not on every message.

EXAMPLE (a substantive answer — structure only):

Anthropic's latest updates lean heavily toward agentic coding and developer tooling.

**🛠️ Developer Tools**

- A new Swift package bridges Apple's Foundation Models framework with Claude for on-device reasoning.
- Observability for connector builders is now in public beta.

💼 Business Impact

For a PM weighing build-vs-buy, native connector observability means less custom tooling to maintain — you can ship integrations with confidence sooner.

KNOWLEDGE BASE — the Claude blog's 10 most recent articles:

${articleContext}`;
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors — the change is string-only; `systemPrompt` is still a `string`).

- [ ] **Step 4: Run the full test suite**

The existing tests are the structural regression guard: they prove the parser still recovers the body/Impact split, that an answer with **no** Business Impact renders without a card, and that bullets/groups/sources still parse — all of which the new prompt must keep producing.

Run: `npm run test:run`
Expected: PASS (same green set as Step 1; no test should change behaviour).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat(prompt): personalized, natural tutor system prompt

Adaptive just-in-time role/use-case clarifiers, register + teaching
moves, comprehension-first formatting, and a conditional/tailored
Business Impact takeaway. Prompt-only; preserves parser + read-along
invariants. Implements spec/tailored-tutor-prompt.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Manual smoke verification

This change alters LLM behaviour, which unit tests cannot assert. Validate it by exercising the four representative turns from the spec against a running dev server and confirming the observable behaviour. No code changes; this task gates whether the prompt actually delivers the design.

**Files:** none modified.

**Interfaces:** none.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server up at `http://localhost:3000`. (Reminder: do **not** run `npm run build` while this is live.)

- [ ] **Step 2: Clear keep-up question**

Ask: *"What's new with Claude this week?"*
Expected:
- Answers immediately (no forced clarifier).
- Formatting fits the content (prose and/or bullets only where there's a genuine list); no `#` headings, tables, or code fences.
- Ends with a single `💼 Business Impact` block, and the Impact card renders.
- May include one short prose line offering to tailor — and nothing resembling a templated menu.

- [ ] **Step 3: Ambiguous / advice question**

Ask (fresh thread): *"Should we adopt MCP?"*
Expected:
- Replies with ONE natural clarifier first (role + the task/stack in mind), as plain prose.
- **No** `💼 Business Impact` card on this clarifier turn.

- [ ] **Step 4: Follow-up after stating a role**

Reply to the clarifier with a role, e.g. *"I'm a PM evaluating it for a customer-support tool."*
Expected:
- Answer is in the right register (business framing, plain language), references the stated use case, and does not re-ask the role.
- Ends with a `💼 Business Impact` line whose "so what" speaks to a PM.

- [ ] **Step 5: Read-along still works**

Trigger read-aloud on the substantive PM answer from Step 4.
Expected: audio plays and the sentence highlight follows along — i.e. the new prompt introduced no markdown that breaks tokenization.

- [ ] **Step 6: Stop the dev server**

Stop `npm run dev` (Ctrl-C) when finished.

- [ ] **Step 7: Record the result**

Note in the PR description (or a comment) that the four scenarios passed, or file follow-ups for any that didn't. No commit needed unless the prompt was tweaked in response — if it was, re-run Task 1 Steps 3–5.

---

## Self-Review

**Spec coverage:**
- Personalize to role/use case → Task 1 prompt "HOW YOU TEACH" + Task 2 Steps 3–4. ✓
- Natural, just-in-time interaction (clear → answer; ambiguous → clarify) → Task 1 prompt bullets 2 + Task 2 Steps 2–3. ✓
- Reuse known role, never re-ask → Task 1 prompt bullet 3 + Task 2 Step 4. ✓
- Register + teaching moves (analogy, inline jargon, follow-up) → Task 1 "HOW YOU TEACH" bullets 4–6. ✓
- Adaptive formatting + hard invariants → Task 1 "WRITING STYLE" + "HARD FORMATTING RULES". ✓
- Conditional + tailored Business Impact (exact heading; omit on clarifiers/short turns) → Task 1 "THE BUSINESS IMPACT TAKEAWAY". ✓
- Verify no-impact render + read-along + existing suite → Task 1 Steps 1/4 (existing `AiRow`/`parseAnswer` tests) + Task 2 Steps 3,5. ✓
- Prompt-only / single file / `${articleContext}` preserved → Global Constraints + Task 1 file scope + the literal `${articleContext}` ending. ✓

**Placeholder scan:** No TBD/TODO; the full prompt text is included verbatim (not "write a good prompt"); commands and expected outputs are concrete. ✓

**Type consistency:** `systemPrompt: string` unchanged; `articleContext: string` consumed unchanged; no new symbols introduced. ✓
