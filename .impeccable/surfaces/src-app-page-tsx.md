---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/app/layout.tsx","src/app/globals.css","src/components/AppShell.tsx"]
---

# Surface brief — `/` (the conversation surface)

Scope: the single-page app at `/` — `src/app/layout.tsx`, `src/app/globals.css`, everything under `src/components/`. Both viewports (1440×900, 390×844) and the 880px desktop guard. Mode: **Operate** (the answer body carries Read-mode obligations: measure, comprehension).

Audience and job: one audience, the learner keeping up with AI through AI-assisted learning; they converse with the tutor about the knowledge base or one post, at the depth they choose, hands-free when they want it. Primary action: speak to the orb. Secondary: type (fallback), tap a quick question, open a post.

Proof the surface carries per answer: streamed body under the spec-11 markdown contract · sentence-level read-along with follow-scroll on stable `[data-s]` spans (class toggles only) · the `💼 Business Impact` passage on every answer (ghosted when the model omits it) · numbered inline citations and a numbered source list that opens the article drawer · Copy / Read aloud / Like. Product truths made visible: the voice and the text are one document (the playhead is the proof); freshness ("Live · N sources", dated rows); grounding.

Constraints: Next.js 14 / React 18 / Tailwind 3 + custom CSS; read-along engine and `src/lib/readAlong` untouched; one scroll container for the thread; `prefers-reduced-motion` → 4 static orb poses, no drift; Google Sans Flex is the only family (loaded via the Google Fonts CSS2 API because next/font/google 14.2 lacks it; declared directly on `html`, no `:root`/`body` variable split); the pinned palette (teal → lime → peach, `docs/inspiration/brief.md` §4) is the only colour, carried in full only by the orb; body ink ≥ 4.5:1; minimalist is binding; no chat bubbles, frosted glass, blur, blue-tinted shadows, card stacks, 4-hue categories, or floating chat-widget cliché. Decisions 1–5 in `docs/inspiration/shape-brief.md` §7 are settled.

Chosen direction: **Follow the Voice — Companion** (Score Follower × Show Notes). Memorable moment: the orb leaving centre stage as the first answer begins — the surface turning from "an agent waiting" into "an agent reading to you".

Unresolved, low-risk (builder takes the default, labelled `default — unratified`): voice trigger = tap-to-talk plus the `V` key outside editable fields; hold-to-talk left out. The mark is proposed, never presented as established; the wordmark waits for the naming session.

## Direction contract

THESIS: The tutor is a companion that reads to you, and the page is the score it follows. The one idea: the orb is a free body — the agent — that starts centre stage, moves out of the reading column when the first answer begins, and can be placed anywhere; the margin beside every answer is a ruled track where a peach playhead tick sweeps sentence by sentence while read measures settle to sage. Refused: the chat-app arrangement — bubbles, an avatar per turn, a composer bar owning the foot, a floating mic widget.

OWN-WORLD: Ground is the pinned light anchor (`#EEEFCF`), the reading plane one step lighter; ink is deep teal (`#194D49`) with every secondary tone mixed from ink and ground, never grey. Hairlines rule everything: rail, KB rows, source list, drawer blocks, the sentence track. Exactly one object carries the full teal → aqua → sage → lime → glow → peach gradient, soft-focus, with the single 4-point sparkle at its warm core: the orb. Google Sans Flex everywhere — 400 at reading size with optical sizing, 500 for controls, meta smaller in the same face, never uppercase, never mono. Radii small (6 / 10px); the orb is the only circle. No shadows except a faint teal-tinted lift under the drawer.

STORY: The visitor sees a small luminous orb waiting under a two-line greeting and four ruled questions, and understands "speak, and it answers from these posts". They tap; it swells and listens, their words appearing beside it. The answer streams into a ruled column, the orb drifts to its home at the foot, the voice starts and the peach tick walks the margin as sentences light — they believe the voice and the text are one document. A numbered source row opens the post in a drawer without stopping the voice; they trust where it came from. They drag the orb aside, ask again.

FIRST VIEWPORT (1440×900): a 56px icon rail at the far left (mark/collapse at top, then New chat, then Text) on the ground colour; the KB sidebar collapsed to nothing; the main plane fills the rest. Centred in the main plane, a 620px welcome column: the greeting at 32px/400 sitting at ~28% height, the orb (144px, under a fifth of the viewport) centred at ~50%, and beneath it the four quick questions as ruled text rows at 15px. Nothing else — no composer, no bar, no footer. On 390×844 the rail becomes a 48px top strip, the orb is 120px at ~46% height, and the questions fill the width.

FORM: Companion — the fused Score Follower × Show Notes world with the orb's motion grammar as the single authored moment (drift 400ms ease-out-quart, edge-snap drag, breath-rate pulse while speaking, playhead step 200ms). Position on the ordered list: round 4, locked pick after the human steered rounds 1–3. Seed key `1030dbaf`. Code-led: no comp exists and none is owed; the reviewer audits this block in behaviour.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
