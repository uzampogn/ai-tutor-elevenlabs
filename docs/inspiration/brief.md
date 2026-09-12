# Reference dossier — redesign of the conversation surface

> Captured 2026-09-12 on `redesign/impeccable`. Input to Impeccable `shape` under decision D8 (full redesign; the incumbent look is anti-reference). Nothing here is direction except the pinned palette. PRODUCT.md is the product truth; **minimalist is binding**; the name "AI News Tutor" is temporary and names may be proposed.

**Status key.** `PINNED` = the human chose it, it constrains the new world. `EVIDENCE` = informs, never dictates. `unverified` = stated but not checked in-session.

| # | Source | Role | Status | Assets in this folder |
|---|---|---|---|---|
| 1 | Incumbent — live app + `src/` | product truth (functions) · anti-reference (look) | evidence | `incumbent-*.png` (1440×900 and 390×844) |
| 2 | Gemini app | product reference — conversation surface topology | evidence | `gemini-app.png` |
| 3 | klarlabs.ai | category peer — AI-assisted learning framing | evidence | `klarlabs-*.png` |
| 4 | Colour scheme | palette | **pinned** | `colour-scheme.png` |
| 5 | Koi poster | mood | evidence (partial — see §5) | `koi.png` (converted from `.avif` with `sips`) |

---

## 1. Incumbent — live app and `src/`

**Role:** product truth + anti-reference (D8). Every *function* below survives; the *look* (Aurora Mist: frosted glass, sky-blue/lilac blooms) is retired.

**Captured:** welcome (voice orb, sidebar collapsed and expanded), text composer, streamed answer with Impact card and source chips, article drawer, orb in thread state. Both viewports. Read-along could **not** be captured live: the speak endpoint returned HTTP 500 twice during the session, so the read-along facts below come from `src/` only.

### Layout topology (observed, `src/app/globals.css`)

- 2-column CSS grid: sidebar 320px + main (`globals.css:100-103`). Collapsed sidebar = 0px track, animated grid-template-columns (`:107`). Sidebar starts **collapsed** on the live app; expanded is opt-in via a top-left brand-mark toggle.
- Main is a flex column: `.scroll` (the only scroll region) → session controls (Voice/Text pill + New chat) → input dock. The dock is **in-flow**, not fixed (`globals.css:245-269`; `AppShell.tsx:392-418`).
- Thread width `clamp(720px, 64vw, 920px)`; welcome column 620px (`:95`, `:99`). Measured at 1440: thread column 920px wide, answers indented 78px inside it under a small avatar.
- Article drawer: `position: fixed`, right, 400px desktop, 100% width ≤880px, own scroll (`:722-728`, `:998`).
- Breakpoint 880px: sidebar becomes a fixed overlay `min(86vw, 360px)` with scrim; the desktop-guard test (`globals.desktop-guard.test.ts`) protects layouts above 880px.
- z-scale: toggle 20 · drawer 40 · scrim 44 · mobile sidebar 45.

### Component inventory (`src/components/`)

| Component | Renders | Function to keep |
|---|---|---|
| `AppShell` | state + composition | all |
| `sidebar/Brand`, `KbHeader`, `KbList`, `KbCard`, `SidebarToggle` | product name, "Knowledge base · Live · 23 sources", refresh, category-dot cards (RESEARCH/PRODUCT/POLICY/SOCIETY + date + title), collapse to a mark | KB sidebar, liveness, collapse |
| `main/Welcome` | serif title, lede, 2×2 suggested questions | empty state |
| `main/Thread` | scroll container, rows, `useReadAlong` wiring | thread |
| `UserRow` | right-aligned dark bubble (14.5px) | user turn |
| `AiRow` | avatar · "Thinking" dots · `DocBlocks` body · `ImpactCard` · `SourceChips` · Copy / Read aloud / Like | answer |
| `DocBlocks` | every word `<span class="w" data-w>` inside sentence `<span class="s" data-s>`; citations as superscript `[n]`; streaming caret | read-along substrate |
| `ImpactCard` | "💼 BUSINESS IMPACT" label + body, left accent bar | Impact card |
| `SourceChips` | "SOURCES" label + numbered pill links | citations |
| `main/InputDock` → `VoiceDock` / `Composer` | orb + controls, or quick-chip row + mic + textarea + send + footnote | 2 input modes |
| `main/Orb` | 4 states `idle · listening · thinking · speaking` via `data-orb-state`; bloom + core + 2 rings | voice orb |
| `Waveform` | 16 bars, `is-active` | speaking/listening feedback |
| `ArticleDrawer`, `ArticleHero`, `ScoreCard` | date, title, hero (with placeholder fallback), digest paragraph, takeaways, "Why it matters" (reuses `.impact`), tags, "Ask the tutor" questions, original link, skeleton | article drawer + score card |

### Type (declared vs. rendered)

- **Declared** (`layout.tsx:5-22`, `globals.css:26-28`): Plus Jakarta Sans (400–700) for UI, Newsreader (400–600, italic) for the welcome title and answer body at 17px/1.62, JetBrains Mono for 10–11.5px meta labels.
- **Rendered on the live app:** everything computes to `ui-sans-serif, system-ui` — including the answer body and welcome title. Cause observed in-session: next/font sets `--font-sans/--font-serif` on `<body>` via variable classes, but `globals.css` aliases them at `:root`, where they are undefined, so the alias is empty and every rule falls back. The incumbent's serif/sans pairing therefore never shipped. Treat the *declared* pairing as intent, not evidence. (`unverified` whether local dev shows the same; the CSS mechanism says it must.)
- Scale in use: welcome title 38px/1.14; answer 17px/1.62; user 14.5px; drawer title 25px/500; KB card title 13px/500; chips 12–12.5px/500; meta 10–11.5px uppercase tracked.

### Spacing, shape, material

- Radii 8 / 12 / 16 / 22px + pills; row gap 24px, bubble pad 18px (`globals.css:34`, `:51-55`).
- Material: white at 75–85% + `backdrop-filter: blur(12–18px) saturate(1.2)` on sidebar, composer, cards, mode switch; blue-tinted shadows only (`:37-49`). Body is `#EDF1FB` with 3 radial blooms (sky blue top-left, lilac bottom-right), `background-attachment: fixed` (`:65-80`).
- Accent `#8AB4FF` / strong `#4F7BE8`, secondary lilac `#C9B8FF`; ink `#1B2236`; `color-scheme: light` hard-declared in CSS and the Next viewport.
- Category colours are hard-coded OKLCH (red / green / blue / amber dots) — a 4-hue system competing with the accent.

### Motion

- All keyframes gated behind `prefers-reduced-motion: no-preference` (`globals.css:868-932`).
- Orb: `orb-breathe` (scale 1→1.04; 6s idle / 2.4s listening / 4s thinking), `orb-bloom-breathe`, `orb-shimmer` (rotation 14s idle / 4.5s thinking / 8s speaking), `orb-ripple` (2 rings, 2.4s listening / 1.6s speaking).
- Sidebar collapse 0.28s ease; read-along highlight fade 0.18s; thinking-dots blink 1.2s; caret 1s step; waveform bars 0.7–0.9s; live-dot pulse 2s; skeleton shimmer 1.3s.

### What the orb and read-along need from a layout

- **Read-along** (`useReadAlong.ts`, `DocBlocks.tsx`): one identifiable scroll container (today `.scroll`); stable `[data-s]` sentence spans that never re-render during streaming (ids are append-only); a highlight that changes **only** background/colour (`.s-active` = 22% accent wash, 4px radius; `.s-read` = softer ink) so nothing reflows; follow-scroll that moves only on sentence change, keeping the active sentence in a 30–55% viewport band (`BAND_TOP 0.3`, `BAND_BOTTOM 0.55`); smooth scroll normally, instant under reduced motion. Anything that puts the answer inside a second scroller, a transformed parent, or a virtualised list breaks it.
- **Orb**: a fixed-size square button (`min(248px, 25vh) × 0.85` desktop → 191px measured; 200px cap ≤880px; 168px ≤480px) centred in its own dock **below** the scroll region, never overlapping content; 4 states must stay visibly distinct; the bloom/rings need ~40px of breathing room around the core; the dock also hosts the Voice/Text switch and New chat.
- **Degraded states** the layout must hold: no timings → audio plays, no highlight; no voice support → dock shows a one-line message and Text mode; no digest → drawer shows description + link; hero missing → tinted placeholder; stream error → literal "Something went wrong" row.

### Keep / reject

**Keep (functions):** 2 input modes with 1 flip · orb with 4 states · read-along on stable spans + follow-scroll · KB sidebar (title/date/category/excerpt, liveness, refresh, collapse to a mark) · article drawer (hero, digest, score card, ask-the-tutor questions, original link) · Impact card with exact "💼 Business Impact" heading · numbered inline citations + source chips · Copy / Read aloud / Like row · quick questions on welcome and above the composer · grounding footnote · answer-markdown contract (spec 11) · 880px desktop guard · reduced-motion gating.

**Reject (look):** frosted glass + saturated blur everywhere · Aurora Mist blue/lilac blooms · blue-tinted shadows · 4-hue category dots · the orb's white-blue-lilac sphere · the sidebar as a stack of cards · the split "Voice | Text | New chat" pill floating between thread and dock · uppercase mono meta labels · serif/sans pairing as declared (it never rendered anyway) · light-only lock-in (`color-scheme: light` is evidence, not a commitment — PRODUCT.md).

**Observed defects worth an observation, not a design decision:** custom fonts never apply on the live app (var scoping); `/api/speak` returned 500 during this session.

---

## 2. Gemini app — product reference

**Role:** how a conversation surface stays minimal at scale. **Status:** evidence. Asset: `gemini-app.png` (3000×1636, logged-in empty state; the URL needs a login).

**Extracted**

- **Topology:** a 1-column stage. A ~70px icon rail on the left (sparkle mark, new chat, search, notebook, apps; history + settings + avatar pinned to the bottom); no text labels, no list of chats visible until asked. Top-right: one primary pill ("Upgrade") and an edit glyph. Everything else is empty.
- **Empty state:** one line of greeting ("Hi, Zampogna. What's on your mind?"), light-weight display sans, centred at ~40% height. No suggestions, no lede, no explanation.
- **Composer:** a single 880px-wide pill, ~85px tall, sitting **directly under the greeting** (not at the bottom of the screen in the empty state). Inside: `+` attach · placeholder "Ask Gemini" · model picker "Flash ▾" · mic. 4 affordances total. Sampled: field `#1E1F20` on page `#0F0F0F`.
- **Palette:** near-black page (`#0F0F0F`), one soft radial navy glow behind the composer (`#12172E` at centre), a single blue pill for the paid CTA (`#407CA3`), green avatar. Colour = 1 glow + 1 CTA. Nothing else is coloured.
- **Density:** ~5 interactive elements on screen; type sizes 2 (display ~44px, UI ~16px); the whole visual weight is the glow, which is decoration for the input.
- **How it stays minimal at scale:** chrome is icons only; history is a drawer, not a column; the composer is the hero, so the surface reads the same empty or full; the model/mode choice lives *inside* the composer rather than as a separate control row.

**Keep as evidence:** composer-as-hero; mode choice inside the composer; icon rail instead of a card column; 1 glow as the only colour on an otherwise neutral field. **Reject:** dark theme as a default (PRODUCT.md leaves the scheme open; the pinned palette is luminous, not dark); the "Upgrade" CTA pattern (no plan tiers exist); the personal greeting (no accounts exist).

---

## 3. klarlabs.ai — category peer

**Role:** how a learning-agent product frames AI-assisted learning. **Status:** evidence. Assets: `klarlabs-1440.png`, `klarlabs-390.png`, `klarlabs-1440-section-{learning,sources,world}.png`. Full-page capture was not possible (inner scroller), so sections were captured by scrolling.

**Extracted**

- **Framing:** meta description "Klar is the learning agent. Frontier AI that turns any information into human capability." First screen is *the product itself*: a small grey cloud mark with 2 sparkle eyes, "Hello, I'm Klar" in a serif, one composer pill ("How can I help you today?" · `+` · waveform mic · dark "Choose course" button). Marketing copy is pushed below the fold; the hero *is* the empty state. Section language: "Meet the learning agent", "Every claim traced to its source", "Not a tool. A teacher.", "It teaches me. It doesn't just answer."
- **Type hierarchy:** Tiempos Text serif for display (48–60px, weight 400, tracking −1.2 to −1.5px, line-height 1.0) and for the greeting; Inter for everything else (h3 20px/500, body 14–16px/400). 2 families on a contrast axis, both quiet.
- **Palette:** white `#FFFFFF`; ink `#171717`; muted `#737373`; hairlines `#E3E3E3` (the most frequent colour in the DOM, 1020 hits); CTA is ink-black pill; 1 blue `#2563EB` for citation marks only. No brand colour on the page.
- **Materials:** flat white; cards are hairline-bordered rectangles with 10–26px radii; a "citation" pattern shows a `1` chip in the answer and the source document opened beneath with the quoted passage highlighted in pale blue; testimonials as a masonry wall fading to white at the edges; one dark photo card.
- **Mobile (390):** identical composition — mark, greeting, composer at ~45% height, nothing else. The composer shrinks its placeholder ("Ask Klar") and keeps the dark button.

**Keep as evidence:** empty state = the working surface, not a pitch; citation chip + source passage as the trust mechanism (maps directly to our numbered citations + drawer); serif greeting over sans UI; hairline material with near-zero colour. **Reject:** the ink-black CTA pill as the only accent (we have a pinned luminous palette); marketing sections (no landing page is in scope); the mascot mark (no logo asset exists — do not invent one).

---

## 4. Colour scheme — `colour-scheme.png` — **PINNED**

**Role:** the palette. **Status:** pinned by the human: *teal-green → lime → peach soft-focus gradient, luminous, a single sparkle glyph.* Asset 1024×1034.

**Sampled stops** (24px box averages via canvas; positions as fractions of width, height):

| Stop | Hex | Where | Reads as |
|---|---|---|---|
| **Dark anchor** | `#194D49` | top-left corner (darkest pixel scanned) | deep teal, the ink end |
| 1 | `#307B59` | left edge, 30% down | forest teal |
| 2 | `#2E8970` | top centre | teal |
| 3 | `#52A88D` | upper-mid | aqua |
| 4 | `#9AD1A9` | centre | sage haze (the "soft focus" body) |
| 5 | `#ABE4D0` | right, 28% down | pale cyan mist |
| 6 | `#C0E2B0` | centre-right | lime haze |
| 7 | `#A2BA6E` | bottom centre | lime-olive |
| **Light anchor** | `#EEEFCF` | right of centre, 60% down (lightest pixel) | luminous cream-lime |
| 8 | `#FBD8BB` / `#F1C9A7` | right edge, 72–82% down | peach |
| glyph | `#E3D9B9` on `#BEBB8A` | 88%, 88% | 4-point sparkle, near-white cream, ~40px, low contrast |

**Reading of the image:** a diagonal gradient from cool dark teal (top-left) through sage and lime (centre) to warm peach (bottom-right), with defocused lighter clouds inside it, so no stop is flat. The light end is *yellow-green* luminous, not white. The sparkle is the only hard edge on the canvas, and it sits at the warm end, 1 glyph, small.

**Constraints this pins:** the hue journey teal → lime → peach in that order; luminosity (mid-to-high L across the field, the dark anchor is a corner, not a base); soft focus (gradients bleed, no banding, no hard stops); exactly 1 sparkle glyph. Whether the gradient is a background, a material for 1 element (the orb is the obvious candidate), or a highlight ramp is **not** pinned. Note the light anchor sits in the warm-neutral band that Impeccable flags as the cream default — it's pinned here, so treat it as the *luminous* end of a green ramp, not as a paper body colour.

**Naming (proposed, not decided):** `teal-900 #194D49 · teal-600 #2E8970 · aqua-400 #52A88D · sage-200 #9AD1A9 · mist-100 #ABE4D0 · lime-200 #C0E2B0 · lime-500 #A2BA6E · glow-50 #EEEFCF · peach-200 #F1C9A7`.

---

## 5. Koi poster — `koi.png` — mood

**Role:** mood. **Status:** evidence, and only partially usable. Asset converted from `koi.avif` (1792×1008).

**What the image actually is:** a poster — "CREATE DAILY" in white, ~400px geometric grotesk, on a flat oxblood field (`#910802`), with a painted koi (orange `#ED3A0F`, deep teal-green scale patches, cream fins) gliding diagonally over the type, a soft drop shadow under it, and 2 small credits ("marina budarina", "interface design").

**Extracted**

- **Material:** matte, flat field; one rendered object with real texture (scales, fin translucency) and a real shadow. Not glass, not gradients, not glow. The contrast is *object vs field*, not layer vs layer.
- **Motion feel:** the koi is mid-glide — a single slow S-curve, tail up, fins trailing. Motion implied by pose, not by streaks or blur. If anything moves in the UI, it should move like this: 1 thing, slowly, along a curve, with the rest of the surface still.
- **Contrast:** extreme. White on oxblood, orange on oxblood, 1 hierarchy level (the word), 2 credits at ~1/30 the size, nothing in between.
- **What "calm" means here:** it is not low contrast, not soft, not pale. Calm = **one subject, one field, no competition.** The word is the only voice; the koi is the only movement. Generous emptiness around the composition does the calming. That is the transferable idea: quiet by *count*, not by *volume*.

**Keep as evidence:** single-subject composition; motion as one slow curve; a textured object allowed to sit on a flat field; the teal-green in the scales rhymes with the pinned palette. **Reject:** the oxblood red field (the pinned palette is teal/lime/peach; red is the direction O4 explicitly moved away from); poster-scale display type (a working surface, not a poster; Impeccable caps display at ~96px); the koi itself as a mascot (no logo asset exists).

---

## Synthesis — the world these point to

A luminous, near-empty surface where the only colour is the pinned gradient. The screen is mostly a quiet, high-lightness neutral drawn from the light anchor of the palette, with hairlines instead of cards and one contrast-axis type pairing (a serif with real presence for what the tutor *says* — welcome line and answer body — and a plain sans for everything the user *operates*). The orb is the one object on the field, the way the koi is the one object on the poster: it carries the teal → lime → peach gradient as a material and the single sparkle as its idle mark, it breathes slowly along one curve, and everything else on the surface stays still so the read-along highlight — a soft lime wash sliding through the serif — is the only other movement. The composer is the hero of the empty state, as in Gemini and Klar, with the voice/text flip inside it rather than floating as a separate pill; the knowledge base collapses to a rail of marks and opens as a plain list, not a stack of glass cards; the article drawer and the Impact card are the same hairline material as the page, differentiated by rhythm and one accent rule, not by tint. Calm is achieved by count, not by softness: one gradient, one glyph, one serif voice, one moving thing, and enough emptiness around each that the app reads as a place to listen.
