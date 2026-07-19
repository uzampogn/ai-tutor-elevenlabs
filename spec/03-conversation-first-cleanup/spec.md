# Spec — Conversation-First Cleanup (Aurora Mist, pass 2)

**Project:** AI News Tutor (`Projects/ai-tutor`, Next.js 14 + TS + Tailwind)
**Branch:** `aurora-mist-redesign`
**Status:** Approved direction, pending implementation
**Date:** 2026-06-13
**Builds on:** [`conversation-first-redesign.md`](./conversation-first-redesign.md) (Aurora Mist)

---

## Context

The Aurora Mist conversation-first redesign is in place (voice-only default, animated orb,
frosted-glass pastel palette). This pass is a **structural cleanup** — no palette or
typography change. The intent: remove top chrome, free vertical space for the conversation,
and shrink the voice orb so the user can **read the streaming answer while listening**.

**Visual system is locked.** Inherit every color, font, radius, shadow, and `@keyframes`
already in `src/app/globals.css`. No accent colors outside the Aurora Mist palette.

### Locked decisions (from design review)
- **"New chat" → near the input dock**, beside the Voice/Text mode switch (not in sidebar,
  not floating top-right). Groups all session controls at the bottom.
- **Orb → bottom-docked**, capped at ≤25% viewport height, conversation reads above it
  (not a top-of-conversation presence indicator).
- **Voice is always on** — the on/off control is removed entirely.

---

## Changes

### 1. Remove the entire top bar / header
- Delete the `<Topbar>` render in `src/components/AppShell.tsx`.
- Remove `.topbar`, `.topbar-l`, `.topbar-r`, `.topbar-title`, `.topbar-sub` from
  `globals.css`. This removes the "AI News Tutor" title + "Grounded in Claude's latest
  articles" subtitle in one move.
- Reclaimed vertical space flows to the conversation/welcome area.
- `Topbar.tsx` can be deleted once nothing references it.

### 2. Voice always on — remove the on/off toggle
- Remove the `VoiceToggle` component + render + the "Voice off/on" pill.
- In `AppShell.tsx`, voice is permanently enabled: drop `voiceEnabled` toggle state and
  `onToggleVoice`; hardcode `voiceEnabled = true` so `playVoice` always runs.
- **Not** the bottom "Voice / Text" input-mode switch — that segmented pill stays (it
  selects orb vs. composer, not audio on/off).

### 3. Relocate "New chat" to the input dock
- Remove `NewChat` from the deleted topbar. Render it in `InputDock.tsx` adjacent to the
  "Voice / Text" mode switch, reachable in **both** Voice and Text modes.
- Same frosted-glass pill styling; wire to the existing `handleNewChat`
  (clears messages, stops audio).

### 4. Remove "Live knowledge base" badge from the welcome state
- Delete `.welcome-badge` + `.live-dot` from `Welcome.tsx` and the now-unused CSS.
- Keep the serif title, lede, and 2×2 suggested-question grid.

### 5. Shrink + dock the voice orb (≤25% vertical)
- Orb stays in its current bottom position (`VoiceDock`, in the input-dock region, above the
  "Voice / Text" switch). Conversation/welcome content fills the space above.
- Cap orb height: `--orb-size: min(248px, 25vh)`; keep responsive `200px` / `168px` floors
  as additional caps (`globals.css:779, 782`).
- The orb occupies its own row in the flex column — **no absolute centering, never overlaps
  or hides the content above it** (fixes Image #7 where the large orb covered the welcome).
- Preserve all state-reactive behavior (idle/listening/thinking/speaking) and the
  prefers-reduced-motion static fallback.

### 6. Remove the readout section below the orb
- Delete the `.voice-dock-readout` block in `VoiceDock.tsx` — the `Waveform` + the
  "Tap to speak / Listening… / Thinking… / Speaking…" status text.
- The orb + its animation states are the only voice affordance.
- Keep the orb button `aria-label` for accessibility, and keep the
  `.voice-dock-unsupported` fallback for browsers without SpeechRecognition.

---

## Files touched
- **Modify:** `src/components/AppShell.tsx` (drop Topbar + voice toggle state),
  `src/components/main/InputDock.tsx` (add New chat by the mode switch),
  `src/components/main/VoiceDock.tsx` (remove readout block),
  `src/components/main/Welcome.tsx` (remove badge),
  `src/app/globals.css` (remove topbar/badge CSS, cap `--orb-size`).
- **Delete (once unreferenced):** `src/components/main/Topbar.tsx`,
  `src/components/main/VoiceToggle.tsx` (+ its test).
- **Unchanged behavior:** `/api/chat`, `/api/speak`, `Thread`, `Sidebar`, `ArticleDrawer`,
  `Composer`, `Orb` (visual treatment intact, only smaller).

---

## Bottom-dock order (Voice mode)
```
[conversation / welcome]   ← freed header space, fully readable
        │
[compact orb  ≤25vh]       ← own flex row, never overlaps content above
        │
[Voice | Text  +  New chat] ← session controls grouped
        │
[grounding disclaimer]      ← "Answers are grounded in the Claude blog…"
```

---

## Verification
1. App opens in Voice mode: no top bar, no "AI News Tutor" title, no "Live knowledge base"
   badge, no on/off voice toggle. Welcome hero (title + lede + 2×2 chips) fully visible.
2. Orb is compact (≤25vh), bottom-docked, never covering content above; no "Tap to speak"
   readout beneath it.
3. Tapping the orb still listens → auto-sends → answer streams above while TTS plays
   (voice always on).
4. "New chat" sits beside the Voice/Text switch and clears the session in both modes.
5. Reduced-motion gives a static orb; `npm run build` / `npx tsc --noEmit` passes.

---

## Known trade-off
Removing the readout drops the visible listening/thinking/speaking status text — the orb's
animation states become the **only** cue that voice is active. Confirm the idle→listening
animation is distinct enough on its own (the `aria-label` covers screen readers).
