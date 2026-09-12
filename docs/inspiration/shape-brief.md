# Shape brief — the conversation surface, redesigned

> Output of `/impeccable shape`, 2026-09-12, on `redesign/impeccable`. Reference dossier: [`brief.md`](brief.md). Product truth: `PRODUCT.md`. This is a **design brief for confirmation** — no code, no direction contract, no DESIGN.md. The direction contract and the build belong to the next step (new-work), after the human confirms this brief.

**Decision trail.** Seed key `1030dbaf`, Operate mode, code-led (no image generation in this harness). Round 1 assigned "One Light"; the human re-rolled **bolder** (Patchbay led; Cyclorama and Construction Grid competitive), then **safer** (Lyric Sheet, Rundown, Highlighter Desk, canon), then steered: *keep the current layout, shrink and re-place the orb, move Voice / Text / New chat to a Gemini-like rail, organize the article better in the drawer.* Round 3 assigned **Score Follower** with **Show Notes** as the pick; the human kept both and steered: *agent-first — the orb is the main input, text is the fallback; it starts in a fixed position, moves once the conversation starts, and the user can drag it.* Round 4 fused the two worlds and varied only the orb's motion; the human locked **Follow the Voice — Companion**.

**Assumptions made in place of the discovery interview** (no structured question tool in this session — correct any that are wrong):

- Scene: a founder / PM / engineer with 10 minutes, at a desk or commuting, daylight, half-attending — listening while glancing at a phone or laptop.
- Success: they hear what changed in AI this week, see exactly where the voice is, and can open the source in 1 tap.
- Fidelity: production-ready replacement of the whole app at `/`, desktop and mobile, shipped through the normal quality gate (D4, D9).

---

## 1. Job and audience

- **Mode: Operate.** The visitor completes a task (ask, listen, follow, open the source); design serves the product; brand lives in precise details. The answer body has Read-mode obligations (measure, comprehension).
- **Who:** people keeping up with AI through AI-assisted learning (PRODUCT.md). Portfolio reviewers are served by the README, not by the surface.
- **Job:** converse with the tutor about the knowledge base or one post, at the depth they choose, hands-free when they want it.

## 2. Outcome and proof

- **Primary action:** speak to the orb. Secondary: type (fallback), tap a quick question, open a post.
- **Proof the surface must carry, per answer:** streamed body under the spec-11 markdown contract · sentence-level read-along with follow-scroll · the `💼 Business Impact` card when warranted · numbered inline citations + source chips that open the article drawer · Copy / Read aloud / Like.
- **Product-specific truths to make visible:** the voice and the text are one document (the playhead is the proof); freshness (the KB is dated and ordered by time, "Live · N sources"); grounding (every claim traces to a post).
- **Absent, never fabricated:** testimonials, usage numbers, a logo or wordmark.

## 3. Selected direction — Follow the Voice, Companion

- **Visual authority:** replacement world (D8). The incumbent Aurora Mist look is anti-reference; the new world is recorded in `DESIGN.md` at the end of the build, not before.
- **World:** Score Follower × Show Notes. The answer is ruled into sentences by hairline bar lines; a chapter tick per sentence sits in the margin; a peach playhead tick sweeps the margin as sentences are spoken and read measures settle to sage. The ground is the light anchor of the pinned palette; ink is deep teal; the only object carrying the full teal → lime → peach gradient is the orb, with the single sparkle at its core.
- **Structural thesis:** agent-first on the layout the human keeps. A narrow icon rail on the left (New chat · Text fallback · the collapse mark) replaces the floating Voice / Text / New chat pill. The KB sidebar opens beside the rail and collapses to nothing. The thread is the centre column. The article drawer slides in from the right with the article organized as stacked blocks.
- **The orb is the agent and a free body.** It starts centre stage on the welcome — at most a fifth of the viewport tall, far smaller than today's 191px — with the greeting above and quick questions beneath. When the conversation starts it drifts to a home at the foot of the thread, out of the reading column. The user can drag it anywhere; it snaps to edges, never covers text, and that position is its home for the session. While speaking it pulses and leans toward the reading column; the playhead tick in the margin does the following. Text fallback: the composer line appears at the orb's home with the orb as its mic.
- **Sequence:** welcome (orb centre, greeting, quick questions) → first utterance (orb swells, listening) → answer streams (orb drifts home; bar lines and chapter ticks appear as sentences land) → read-along (playhead tick sweeps; sentence lights) → source tap (drawer opens without stopping playback) → next turn.
- **Focal moment:** the orb leaving centre stage as the first answer begins — the surface turning from "an agent waiting" into "an agent reading to you".
- **Implementation consequence:** the orb becomes a positioned, draggable element outside the thread's DOM, with a motion grammar (start → home → drag → lean) authored once; the dock components (`VoiceDock`, `InputDock`, the mode pill) are replaced, not restyled; the read-along engine (`useReadAlong`, `DocBlocks` spans) is untouched and gains a margin track to render ticks against stable `[data-s]` spans.

## 4. Scope and boundaries

- **Target:** the single-page app at `/` — `src/app/layout.tsx`, `src/app/globals.css`, everything under `src/components/`. Both viewports (1440×900, 390×844) and the 880px desktop guard.
- **Fidelity:** production; merges on lint + typecheck + `test:run` plus Impeccable's finish review (D9).
- **Untouched:** API routes, scraping, retrieval, prompts, evals, `contracts/`, the spec-11 answer-markdown contract, `buildSpokenDoc` and the read-along invariants (stable spans, class toggles only, follow-scroll on sentence change, reduced motion), graceful degradation paths.
- **Anti-goals:** no landing page, no accounts, no settings surface; no logo, wordmark or favicon invented; no chat bubbles; no frosted glass, blur or blue-tinted shadows; no card stacks in the sidebar; no 4-hue category system; no floating chat-widget cliché — the orb earns its freedom only through one designed motion grammar; no dark theme by default (scene: daylight, half-attending — light ground).

## 5. States and ranges

- **Knowledge base:** 0 (loading / degraded) · 23 today · assume up to ~60 posts; titles 25–110 characters; 4 categories today, more sources later (YouTube named next). Liveness: "Live" + count + refresh spinner; stale state must be sayable.
- **Thread:** empty (welcome) · 1 turn · 10+ turns; answers from 2 sentences to ~25 with bullets and numbered lists; streaming with caret; error row ("Something went wrong").
- **Orb:** idle · listening · thinking · speaking; plus unsupported-browser (voice off, text only) — each distinct in a still frame; 4 discrete poses under reduced motion; positions: centre (welcome) · home (foot of thread) · user-placed · leaning (speaking).
- **Read-along:** with timings (highlight + playhead + follow-scroll) · audio without timings (play, no highlight, ghosted playhead) · paused · finished.
- **Drawer:** loading skeleton · full digest (tl;dr, takeaways, why it matters, tags, ask-the-tutor, original link) · no digest (description + link) · hero missing (drawn placeholder).
- **Mobile (≤880px):** sidebar as overlay with scrim; drawer full-width; orb home bottom-right above the safe area; drag constrained to edges.

## 6. Interaction and layout

- **Hierarchy:** the orb first, the tutor's words second (serif, reading measure ≤ 70ch), everything the user operates third (plain sans, one family in 2 weights), meta last (dates, counts, labels — same sans, smaller, never uppercase mono).
- **Topology:** rail (icons, names on hover/focus) · collapsible KB list (date · title, one ruled row per post, all visible without scrolling at desktop height where the count allows) · thread column · drawer as the top plane. Depth order fixed; the active plane takes the light, the others dim one step.
- **Composer (fallback):** a single ruled line with the orb as its mic and a plain send affordance; quick questions above it as text, not pills. Hidden until Text is chosen or the browser lacks voice.
- **Citations:** superscript numbers in the body; source chips as a numbered ruled list under the answer; tap opens the drawer at that post.
- **Impact card:** a ruled passage with the `💼 Business Impact` heading, set a step larger, never a tinted box.
- **Drawer organization:** date + close · title · hero · What it says (tl;dr + takeaways) · Why it matters · Ask the tutor (questions as ruled rows) · Read the original — stacked blocks with deep gaps, one job per block; opening it never stops playback.
- **Motion grammar (authored once):** orb drift 300–500 ms ease-out-quart; drag with edge snap; speaking pulse at the breath rate of the incumbent (kept, since it is state, not decoration); playhead step on sentence change 150–250 ms; drawer slide 250 ms; sidebar collapse 250 ms. `prefers-reduced-motion`: instant swaps, 4 static orb poses, no drift.
- **Feedback:** every rail control names itself; listening shows live interim text near the orb; thinking shows the dots row; degraded states are drawn as ghosts in place, never blank.

## 7. Constraints and open decisions

**Binding constraints**

- Stack: Next.js 14 · React 18 · TypeScript 5 · Tailwind 3 + custom CSS; Node 24; Vitest; the desktop-guard test.
- Read-along must not re-render; highlight by class toggle on `[data-s]`; one scroll container for the thread.
- Palette pinned: teal → lime → peach, luminous, one sparkle glyph (`brief.md` §4). Body text ≥ 4.5:1 — deep teal ink on the light anchor.
- Minimalist is binding; the human's steer pins the layout; PRODUCT.md terminology is the vocabulary.
- Fix, don't inherit: the incumbent's font variables are aliased at `:root` but defined on `body`, so no custom face ever renders live (`brief.md` §1). The new type must be verified in the browser.

**Open decisions a builder must not invent — for the human**

1. **Type.** Operate register favours one sans in 2 weights for UI; the tutor's voice wants a serif with presence. The incumbent's Newsreader and Plus Jakarta Sans are on Impeccable's default list; choose faces in new-work with a reason, or accept a system stack for UI and a single chosen serif for the tutor.
2. **Orb persistence.** Does a dragged position persist across sessions (localStorage) or reset each visit? Recommendation: session only; the downside is re-dragging on every visit.
3. **Orb on mobile.** Draggable, or fixed to one of 2 homes (bottom-right / bottom-centre)? Recommendation: 2 homes; the downside is less freedom than desktop.
4. **Voice trigger.** Tap-to-talk only, or also hold-to-talk and a keyboard shortcut? Recommendation: tap plus a shortcut; the downside is one more thing to teach.
5. **Categories.** Drop the 4 category colours for a text label, or keep a single-hue weight scale? Recommendation: text label only; the downside is slower scanning by type.
6. **Name.** Names may be proposed (PRODUCT.md). Candidates in the world's vocabulary, for the later naming session only: *Along* · *Cadence* · *Sotto*. Not a decision here.

**Next step, after confirmation:** new-work records the direction contract (THESIS · OWN-WORLD · STORY · FIRST VIEWPORT · FORM · FINISH, seed `1030dbaf`) in the surface brief, then builds code-led, then finish review and `DESIGN.md`.
