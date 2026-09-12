---
name: AI News Tutor (placeholder name)
description: A companion that reads to you; the page is the score it follows.
colors:
  ink: "#194D49"
  teal: "#2E8970"
  aqua: "#52A88D"
  sage: "#9AD1A9"
  mist: "#ABE4D0"
  lime: "#C0E2B0"
  lime-olive: "#A2BA6E"
  ground: "#EEEFCF"
  peach: "#F1C9A7"
  peach-light: "#FBD8BB"
  plane: "color-mix(in oklab, #EEEFCF 58%, white)"
  ink-2: "color-mix(in oklab, #194D49 76%, #EEEFCF)"
  ink-3: "color-mix(in oklab, #194D49 58%, #EEEFCF)"
  ink-4: "color-mix(in oklab, #194D49 36%, #EEEFCF)"
  hair: "color-mix(in oklab, #194D49 20%, #EEEFCF)"
  hair-2: "color-mix(in oklab, #194D49 11%, #EEEFCF)"
  wash: "color-mix(in oklab, #C0E2B0 48%, transparent)"
  accent-ink: "color-mix(in oklab, #2E8970 50%, #194D49)"
typography:
  display:
    fontFamily: "Google Sans Flex, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Google Sans Flex, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "-0.012em"
  title:
    fontFamily: "Google Sans Flex, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Google Sans Flex, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "-0.002em"
  body-sm:
    fontFamily: "Google Sans Flex, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Google Sans Flex, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.35
  meta:
    fontFamily: "Google Sans Flex, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "6px"
  md: "10px"
  full: "50%"
spacing:
  "1": "4px"
  "2": "6px"
  "3": "8px"
  "4": "10px"
  "5": "12px"
  "6": "14px"
  "7": "16px"
  "8": "20px"
  "9": "24px"
  "10": "26px"
  "11": "40px"
  "12": "44px"
components:
  rail-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    size: "40px"
  rail-button-hover:
    backgroundColor: "{colors.plane}"
    textColor: "{colors.ink}"
  rail-button-pressed:
    backgroundColor: "{colors.plane}"
    textColor: "{colors.ink}"
  action-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
  action-button-hover:
    backgroundColor: "{colors.plane}"
    textColor: "{colors.ink}"
  action-button-on:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.accent-ink}"
  send-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    size: "36px"
  ruled-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    padding: "12px 10px 13px"
  ruled-row-hover:
    backgroundColor: "{colors.plane}"
    textColor: "{colors.accent-ink}"
  kb-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "11px 20px 12px"
  kb-row-active:
    backgroundColor: "{colors.plane}"
    textColor: "{colors.accent-ink}"
  composer:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "2px 0"
  source-chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "9px 4px"
  source-chip-hover:
    textColor: "{colors.accent-ink}"
  drawer:
    backgroundColor: "{colors.plane}"
    textColor: "{colors.ink}"
    width: "400px"
    padding: "20px 28px 48px"
  drawer-hero:
    backgroundColor: "{colors.ground}"
    rounded: "{rounded.md}"
  orb:
    rounded: "{rounded.full}"
    size: "144px"
  orb-home:
    rounded: "{rounded.full}"
    size: "72px"
---

# Design System: AI News Tutor (placeholder name)

<!-- Recorded 2026-09-12 from the shipped build on branch redesign/impeccable (HEAD ca7c1eb) —
     Impeccable new-work "Follow the Voice — Companion", seed 1030dbaf, decision D8 (full replacement).
     Every value here is read from src/app/globals.css, src/app/layout.tsx and src/components/*.
     The name is a placeholder; the sparkle mark is proposed, not established; the wordmark waits
     for the naming session (PRODUCT.md → Brand Commitments). -->

## Overview

**Creative North Star: "The Score Follower"**

The tutor is a companion that reads to you, and the page is the score it follows. One luminous object, the orb, is the agent: it waits centre stage on the welcome, leaves the reading column when the first answer begins, drifts to its home at the foot, and can be dragged anywhere on the plane. Everything else is text set in one face on one light ground, ruled by hairlines. Beside every answer runs a sentence track in the margin: a hairline rule with a chapter tick per sentence, a peach playhead that walks it while the voice reads, and sage ticks where the read measures settle. That track is the proof that the voice and the text are one document.

The surface is quiet by count, not by volume. There are no bubbles, no avatars per turn, no composer bar owning the foot, no card stacks, no frosted glass, no blur on surfaces, no grey. The palette (teal → aqua → sage → lime → glow → peach) exists in full in exactly one place, soft-focus inside the orb; the rest of the page borrows single stops for meaning only: peach for the playhead, sage for what has been read, aqua for liveness and focus. Density is a reading column: 700px max, 17px/1.6 body, 44px between turns.

Confirmed rejections: the chat-app arrangement (bubbles, per-turn avatars, a foot-owning composer bar, a floating mic widget); frosted glass and backdrop blur; blue-tinted or hard shadows; card stacks; 4-hue category colours; uppercase labels and monospace.

**Key Characteristics:**
- One family (Google Sans Flex, optical sizing on), one ground, one ink; every secondary tone is mixed from ink and ground in OKLAB.
- Hairlines rule everything: rail, KB rows, quick questions, source list, drawer blocks, the composer, the sentence track.
- The orb is the only circle, the only object with the full gradient, the only object with the sparkle, and the only thing that moves on its own.
- Flat surfaces; the single shadow is the teal-tinted lift under the article drawer.
- Small radii (6px, 10px); the rest of the geometry is straight rules.
- Motion is one gated grammar: orb drift 400ms ease-out-quart on transform only, playhead step 200ms by colour, drawer and KB 250ms; reduced motion leaves 4 still orb poses.

## Colors

One light ground, one deep-teal ink, and a pinned green-to-peach ramp that lives whole only in the orb.

### Primary
- **Deep Teal Ink** (`{colors.ink}`, teal-900): every heading, body sentence, control glyph at rest, the composer text. Measured 8.13:1 on the ground.
- **Link Teal** (`{colors.accent-ink}`): teal-600 deepened halfway toward the ink so small text clears 4.5:1. The link/"on" tone: citations, the active KB row title, hovered quick questions and source rows, the expanded-KB mark, the "on" state of Copy / Read aloud / Like, the streaming caret.

### Secondary
- **Aqua Liveness** (`{colors.aqua}`, aqua-400): the 8×2px live dash beside "Live · N sources", the 3 thinking bars, the sound-wave bars, the focus-visible outline and the orb's focus ring. Liveness only.
- **Peach Playhead** (`{colors.peach}`, peach-200): the 16×3px tick that walks the sentence track while the voice reads; also a gradient stop and the bloom while the orb speaks.
- **Sage Settled** (`{colors.sage}`, sage-200): the tick colour of sentences already read; the orb's listening rings; a gradient stop.
- **Lime Wash** (`{colors.wash}`): the highlight behind the sentence being spoken (`.s-active`, 3px radius, decoration-break clone), the "on" background of an action button, and text selection (at 72%).

### Tertiary
- **Gradient-only stops** (`{colors.teal}`, `{colors.mist}`, `{colors.lime}`, `{colors.lime-olive}`, `{colors.peach-light}`): appear in the orb's core, shimmer, bloom and sparkle glow. `lime-olive` and `peach-light` are declared from the pinned sample and used by the orb material only; do not lift them for UI.

### Neutral
- **Luminous Ground** (`{colors.ground}`, glow-50): the page, the rail, the main plane, the drawer hero placeholder. `color-scheme: light` is declared on `:root` and via the viewport meta so no UA surface goes dark.
- **Reading Plane** (`{colors.plane}`): the ground mixed 58% toward white. The knowledge base, the article drawer, hover and pressed backgrounds, the rail name tag.
- **Ink 2** (`{colors.ink-2}`): secondary text — ledes, meta, KB titles, status lines, placeholders, read sentences, list markers, control glyphs at rest. 4.62:1 on ground, 4.95:1 on plane.
- **Ink 3 / Ink 4** (`{colors.ink-3}`, `{colors.ink-4}`): decoration and disabled only — ghost text, disabled glyphs, the hero placeholder mark, the ghosted Impact heading. Never running text.
- **Hair / Hair 2** (`{colors.hair}`, `{colors.hair-2}`): the rules. Hair-2 (11%) for structural dividers (rail edge, KB rows, source list, quick questions, drawer edge, the sentence rule); Hair (20%) for emphasis rules (under the question, over the Impact passage, the composer line, sentence ticks) and the scrollbar thumb.

### Named Rules
**The One Object Rule.** The full teal → aqua → sage → lime → glow → peach gradient appears on exactly one object: the orb. No background, button, border or text may carry it, in part or in whole.

**The Borrowed Stop Rule.** Outside the orb a palette stop is used only to mean something: peach = the playhead, sage = read, aqua = live/focus. A stop never decorates.

**The No-Grey Rule.** Every secondary tone is `color-mix(in oklab, ink, ground)`. There is no grey, no `#000`, and (except the orb's speaking sparkle) no pure white anywhere.

## Typography

**Display Font:** Google Sans Flex (with system-ui, -apple-system, Segoe UI, sans-serif)
**Body Font:** Google Sans Flex (same family; `font-optical-sizing: auto`, loaded with `opsz 6..144, wght 300..800` via the Google Fonts CSS2 API and declared directly on `html`, never through a `:root` → `body` variable hand-off)
**Label/Mono Font:** none. There is no second family and no monospace.

**Character:** one variable face doing every job. Reading text sits at 400 with optical sizing; controls, questions and block titles sit at 500; the only 600 is inline `strong` inside an answer. Tracking tightens slightly as size rises (-0.002em at body, -0.015em at display). Nothing is uppercase; meta is simply smaller in the same face and one ink step lighter.

### Hierarchy
- **Display** (400, 32px, 1.2, -0.015em; 26px ≤880px): the welcome greeting only, balanced wrap.
- **Headline** (500, 24px, 1.25, -0.012em): the article title at the top of the drawer, balanced wrap.
- **Title** (500, 20px, 1.3, -0.01em; 18px ≤880px): the user's question, set as a ruled heading of the passage that answers it. The Impact heading uses the same weight at 18px.
- **Body** (400, 17px, 1.6, -0.002em; 16px ≤880px): the answer, its lists and the Impact passage, max 66ch, pretty wrap. The drawer's tl;dr is 16px/1.55; the composer textarea is 16px/1.5.
- **Body small** (400, 15px, 1.4–1.55): the welcome lede, quick questions, the orb's caption, the drawer summary and "why it matters". Source rows, takeaways and drawer questions are 14.5px.
- **Label** (500, 13px): control text — action buttons, rail names, KB title, block titles in the drawer, source label (400). Never uppercase, no added tracking.
- **Meta** (400, 12–12.5px, ink-2): dates, counts, tags, the grounding note under the foot, source numbers (tabular figures).

### Named Rules
**The One Face Rule.** Google Sans Flex is the only family. No serif, no mono, no icon font; a second face is a defect.

**The Two Weights Rule.** 400 for reading, 500 for controls and headings. 600 exists only for inline `strong` inside an answer.

**The No Kicker Rule.** No uppercase, tracked or eyebrow labels anywhere. A smaller size in the same face and one ink step lighter is the whole meta grammar.

## Layout

The shell is a 3-column grid on the ground: a 56px icon rail, a 300px knowledge-base column, and the main plane taking the rest (`grid-template-columns: 56px 300px 1fr`; collapsed → `56px 0 1fr`, animated over 250ms). The KB keeps a fixed 300px inner column so rows clip rather than re-wrap while it collapses.

The main plane is a flex column with one scroll container for the thread (`scrollbar-gutter: stable both-edges`); read-along follow-scroll targets it. The thread is a centred reading column of 700px max, padded 44px top / 72px bottom / 24px right, with a 34px margin track on the left reserved for the sentence rule and ticks (24px ≤880px). On the welcome the block is vertically centred with auto margins and an 8vh top pad; the welcome column is 620px with the greeting above a 144px orb slot and four ruled quick questions beneath (40px gaps).

The foot is not a bar: a 700px-max row holding the orb's 72px home slot, the ruled composer when Text mode is on, and the 12px grounding note in flow on its own line. The orb itself is a free body on an absolute stage over the plane (`z-index: 30`), placed in plane coordinates; on desktop a drag snaps it to the nearer edge and keeps its height for the session; a new chat returns it to centre.

Spacing rhythm as used: 4 / 6 / 8 / 10 / 12 / 14 / 16 / 20 / 24 / 26 / 40 / 44px. Turns are 44px apart; drawer blocks 26px; list items 6px; control padding 6×10.

**Responsive (≤880px, the desktop-guard boundary):** one column, `100dvh`. The rail becomes a 48px top strip (plus safe-area) with names hidden; the KB is a fixed overlay `min(86vw, 360px)` sliding from the left behind a 34% teal scrim; the drawer is full width; the article drawer and KB add safe-area insets. The orb is 120px centre / 60px home with 2 homes (bottom-right, bottom-centre) and no free drag. Touch targets rise to 44px; the thread pads 28px top / 56px bottom; display 26px, question 18px, body 16px.

## Elevation & Depth

Flat. Depth is tonal and linear: the plane is one step lighter than the ground, and hairlines do the separating. Nothing lifts at rest or on hover; hover is a background swap to the plane. The single exception is the article drawer, which slides over the page with a faint teal-tinted lift so it reads as a sheet on top of the score rather than a panel beside it. Inside the orb, inset shading and a blurred bloom model the sphere; those are material, not elevation, and appear nowhere else.

### Shadow Vocabulary
- **Drawer lift** (`box-shadow: 0 18px 40px -18px color-mix(in oklab, #194D49 28%, transparent), 0 2px 10px -4px color-mix(in oklab, #194D49 14%, transparent)`): the article drawer only.
- **Inset hairline** (`box-shadow: inset 0 0 0 1px {colors.hair}`): the pressed rail button; a stroke drawn with box-shadow, not a lift.
- **Focus ring** (`box-shadow: 0 0 0 3px {colors.ground}, 0 0 0 5px {colors.aqua}`): the orb's focus-visible only; everything else uses `outline: 2px solid {colors.aqua}; outline-offset: 2px`.

### Named Rules
**The One Lift Rule.** The drawer is the only surface with a drop shadow. Any other box-shadow is either a 1px inset stroke or a focus ring; a new lift is a defect.

**The Teal-Tint Rule.** Where a shadow or scrim exists it is mixed from teal-900, never black, never blue.

## Shapes

Straight rules and two small radii. Controls and small tags round at 6px (`{rounded.sm}`: action buttons, send, KB refresh, drawer close, rail name tag); larger containers at 10px (`{rounded.md}`: rail buttons, the drawer hero). Rows, lists, the composer and the drawer itself have no radius at all; they are separated by 1px hairlines, top or bottom, never boxed. Highlights on text are 3px. The orb, its bloom, rings and core are the only circles (`border-radius: 50%`); the 2px liveness dash, ticks and bars are rectangles with ≤2px corners. The sparkle mark is a single 4-point star path, filled with currentColor, 18–22px in the UI, 20% of the orb inside it.

## Components

### Buttons
Buttons are text or glyph on nothing; the ground shows through until hover.
- **Shape:** softly squared (6px for text actions and send; 10px for the 40px rail buttons).
- **Rail button:** 40px square, transparent, ink-2 glyph at stroke 1.6; hover/focus → plane background, ink; `aria-pressed` → plane + inset hairline; disabled → ink-4. The name appears beside it on hover/focus as a 13px/500 tag on the plane with a hair-2 border (hidden ≤880px, where the button is 44px).
- **Action (Copy / Read aloud / Like):** 13px/500 ink-2, padding 6×10, 6px radius; hover → plane + ink; `is-on` → lime wash + link teal; disabled → ink-4. Read-aloud "on" shows 3 aqua sound-wave bars.
- **Send:** 36px square, transparent, ink glyph; hover → plane; disabled → ink-4. No filled primary button exists.
- **Ruled row (quick question / drawer question):** full-width left-aligned 15px (14.5px in the drawer) text with a hair-2 rule beneath, padding 12×10; hover → link teal on the plane (drawer: on the ground).

### Chips
- **Source chip:** not a pill. A ruled list row (14.5px, padding 9×4, hair-2 rule) with a 12.5px tabular number in ink-2 at 1.4em min-width and the post title in ink; hover → link teal. Inline citations are 0.68em superscripts in link teal.
- **Tag:** bare 13px ink-2 text joined by " · ". Category colours were dropped (decision 4).
- **Live dash:** an 8×2px aqua rectangle before "Live" in the KB meta.

### Cards / Containers
There are no cards. The knowledge base and the drawer are planes; blocks inside the drawer (`What it says`, `Why it matters`, `Ask the tutor`, `Read the original`) are separated by a hair top rule with 14px padding and a 13px/500 ink-2 block title, stacked at 26px.
- **Drawer:** fixed right, 400px, plane background, hair-2 left edge, the drawer lift; slides in 250ms ease-out-quart; padding 20/28/48; full width ≤880px. Title 24px/500; date 13px ink-2; close 32px (44px mobile).
- **Drawer hero:** 16:9, 10px radius, hair-2 border, ground background, image `object-fit: cover`; when missing, the mark in ink-4 over a 12px ink-2 label, drawn in place.
- **Score card skeleton:** hair-2 blocks at 4px radius, shimmering 1.4s (gated) — drawn in place, never blank.

### Inputs / Fields
- **Composer:** the text fallback is a single ruled line, not a box: transparent textarea (16px/1.5, auto-grow to 160px, no border, no outline) over a 1px hair rule that darkens to ink on `focus-within`; the orb sits at its left as the mic and a plain send at its right. Placeholder ink-2; disabled ink-3. 15px ≤880px.
- **Focus (global):** `outline: 2px solid aqua, offset 2px`.

### Navigation
- **Rail:** a 56px vertical strip on the ground with a hair-2 right edge; the mark (also the KB collapse control, rotating 45° and turning link teal when the KB is open), New chat, Text mode. ≤880px it is a 48px top strip with a hair-2 bottom edge.
- **Knowledge base:** 300px plane column; brand line 15px/500; head with 13px/500 title, a 28px refresh button, and 12.5px meta ("Live · N sources"); rows of 12px meta over a 13.5px/1.35 title, hair-2 ruled, 11/20/12 padding; active → link teal title at 500; ghost rows are 9px hair-2 lines. ≤880px it is a left overlay behind a teal scrim.

### The Orb (signature)
A free body, not a widget: a 144px circle at centre stage (120px mobile), 72px at its foot home (60px mobile), placed on an absolute stage in plane coordinates and moved with `translate3d` + `scale` only. The core carries the full 135° gradient with 3 soft radial clouds (mist, peach, lime), inset shading, a slow conic shimmer (16s, soft-light) and the sparkle at 60%/60% in glow-50 with a peach drop glow; a blurred sage/lime bloom sits behind at -26% inset. Four poses, each distinct in a still frame: **idle** (breathing 3.5% over 6s), **listening** (core 1.1×, bloom full, 2 sage rings rippling 2.4s), **thinking** (core desaturated 0.72, sparkle turned 45° / turning 0–90°, shimmer 4s), **speaking** (peach bloom 1.12× breathing 4s, sparkle white, rings 4s, an 8px lean toward the reading column). Voice-off dims it (saturate .35, opacity .6, no sparkle glow, no animation). Its caption (15px, max 34ch; 13px ink-2 when unsupported) is a sibling placed beside it, never a child, so scale never touches the words. Tap or the `V` key starts listening.

### The Sentence Track (signature)
Beside every answer, in the 34px margin track: a 1px hair-2 rule from 0.2em to the bottom of the body and a 9×1px hair tick at the first line of each `[data-s]` sentence span, drawn as `::before` pseudo-elements so highlighting never re-renders. While the voice reads, the rule darkens to hair, the active sentence takes the lime wash, its tick becomes the 16×3px peach playhead, and read sentences drop to ink-2 with sage ticks. Transitions are colour only, 200ms.

### The Impact Passage
The `💼 Business Impact` heading (18px/500, contract-bound text) over a hair top rule, 26px above; when the model omits it the rule goes dashed, the heading ink-4, and a 14px ink-3 "Not given for this answer." is drawn in place.

## Do's and Don'ts

### Do:
- **Do** set every surface on the ground (`#EEEFCF`) or the plane (ground 58% → white) and separate with 1px hairlines mixed from ink; hair-2 (11%) structural, hair (20%) emphatic.
- **Do** keep the full gradient, the sparkle at its warm core, and every circle inside the orb; borrow single stops elsewhere only for meaning (peach playhead, sage read, aqua live/focus).
- **Do** use Google Sans Flex at 400 for reading and 500 for controls, with negative tracking that grows with size (-0.002em → -0.015em), and keep meta in the same face at 12–13px in ink-2.
- **Do** keep body ink at ≥4.5:1: ink for text, ink-2 for secondary text, accent-ink for small links and "on" states; ink-3 and ink-4 only for ghosts, disabled and decoration.
- **Do** gate every transition and animation behind `prefers-reduced-motion: no-preference`, move the orb on transform only (400ms `cubic-bezier(0.25, 1, 0.5, 1)`), step the playhead by colour in 200ms, and slide the drawer and KB in 250ms.
- **Do** draw a missing state in place (ghost rows, skeleton blocks, the dashed Impact passage, the hero placeholder mark) rather than leaving a blank.
- **Do** round controls at 6px and containers at 10px; leave rows, lists, the composer and the drawer square.

### Don't:
- **Don't** add a chat-app arrangement: no bubbles, no per-turn avatar, no composer bar owning the foot, no floating mic widget — the user's question is a ruled heading and the composer is one ruled line.
- **Don't** use grey, black, blue-tinted shadows, frosted glass or backdrop blur anywhere; the scrim and the drawer lift are teal-900 at low alpha.
- **Don't** add a second shadow, a card, a filled primary button, a pill or a bordered box; the drawer lift is the only lift.
- **Don't** put the gradient on backgrounds, text, borders or buttons, and don't draw another circle: the orb is the only object with either.
- **Don't** set anything uppercase, tracked-out, in a second family or in monospace; don't add kickers or eyebrow labels.
- **Don't** re-render the answer to highlight it; toggle classes on the stable `[data-s]` spans and move follow-scroll only on sentence change.
- **Don't** reintroduce category colours or a 4-hue tag system; tags are bare text joined by " · ".
