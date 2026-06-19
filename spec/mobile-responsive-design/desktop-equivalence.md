# Desktop Equivalence — capture & compare procedure

Run via the Playwright MCP. Compare BEFORE (on `main`) vs AFTER (feature branch).
Viewports: **1440×900** and **1024×768** (both > 880px). Theme/data must match
between runs (same seeded articles), so capture both runs back-to-back.

## Setup
1. `npm run dev` (note the port; default 3000).
2. Playwright MCP: `browser_resize` to the viewport, then `browser_navigate` to the app.

## The seven feature states (screenshot each, at each viewport)
1. **welcome** — fresh load, no messages. File: `welcome.png`.
2. **kb-expanded** — click "Expand knowledge base"; wait for KB cards. `kb-expanded.png`.
3. **kb-collapsed** — click "Collapse knowledge base"; toggle shows circle morph. `kb-collapsed.png`.
4. **answer** — type "What is Claude?" → send; wait for the streamed answer with Business
   Impact card + source chips + message actions. `answer.png`.
5. **voice-dock** — ensure Voice mode; capture the docked orb (idle). `voice-dock.png`.
6. **text-composer** — switch to Text mode; capture composer + quick-row. `text-composer.png`.
7. **article-drawer** — expand KB, click an article; wait for hero + score card. `article-drawer.png`.

Filenames: `desktop/<viewport>/<state>.(before|after).png`.

## Compare
For each file, view BEFORE and AFTER side-by-side via the MCP. PASS = no visible
difference. Any delta is a regression — stop and fix before closing the phase.
