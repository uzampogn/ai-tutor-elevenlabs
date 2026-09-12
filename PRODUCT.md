# Product

<!-- impeccable:product-schema 1 -->

> Captured 2026-09-12 by `/impeccable init`: repository evidence confirmed and corrected by
> the human over 2 rounds. Lines marked **`inferred — confirm`** remain hypotheses.

## Platform

web

## Users

- **Primary (confirmed 2026-09-12):** people who want to keep up with AI developments and use AI-assisted learning to do it. The README names founders, product managers, engineers, and "anyone curious about AI". Their job: acquire knowledge fast enough to keep pace with the rate of innovation, without reading every primary source themselves.
- **How they use it:** they converse with the AI agent about the knowledge base as a whole or about one specific piece of content, at the depth they choose. Voice-first and read-aloud so learning can be hands-free. `inferred — confirm`: listening contexts (commute, desk, second screen) have not been named.
- **One audience (confirmed 2026-09-12):** the learner. `spec/FEATURE-BACKLOG.md` states the objective as a production-grade agentic app delivering a premium user experience and a polished interface, with engineering sophistication as the means; there is no secondary "reviewer" audience to design for.

## Product Purpose

AI News Tutor is a personalised learning experience for keeping up with AI (confirmed 2026-09-12). It fetches content from a **dedicated source** (today the Claude blog; a specific YouTube channel is the named next kind of source), builds a **knowledge base** from it (summaries, pre-defined questions, digests, score cards), and lets the user learn by **conversing with an AI agent** about the whole knowledge base or one specific piece of content.

Today's surface: ask by voice or text; the answer streams in, is read aloud by ElevenLabs, and the spoken sentence highlights while the page follows along. Any answer can be steered between business-level and technical depth, closes with a **💼 Business Impact** takeaway on every answer (confirmed 2026-09-12; the prompt in `src/lib/answerPipeline.ts` still says "only when it earns its place" — aligning it is a prompt change gated by the eval harness, D4), and cites the exact posts it drew from.

Why it exists (README): "AI moves faster than most people can keep up with, and the primary sources are written for builders." Success means the user acquires the knowledge fast, at the depth they need, and can trust where it came from.

## Positioning

The claims a neighbouring "chat with the docs" app could not truthfully copy:

1. **The voice and the text are one document.** One canonical tokenization (`buildSpokenDoc`) is the single source of truth for both what ElevenLabs speaks and which spans highlight, so word-level read-along stays in sync even though the screen renders full markdown and the voice times a plain string (`src/lib/readAlong/`, spec 18).
2. **Grounded in posts refreshed daily, not a training cutoff.** A Vercel Cron re-scrapes and re-summarizes changed posts into Postgres; reads are DB-first and report staleness.
3. **Answer quality is measured, not vibed.** A replayable eval harness with a committed baseline gates prompt, retrieval, and citation changes (spec 20, decision D4).
4. **Depth follows the listener.** The tutor prompt learns the user's role once per conversation and pitches every answer to it (spec 11).

The umbrella claim (confirmed 2026-09-12) is **personalised AI-assisted learning from a curated source**: the 4 mechanisms above serve it.

**Non-negotiable (confirmed 2026-09-12):** read-along voice sync (1), daily freshness (2), and eval-gated quality (3) survive any trade-off. Per-user depth (4) is the one mechanism that may be traded if a future decision forces a choice.

## Operating Context

- **Two input modes.** Voice mode: a state-reactive orb — tap, speak, the question sends on silence. Text mode: a frosted-glass composer with a quick-question row. One flip between them.
- **Knowledge-base sidebar** lists every recent post (title, date, excerpt); it collapses to a mark. Clicking a post opens a slide-in **article drawer** with hero image, digest, and a **score card**.
- **The thread** holds the conversation; each AI answer renders body, Impact card, and source chips, with per-sentence spans for read-along and follow-scroll.
- **Surfaces in scope today:** the single-page app at `/`. No landing page, docs site, settings, or account surface exists.
- **Operational rituals:** daily cron refresh (`/api/scrape/refresh`); Langfuse tracing and evals when keys are present; `npm run eval` before merging anything touching retrieval, prompts, or citations; PR previews on Vercel, `main` promotes to production.
- **Development harness:** the dual-loop harness in `brain/` (observations → backlog → build reports → handoffs) with the decision log as settled memory. Decisions D8 (full redesign, old direction retired) and D9 (no human review gate on UI PRs) govern UI work.

## Capabilities and Constraints

**Confirmed functionality (README, specs):** live knowledge base · grounded streamed answers · Business Impact takeaway · source citations · read aloud with waveform · read-along highlight + follow-scroll · voice input (ElevenLabs Scribe v2 Realtime with Web Speech fallback) · article reader with digest and score card · optional RAG retrieval (Voyage → pgvector) · optional Langfuse tracing · eval harness (91 cases in `eval/dataset.json`, baseline in `eval/baseline.json`).

**Technical constraints future work must preserve:**

- **Answer markdown is contract-bound.** The parser and read-along require: blocks separated by blank lines, `- ` bullets, `1. ` numbered items, `**bold**` and `*italic*` only; **no** headings, tables, nested lists, or code fences; never `" - "` in prose; article titles cited verbatim; the takeaway heading is exactly `💼 Business Impact` (spec 11).
- **Graceful degradation is a feature, not a fallback.** Without a database the app live-scrapes; without `VOYAGE_API_KEY` retrieval is off; without timing data audio still plays and text stays readable. Every surface must remain usable in the degraded state.
- **Read-along must not re-render.** Highlighting toggles CSS classes on stable `[data-s]` spans; follow-scroll moves only on sentence change; `prefers-reduced-motion` is honoured.
- **Colour scheme is slated for replacement (confirmed 2026-09-12).** The incumbent light-only declaration (`colorScheme: 'light'` in `src/app/layout.tsx`) is evidence of the current implementation, not a binding commitment. The replacement is decided in new-work, not here.
- **Mobile web is in scope** (spec 14) with a desktop-equivalence guard (`globals.desktop-guard.test.ts`) — desktop layouts above 880px must not regress.
- **Serverless limits** on Vercel bound audio job length (D2); all keys stay server-side.
- **Full redesign in progress (decision D8, 2026-09-12).** The incumbent "Aurora Mist" system (frosted glass, custom CSS + Tailwind) and specs 00–06 are **evidence and anti-reference only**, not direction; the old `ui-design-mockup/` folder was deleted on 2026-09-12, and the incumbent is captured in `docs/inspiration/brief.md` §1 instead. The new visual world is chosen in Impeccable new-work and recorded in `DESIGN.md`. There is no human screenshot gate on UI PRs (decision D9); they merge on the quality gate plus Impeccable's finish review.

**Terminology (use these words):** knowledge base (KB) · article drawer · orb · Voice mode / Text mode · composer · thread · read-along · Impact card · source chips · score card · digest · welcome (empty state).

**Explicitly undecided product facts:**

- Colour scheme: the human wants to change it (2026-09-12); observation O4 ("red should move toward green, like a sunshine") is the earlier note on the same topic. The new scheme is undecided and belongs to new-work.
- Build sequence for the feature backlog (multi-source ingestion, debate, critique, plans, recall, memory, source trace) is marked TBD in `spec/FEATURE-BACKLOG.md`.
- **Source model (confirmed 2026-09-12):** the product is not Claude-blog-only by design. It ingests a *dedicated source* into a knowledge base; the Claude blog is the first source and a specific YouTube channel is the named next kind. Which sources ship, and whether a user picks the source or the product does, is undecided.
- Pre-defined questions per article exist in the digest (`questions[]`) but are not yet surfaced in a learning loop (backlog #6).
- No post-session artefact (email transcript, summary) exists yet (O6).

## Brand Commitments

- **Name is temporary (confirmed 2026-09-12).** "AI News Tutor" (repo `ai-tutor-elevenlabs`) is a placeholder. Do not treat the name, the "News" framing, or the README tagline ("Understand the latest in AI — explained clearly, and read aloud.") as durable brand. Design work **may propose names** as the new visual direction is explored; the final choice is made in a dedicated naming session after the rebuild.
- **Binding visual constraint, volunteered by the human (2026-09-12):** the design stays **minimalist**. Recorded as stated, not expanded here; new-work interprets it.
- **Tutor voice** (spec 11 system prompt, binding for copy): "a sharp, friendly expert — natural and conversational, never templated." Business framing and plain language for non-technical roles; precise terms for engineers; asks at most one clarifier.
- **No logo, wordmark, or favicon asset exists yet**, and the human wants one (confirmed 2026-09-12). A mark may be designed during the redesign and **proposed**, never presented as established; the wordmark waits for the naming session because the name is temporary.
- **Typeface (confirmed 2026-09-12):** the Gemini app's family. Gemini's own face, Google Sans, is proprietary; the licensed equivalent is **Google Sans Flex** (SIL Open Font License, on Google Fonts, variable: wght · wdth · opsz · slnt · GRAD · ROND). One family for UI and for the tutor's words.
- Depends on and names third parties: Claude blog (source), Anthropic Claude (answers), ElevenLabs (voice). These are factual attributions, not co-branding.

## Evidence on Hand

- Live deployment: https://ai-tutor-elevenlabs.vercel.app
- Screenshot of the home surface: `docs/home.png` (README notes a read-along GIF is still TODO).
- Redesign references: `docs/inspiration/brief.md` (dossier with incumbent screenshots, pinned palette, mood) and `docs/inspiration/shape-brief.md` (the confirmed design brief).
- Eval dataset and baseline: `eval/dataset.json` (91 cases), `eval/baseline.json`; harness spec in `spec/eval-harness/`.
- Engineering narrative for reviewers: README "Read-along" and "How it works" sections; 21 historical specs in `spec/`.
- **Absent — do not fabricate:** testimonials, named users or customers, usage numbers, press, pricing, benchmarks against other products.

## Product Principles

1. **Grounded before fluent.** Every answer traces to a current post; a citation the user can check outranks a smoother sentence.
2. **The voice and the text are one document.** Anything that breaks sentence-level sync between what is spoken and what is highlighted is a regression, not a style choice.
3. **Depth follows the listener.** The user sets the level; the product adapts rather than picking one audience.
4. **Degrade gracefully, never silently.** Missing keys, missing data, or missing timings reduce features and say so; they never break the surface.
5. **Quality is measured.** Changes to prompts, retrieval, or citations earn their merge through the eval harness.

## Accessibility & Inclusion

- Read-along is built to be screen-reader safe: class toggles on stable spans, no re-rendering, follow-scroll only on sentence change, `prefers-reduced-motion` honoured (README, `useReadAlong`).
- Voice input has a browser Web Speech fallback; text mode is always available.
- Document language is `en`; the tutor answers in English.
- No formal accessibility standard is required (confirmed 2026-09-12). The read-along and voice-fallback behaviours above remain product commitments regardless.

