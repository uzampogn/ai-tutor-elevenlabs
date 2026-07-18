# CLAUDE.md — AI News Tutor (`ai-tutor-elevenlabs`)

Conversational agent that turns the latest [Claude blog](https://claude.com/blog) posts into clear, on-demand explanations. Voice or text in; answers stream back, are **read aloud with word-level highlighting** synced to ElevenLabs timestamps, and can be steered between business-level and technical depth. Live: https://ai-tutor-elevenlabs.vercel.app

## Stack

- **Next.js 14** + **React 18** + **TypeScript 5**, **Tailwind CSS 3**
- **@anthropic-ai/sdk** (explanations), **ElevenLabs** (TTS + timestamps), **Voyage AI** (embeddings for RAG retrieval → pgvector on Supabase; optional, off without `VOYAGE_API_KEY`)
- Tests: **Vitest** · Deployed on **Vercel**

## Layout

| Path | What's here |
|---|---|
| `src/` | App code |
| `spec/` | Feature specs / backlog |
| `ui-design-mockup/` | Design mockups (HTML) |
| `docs/` | Screenshots, docs |

## Quality gate

Run before pushing — all three must pass:

```bash
npm run lint        # next lint
npm run typecheck   # tsc --noEmit
npm run test:run    # vitest run
```

## Node

Requires **Node 24+** (impeccable's CLI requires `>=24`). Pinned via `.nvmrc` — run `nvm use` in this directory.

## Gotchas

- **Don't run `next build` while `next dev` is live** — they share `.next/`; the prod build corrupts the dev runtime (HTTP 500, `MODULE_NOT_FOUND`). Stop dev first.
- **Subagent dev → use a git worktree.** This repo shares one working tree across many active branches; isolate subagent work in a worktree with hard git rules.
- **All worktrees live under `/Users/vkau/Personal-space/Projects/` named `ai-tutor-wt-<feature>`** — create them there, nowhere else.

## Design — Impeccable

[Impeccable](https://github.com/pbakaus/impeccable) is installed **project-locally** (`.claude/skills/impeccable/`) as a design-guidance system: detector rules + iteration commands for frontend work. The skill dir is **gitignored** (treated as a local tool, not committed); the hook config lives in `.claude/settings.local.json` (also gitignored).

- A `PostToolUse` hook (`scripts/hook.mjs`) runs after `Edit`/`Write`/`MultiEdit`, self-filters to UI files, and surfaces design findings as system reminders. It's local-only (no network/API key), times out at 5s, and always exits 0 so it can't break a turn.
- **First-time setup:** run `/impeccable init` (writes `PRODUCT.md` + `DESIGN.md` design context).
- **Iterate:** `/impeccable audit | polish | critique | bolder | quieter` (23 commands total).
- **Overlap note:** the workspace also has the `frontend-design` plugin and a `ui-prompt` skill. Pick one design playbook per task so the agent isn't getting conflicting guidance — Impeccable is the heavier, detector-driven option.
