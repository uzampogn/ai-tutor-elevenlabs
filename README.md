# AI News Tutor

A voice-enabled AI tutor grounded in the [Claude blog](https://claude.com/blog)'s latest articles — **conversation-first** design in the soft, frosted-glass **Aurora Mist** palette, streaming answers, Business Impact cards, source chips, and both text-to-speech and speech-to-text input.

## Features

| Feature | Status |
|---|---|
| Live knowledge base — 10 most recent Claude blog posts, refreshed on demand | ✅ |
| Streaming chat — Claude answers with article context injected automatically | ✅ |
| Business Impact card — extracted from every answer via client-side parsing | ✅ |
| Source chips — articles referenced in the answer, linked to real URLs | ✅ |
| Voice output (TTS) — ElevenLabs reads every answer aloud (toggle on/off) | ✅ |
| Voice input (STT) — Web Speech API; auto-sends final transcript | ✅ |
| Voice-first mode (default) — large animated, state-reactive **orb**; tap to speak | ✅ |
| Input-mode switch — segmented **Voice / Text** pill swaps the orb ↔ text composer | ✅ |
| Knowledge-base sidebar — article list with category, date, and active state | ✅ |
| Article drawer — slide-in reader with summary and tags, Esc to close | ✅ |
| Welcome empty state — suggested questions as 2×2 card grid | ✅ |
| Message actions — Copy / Read aloud / Like per AI response | ✅ |
| Responsive layout — sidebar hidden on ≤880 px, drawer goes full-width | ✅ |
| Reduced-motion — all animations gated behind `prefers-reduced-motion` | ✅ |

## How it works

1. **Build the knowledge base.** On load, the app calls `/api/scrape`, which scrapes the 10 most recent posts from the Claude blog — title, URL, publish date, and an excerpt pulled from each article's page. Results are sorted newest-first and cached in memory for an hour. They populate the knowledge-base sidebar.
2. **Ask a question.** Your message plus the 10 articles (injected as context) go to `/api/chat`. Claude streams back an answer grounded in those articles, written for a non-technical reader and ending with a **Business Impact** section.
3. **Render the answer.** As the response streams in, the client splits it into the main body and the Business Impact card, and matches any article titles Claude cited to render **source chips** that link to the real post URLs.
4. **Listen and speak.** The app opens in **voice-first** mode: a large animated orb sits where the composer would be — tap it to dictate your question and the final transcript auto-sends. The orb is state-reactive (idle → listening → thinking → speaking). Switch to **Text** mode for the frosted-glass composer. Toggle voice output to have ElevenLabs read each answer aloud; a waveform animates while speaking or listening.

Clicking an article in the sidebar opens a slide-in **reader drawer** with its summary; the same articles are what ground the chat, so answers and sources stay in sync.

## What's missing vs. the design mockup

The following items are in [`ui-design-mockup/SPEC.md`](./ui-design-mockup/SPEC.md) but not yet built:

| Gap | Notes |
|---|---|
| **Density toggle UI** | CSS classes (`density-compact` / `density-comfy`) exist; the `AppShell` state is wired; no button to change it yet. Default is normal. |
| **"Open article" link in drawer** | The drawer shows a summary but the dashed note at the bottom is plain text — it doesn't link to `article.url`. |
| **Mobile KB affordance** | On ≤880 px the sidebar is hidden with no way to reach the knowledge base. Noted in spec §7 as a follow-up (e.g. topbar button). |
| Conversation persistence | Intentionally out of scope (spec §9). |
| Real article hero images | Hatch placeholder used; intentionally out of scope (spec §9). |
| Structured-JSON `/api/chat` | Client-side markdown parsing used instead; intentionally out of scope (spec §9). |

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| AI | Anthropic Claude (`claude-sonnet-4-6`) |
| Voice output | ElevenLabs TTS (`eleven_turbo_v2`) |
| Voice input | Web Speech API (browser-native, Chrome/Edge) |
| Styling | Custom CSS — "Aurora Mist" frosted-glass design tokens + Tailwind utilities |
| Fonts | Newsreader (serif answers), Plus Jakarta Sans (UI), JetBrains Mono (labels) |
| Deployment | Vercel |

## Project structure

```
src/
├── app/
│   ├── page.tsx                   # Renders <AppShell />
│   ├── layout.tsx                 # Fonts + metadata
│   ├── globals.css                # Design tokens, all component CSS
│   └── api/
│       ├── chat/route.ts          # Streams Claude responses
│       ├── scrape/route.ts        # Returns cached Claude blog articles (1h TTL)
│       └── speak/route.ts         # Proxies ElevenLabs TTS
├── components/
│   ├── AppShell.tsx               # Root client component; owns all state
│   ├── ArticleDrawer.tsx          # Slide-in article reader
│   ├── AiRow.tsx                  # AI message: avatar, body, Impact card, source chips, actions
│   ├── ImpactCard.tsx             # "Business Impact" callout card
│   ├── InlineMarkdown.tsx         # Bold/italic/paragraph renderer (no heavy library)
│   ├── SourceChips.tsx            # Matched source links
│   ├── UserRow.tsx                # User message bubble
│   ├── Waveform.tsx               # Animated bars (TTS speaking + STT listening)
│   ├── icons.tsx                  # Inline SVG icons
│   ├── main/
│   │   ├── InputDock.tsx          # Voice/Text mode switch; renders VoiceDock or Composer
│   │   ├── VoiceDock.tsx          # Voice-first layout: Orb + transcript readout
│   │   ├── Orb.tsx                # Animated state-reactive voice orb (CSS-driven)
│   │   ├── Composer.tsx           # Quick chips + textarea + MicBtn + SendBtn (text mode)
│   │   ├── useSpeechRecognition.ts # Shared Web Speech API STT hook (MicBtn + Orb)
│   │   ├── MicBtn.tsx             # STT toggle button (consumes useSpeechRecognition)
│   │   ├── NewChat.tsx            # Reset conversation
│   │   ├── SendBtn.tsx            # Submit
│   │   ├── Thread.tsx             # Scroll container; renders Welcome or message list
│   │   ├── Topbar.tsx             # Title, VoiceToggle, NewChat
│   │   ├── VoiceToggle.tsx        # TTS on/off pill
│   │   └── Welcome.tsx            # Empty-state hero + suggested questions
│   └── sidebar/
│       ├── Brand.tsx              # Logo mark + pulsing dot
│       ├── KbCard.tsx             # One article card
│       ├── KbHeader.tsx           # "Knowledge base" header with refresh
│       ├── KbList.tsx             # Scrollable article list
│       ├── Sidebar.tsx            # Left column wrapper
│       └── kb.ts                  # Category mapping + date formatter
├── lib/
│   ├── parseAnswer.ts             # parseAnswer (body/impact split) + matchSources
│   ├── scraper.ts                 # Claude blog HTML scrape + 1h in-memory cache
│   └── types.ts                   # Message, Article, SUGGESTED questions
└── types/
    └── speech.d.ts                # Ambient Web Speech API types
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

## Deployment

Runs on Vercel with no extra config. Set the same three environment variables (`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`) in the project settings and connect the repo — pushes to `main` go to production, PRs get preview URLs.

## Design reference

The editorial design is documented in [`ui-design-mockup/`](./ui-design-mockup/):

- `AI News Tutor.html` — static mockup; open in a browser for the visual source of truth
- `SPEC.md` — full implementation spec mapping each screen to components
