# AI News Tutor

A voice-enabled chatbot that scrapes the latest [Claude blog](https://claude.com/blog) articles and teaches you the key concepts and business impact — powered by Claude and ElevenLabs.

## Features

- **Live knowledge base** — scrapes the Claude blog's 10 most recent posts (sorted newest-first by publish date), refreshed every hour
- **Streaming chat** — Claude answers questions about AI developments with article context injected automatically
- **Voice responses** — ElevenLabs TTS reads every answer aloud (toggle on/off)
- **Business-focused framing** — every response includes a Business Impact section
- **Suggested questions** — one-click prompts to get started

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| AI | Anthropic Claude (`claude-sonnet-4-6`) |
| Voice | ElevenLabs TTS (`eleven_turbo_v2`) |
| Styling | Tailwind CSS |
| Deployment | Vercel |
| CI/CD | GitHub Actions |

## Project structure

```
src/
├── app/
│   ├── page.tsx                 # Root page
│   ├── layout.tsx
│   └── api/
│       ├── chat/route.ts        # Streams Claude responses
│       ├── scrape/route.ts      # Returns cached Claude blog articles
│       └── speak/route.ts       # Proxies ElevenLabs TTS
├── components/
│   ├── ChatInterface.tsx        # Full chat UI
│   └── MessageBubble.tsx        # Single message with typing indicator
└── lib/
    └── scraper.ts               # Claude blog HTML scrape (index + bodies) + 1h in-memory cache
```

## Local development

**1. Clone and install**

```bash
git clone https://github.com/uzampogn/ai-tutor-elevenlabs.git
cd ai-tutor-elevenlabs
npm install
```

**2. Set up environment variables**

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```env
ANTHROPIC_API_KEY=sk-ant-...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
```

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| `ELEVENLABS_API_KEY` | [elevenlabs.io/app/settings/api-keys](https://elevenlabs.io/app/settings/api-keys) |
| `ELEVENLABS_VOICE_ID` | Default is Rachel. Browse voices at [elevenlabs.io/voice-library](https://elevenlabs.io/voice-library) |

**3. Run**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy to Vercel

**1. Link the project**

```bash
npm i -g vercel
vercel link
```

This creates `.vercel/project.json` with your `orgId` and `projectId`.

**2. Add GitHub secrets**

Go to your repo → **Settings → Secrets and variables → Actions** and add:

| Secret | Source |
|---|---|
| `VERCEL_TOKEN` | [vercel.com/account/tokens](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | `.vercel/project.json` → `orgId` |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` → `projectId` |
| `ANTHROPIC_API_KEY` | Anthropic console |
| `ELEVENLABS_API_KEY` | ElevenLabs settings |

**3. Add environment variables to Vercel**

In the Vercel dashboard → Project → **Settings → Environment Variables**, add `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, and `ELEVENLABS_VOICE_ID`.

From here, every push to `main` deploys to production and every PR gets a preview URL commented automatically.
