# Article Score Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder article drawer with a tutor-style "score card" — an AI-generated digest (TL;DR, takeaways, why-it-matters, real tags, suggested questions) over a real hero image, that launches a grounded chat when a question chip is tapped.

**Architecture:** A new `lib/digest.ts` (sibling of the existing `lib/summarize.ts`) generates per-article digests at ingest, cached by slug+content-hash, served by a new `GET /api/digest`. `AppShell` prefetches the digest map on mount (non-blocking, so the sidebar never waits) and feeds the active article's digest into a decomposed drawer (`ArticleDrawer` → `ArticleHero` + `ScoreCard`). Question chips call back into `AppShell`'s existing `sendMessage` path.

**Tech Stack:** Next.js 14 (App Router), TypeScript, `@anthropic-ai/sdk@^0.40.0`, Vitest + Testing Library (jsdom), custom CSS ("Aurora Mist").

## Global Constraints

- **SDK is `@anthropic-ai/sdk@^0.40.0`** — it predates `output_config.format` / `messages.parse()`. Generate the digest as a JSON object in the model's text reply and `JSON.parse` it. Do NOT use structured outputs.
- **Digest model:** `process.env.DIGEST_MODEL ?? 'claude-haiku-4-5'` — mirrors `SUMMARY_MODEL` in `lib/summarize.ts`. Env-overridable; do not hardcode another model.
- **Fail-soft everywhere:** a missing API key, API error, malformed JSON, missing `og:image`, or unreachable `/api/digest` must degrade gracefully — never crash ingest or the UI. The original-article link always works.
- **Mirror `lib/summarize.ts`** for the digest module: guarded module-scoped client, `slug + contentHash` cache, bounded concurrency (`CONCURRENCY = 5`).
- **`Article` shape (current):** `{ title, url, pubDate, description, body, summary }` — this plan adds `heroImage: string`. The digest is NOT a field on `Article`; it lives in its own module/endpoint.
- **Quality gate (run before each commit):** `npm run lint && npm run typecheck && npm run test:run`.
- **Worktree:** all work happens in `Projects/ai-tutor-wt-article-score-card` on branch `feat/article-score-card`. Do not run `npm run build` while `npm run dev` is live (shared `.next`).
- Test mocking conventions: mock the SDK with `vi.hoisted` + `vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn(() => ({ messages: { create: createMock } })) }))`; stub `global.fetch`; reset the in-process scraper cache with `vi.resetModules()` + dynamic `import()` (or call `getClaudeArticles({ force: true })`).

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/types.ts` | Add the shared `ArticleDigest` interface (alongside `Article`/`Message`). |
| `src/lib/scraper.ts` | Capture `og:image` into a new `Article.heroImage`. |
| `src/lib/digest.ts` (new) | LLM digest generation + slug/hash cache + bounded concurrency. |
| `src/app/api/digest/route.ts` (new) | `GET` → `{ digests: Record<url, ArticleDigest \| null> }`. |
| `src/components/ArticleHero.tsx` (new) | `og:image` with category-tinted gradient fallback. |
| `src/components/ScoreCard.tsx` (new) | Digest render: loading / ready / fallback states + question chips. |
| `src/components/ArticleDrawer.tsx` | Shell: head + `ArticleHero` + `ScoreCard`; new props. |
| `src/components/AppShell.tsx` | Prefetch digests; compute accent color; wire chip → `sendMessage`. |
| `src/app/globals.css` | Hero image/gradient, takeaways, why-it-matters, chips, skeleton. |

---

### Task 1: Capture `og:image` in the scraper

**Files:**
- Modify: `src/lib/scraper.ts`
- Test: `src/lib/scraper.heroImage.test.ts` (create)

**Interfaces:**
- Produces: `Article.heroImage: string` (absolute URL, or `''` when absent/unresolvable).

- [ ] **Step 1: Write the failing test**

Create `src/lib/scraper.heroImage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The scraper imports summarizeAll, which constructs the Anthropic SDK — mock it
// so ingest never makes a live call.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({ messages: { create: createMock } })),
}));

const INDEX_HTML = `<a href="/blog/post-one">Post One</a>`;

function articleHtml(ogImage: string | null): string {
  const og = ogImage ? `<meta property="og:image" content="${ogImage}">` : '';
  const ld = JSON.stringify({
    '@type': 'BlogPosting',
    datePublished: '2026-06-10T00:00:00Z',
    description: 'Desc',
    articleBody: 'Body text here.',
  });
  return `<!doctype html><html><head>${og}
    <script type="application/ld+json">${ld}</script>
  </head><body><main><p>Body text here.</p></main></body></html>`;
}

function stubFetch(article: string): void {
  global.fetch = vi.fn((url: string | URL) => {
    const u = String(url);
    const body = u.endsWith('/blog') ? INDEX_HTML : article;
    return Promise.resolve({ ok: true, status: 200, text: async () => body } as Response);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  createMock.mockResolvedValue({ content: [{ type: 'text', text: 'Canned summary.' }] });
});
afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('scraper og:image → Article.heroImage', () => {
  it('captures an absolute og:image', async () => {
    stubFetch(articleHtml('https://cdn.claude.com/hero.png'));
    const { getClaudeArticles } = await import('./scraper');
    const articles = await getClaudeArticles({ force: true });
    expect(articles[0].heroImage).toBe('https://cdn.claude.com/hero.png');
  });

  it('resolves a relative og:image against the origin', async () => {
    stubFetch(articleHtml('/img/hero.png'));
    const { getClaudeArticles } = await import('./scraper');
    const articles = await getClaudeArticles({ force: true });
    expect(articles[0].heroImage).toBe('https://claude.com/img/hero.png');
  });

  it('defaults heroImage to empty string when og:image is absent', async () => {
    stubFetch(articleHtml(null));
    const { getClaudeArticles } = await import('./scraper');
    const articles = await getClaudeArticles({ force: true });
    expect(articles[0].heroImage).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/lib/scraper.heroImage.test.ts`
Expected: FAIL — `heroImage` is `undefined` (property doesn't exist yet).

- [ ] **Step 3: Add `heroImage` to the `Article` interface**

In `src/lib/scraper.ts`, in the `export interface Article { ... }` block, add the field after `summary`:

```ts
  summary: string; // compact grounding text for chat context (<= SUMMARY_CHAR_CAP)
  heroImage: string; // og:image URL for the drawer hero, '' if absent/unresolvable
```

- [ ] **Step 4: Add the selector and parse `og:image`**

In `src/lib/scraper.ts`, add a selector next to the other `SEL_` constants:

```ts
const SEL_OG_IMAGE = 'meta[property="og:image"]';
```

Add `heroImage` to the `BodyData` interface:

```ts
interface BodyData {
  body: string;
  description: string;
  pubDate: string;
  heroImage: string;
}
```

In `parseArticleBody`, just before the `return { ... }`, extract and resolve the image:

```ts
  let heroImage = '';
  const ogImage = root.querySelector(SEL_OG_IMAGE)?.getAttribute('content');
  if (ogImage) {
    try {
      heroImage = new URL(ogImage, CLAUDE_ORIGIN).toString();
    } catch {
      heroImage = ''; // malformed URL — drop to the gradient fallback
    }
  }
```

Add `heroImage` to that function's return object:

```ts
  return {
    body,
    description: excerptFrom(stripHtml(description), EXCERPT_CAP),
    pubDate,
    heroImage,
  };
```

- [ ] **Step 5: Thread `heroImage` through `fetchArticleBody` (both paths)**

In `fetchArticleBody`, add `heroImage` to the success return:

```ts
    return {
      title: card.title,
      url: card.url,
      pubDate: toIsoDate(parsed.pubDate || card.pubDate),
      description: parsed.description,
      body: parsed.body,
      summary: '', // filled by summarizeAll after sorting (see getClaudeArticles)
      heroImage: parsed.heroImage,
    };
```

And to the catch (degraded) return:

```ts
    return {
      title: card.title,
      url: card.url,
      pubDate: toIsoDate(card.pubDate),
      description: '',
      body: '',
      summary: '',
      heroImage: '',
    };
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:run -- src/lib/scraper.heroImage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Run the full gate and commit**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: PASS.

```bash
git add src/lib/scraper.ts src/lib/scraper.heroImage.test.ts
git commit -m "feat(scraper): capture og:image into Article.heroImage"
```

---

### Task 2: `ArticleDigest` type + `lib/digest.ts`

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/digest.ts`
- Test: `src/lib/digest.test.ts` (create)

**Interfaces:**
- Produces:
  - `interface ArticleDigest { tldr: string; takeaways: string[]; whyItMatters: string; tags: string[]; questions: string[] }`
  - `digestArticle(a: Article): Promise<ArticleDigest | null>`
  - `getArticleDigests(): Promise<Record<string, ArticleDigest | null>>`
- Consumes: `getClaudeArticles` and `Article` from the scraper (Task 1).

- [ ] **Step 1: Add the `ArticleDigest` type**

In `src/lib/types.ts`, after the `Message` interface, add:

```ts
/** AI-generated score-card digest for one article (see lib/digest.ts). */
export interface ArticleDigest {
  tldr: string; // 1–2 sentences
  takeaways: string[]; // 3–4 bullets
  whyItMatters: string; // one business-impact line
  tags: string[]; // exactly 3 topic tags
  questions: string[]; // 2–3 self-contained tutor questions
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/digest.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Article } from './types';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({ messages: { create: createMock } })),
}));

const ARTICLE: Article = {
  title: 'Post',
  url: 'https://claude.com/blog/post',
  pubDate: '2026-06-10T00:00:00Z',
  description: 'Desc',
  body: 'Full body text.',
  summary: '',
  heroImage: '',
};

const VALID = {
  tldr: 'A one-liner.',
  takeaways: ['a', 'b', 'c'],
  whyItMatters: 'It matters.',
  tags: ['X', 'Y', 'Z'],
  questions: ['Q1?', 'Q2?'],
};

const textRes = (text: string) => ({ content: [{ type: 'text', text }] });

beforeEach(() => createMock.mockReset());
afterEach(() => vi.resetModules());

describe('digestArticle', () => {
  it('parses a valid JSON digest', async () => {
    createMock.mockResolvedValue(textRes(JSON.stringify(VALID)));
    const { digestArticle } = await import('./digest');
    expect(await digestArticle(ARTICLE)).toEqual(VALID);
  });

  it('strips a ```json fence around the object', async () => {
    createMock.mockResolvedValue(textRes('```json\n' + JSON.stringify(VALID) + '\n```'));
    const { digestArticle } = await import('./digest');
    expect(await digestArticle(ARTICLE)).toEqual(VALID);
  });

  it('returns null on malformed JSON', async () => {
    createMock.mockResolvedValue(textRes('not json at all'));
    const { digestArticle } = await import('./digest');
    expect(await digestArticle(ARTICLE)).toBeNull();
  });

  it('returns null when the shape is invalid', async () => {
    createMock.mockResolvedValue(textRes(JSON.stringify({ tldr: 'only this' })));
    const { digestArticle } = await import('./digest');
    expect(await digestArticle(ARTICLE)).toBeNull();
  });

  it('returns null when the SDK throws', async () => {
    createMock.mockRejectedValue(new Error('boom'));
    const { digestArticle } = await import('./digest');
    expect(await digestArticle(ARTICLE)).toBeNull();
  });

  it('returns null for an empty body without calling the model', async () => {
    const { digestArticle } = await import('./digest');
    expect(await digestArticle({ ...ARTICLE, body: '' })).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:run -- src/lib/digest.test.ts`
Expected: FAIL — cannot resolve `./digest`.

- [ ] **Step 4: Implement `lib/digest.ts`**

Create `src/lib/digest.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { getClaudeArticles } from './scraper';
import type { Article, ArticleDigest } from './types';

/**
 * Per-article "score card" digest, generated at ingest and cached by
 * slug + content hash (sibling of lib/summarize.ts). Every failure degrades to
 * `null` for that article rather than dropping it or throwing.
 */

const DIGEST_MODEL = process.env.DIGEST_MODEL ?? 'claude-haiku-4-5';
const DIGEST_MAX_TOKENS = 600;
const BODY_INPUT_CAP = 12_000;
const CONCURRENCY = 5;

const DIGEST_SYSTEM_PROMPT =
  'You are an AI-news tutor distilling a Claude blog post into a score card. ' +
  'Return ONLY a JSON object — no markdown, no code fence, no preamble — with these keys: ' +
  'tldr (a 1-2 sentence string), takeaways (array of 3-4 short strings), ' +
  'whyItMatters (one sentence on the business impact for a non-technical reader), ' +
  'tags (array of exactly 3 short topic tags), ' +
  'questions (array of 2-3 self-contained questions a curious learner would ask about THIS article). ' +
  'Every field is plain text — no markdown.';

// One guarded client at module scope: a missing key degrades to null digests
// rather than crashing ingest at import time (mirrors lib/summarize.ts).
let client: Anthropic | null = null;
try {
  client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
} catch (err) {
  console.error('[digest] client init failed; digests will be null:', err);
  client = null;
}

/** Cache survives a body re-fetch; keyed by slug, invalidated by content hash. */
const digestCache = new Map<string, { hash: string; digest: ArticleDigest | null }>();

/** Cheap stable hash (djb2) over title+body — changes only when content changes. */
function contentHash(title: string, body: string): string {
  const input = `${title} ${body}`;
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function slugFromUrl(url: string): string {
  const m = url.match(/\/blog\/([^/?#]+)/);
  return m ? m[1] : url;
}

/** Pull the JSON object out of the reply, tolerating a ```json fence or stray prose. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isValidDigest(v: unknown): v is ArticleDigest {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.tldr === 'string' &&
    isStringArray(d.takeaways) &&
    typeof d.whyItMatters === 'string' &&
    isStringArray(d.tags) &&
    isStringArray(d.questions)
  );
}

/** Digest one article. Never throws — returns null on any failure. */
export async function digestArticle(a: Article): Promise<ArticleDigest | null> {
  const body = (a.body ?? '').trim();
  if (!body || !client) return null;

  try {
    const res = await client.messages.create({
      model: DIGEST_MODEL,
      max_tokens: DIGEST_MAX_TOKENS,
      system: DIGEST_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `${a.title}\n\n${body.slice(0, BODY_INPUT_CAP)}` }],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ');

    const parsed: unknown = JSON.parse(extractJson(text));
    return isValidDigest(parsed) ? parsed : null;
  } catch (err) {
    console.error(`[digest] failed for ${a.url}:`, err);
    return null;
  }
}

/**
 * Digest every article, reusing cached digests for unchanged content (0 API
 * calls on a cache hit). Misses run with bounded concurrency. Returns a map
 * keyed by article URL.
 */
export async function getArticleDigests(): Promise<Record<string, ArticleDigest | null>> {
  const articles = await getClaudeArticles();
  const out: Record<string, ArticleDigest | null> = {};
  const misses: Article[] = [];

  for (const a of articles) {
    const cached = digestCache.get(slugFromUrl(a.url));
    const hash = contentHash(a.title, a.body ?? '');
    if (cached && cached.hash === hash) {
      out[a.url] = cached.digest;
    } else {
      misses.push(a);
    }
  }

  for (let i = 0; i < misses.length; i += CONCURRENCY) {
    const chunk = misses.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (a) => {
        const digest = await digestArticle(a);
        digestCache.set(slugFromUrl(a.url), {
          hash: contentHash(a.title, a.body ?? ''),
          digest,
        });
        out[a.url] = digest;
      }),
    );
  }

  return out;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:run -- src/lib/digest.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the full gate and commit**

Run: `npm run lint && npm run typecheck && npm run test:run`

```bash
git add src/lib/types.ts src/lib/digest.ts src/lib/digest.test.ts
git commit -m "feat(digest): per-article score-card digest module (mirrors summarize)"
```

---

### Task 3: `GET /api/digest`

**Files:**
- Create: `src/app/api/digest/route.ts`
- Test: `src/app/api/digest/route.test.ts` (create)

**Interfaces:**
- Consumes: `getArticleDigests` from `@/lib/digest` (Task 2).
- Produces: `GET` → `NextResponse.json({ digests: Record<string, ArticleDigest | null> })`.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/digest/route.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

const { getArticleDigestsMock } = vi.hoisted(() => ({ getArticleDigestsMock: vi.fn() }));
vi.mock('@/lib/digest', () => ({ getArticleDigests: getArticleDigestsMock }));

import { GET } from './route';

const DIGEST = {
  tldr: 't',
  takeaways: ['a'],
  whyItMatters: 'w',
  tags: ['x', 'y', 'z'],
  questions: ['q?'],
};

describe('GET /api/digest', () => {
  it('returns the digests map', async () => {
    getArticleDigestsMock.mockResolvedValue({ 'https://x/a': DIGEST });
    const res = await GET();
    const json = await res.json();
    expect(json.digests['https://x/a']).toEqual(DIGEST);
  });

  it('fails soft to an empty map when generation throws', async () => {
    getArticleDigestsMock.mockRejectedValue(new Error('boom'));
    const res = await GET();
    const json = await res.json();
    expect(json.digests).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/app/api/digest/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement the route**

Create `src/app/api/digest/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getArticleDigests } from '@/lib/digest';

export async function GET() {
  try {
    const digests = await getArticleDigests();
    return NextResponse.json({ digests });
  } catch (err) {
    console.error('[api/digest] failed:', err);
    // Fail soft: the drawer renders its description-only fallback when the map is empty.
    return NextResponse.json({ digests: {} });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- src/app/api/digest/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full gate and commit**

Run: `npm run lint && npm run typecheck && npm run test:run`

```bash
git add src/app/api/digest/route.ts src/app/api/digest/route.test.ts
git commit -m "feat(api): GET /api/digest returns the per-article digest map"
```

---

### Task 4: `ArticleHero` component

**Files:**
- Create: `src/components/ArticleHero.tsx`
- Test: `src/components/ArticleHero.test.tsx` (create)

**Interfaces:**
- Produces: `ArticleHero({ src: string; alt: string; accentColor: string })` — renders `<img>` when `src` is non-empty and hasn't errored, otherwise a gradient (`--hero-accent`) with the `Article preview` label.

- [ ] **Step 1: Write the failing test**

Create `src/components/ArticleHero.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ArticleHero from './ArticleHero';

describe('ArticleHero', () => {
  it('renders the image when src is present', () => {
    render(<ArticleHero src="https://x/y.png" alt="Title" accentColor="#abc" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://x/y.png');
  });

  it('shows the gradient fallback when src is empty', () => {
    render(<ArticleHero src="" alt="Title" accentColor="#abc" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Article preview')).toBeInTheDocument();
  });

  it('falls back to the gradient when the image fails to load', () => {
    render(<ArticleHero src="https://x/broken.png" alt="Title" accentColor="#abc" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Article preview')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/components/ArticleHero.test.tsx`
Expected: FAIL — cannot resolve `./ArticleHero`.

- [ ] **Step 3: Implement the component**

Create `src/components/ArticleHero.tsx`:

```tsx
'use client';

import { useState, type CSSProperties } from 'react';

interface ArticleHeroProps {
  src: string; // article.heroImage, '' when absent
  alt: string; // article title
  accentColor: string; // category color driving the gradient fallback
}

export default function ArticleHero({ src, alt, accentColor }: ArticleHeroProps) {
  const [failed, setFailed] = useState(false);
  const showImage = src !== '' && !failed;

  // Expose the category color to CSS for the tinted gradient fallback.
  const style = { '--hero-accent': accentColor } as CSSProperties;

  return (
    <div className="drawer-hero" style={style}>
      {showImage ? (
        <img className="drawer-hero-img" src={src} alt={alt} onError={() => setFailed(true)} />
      ) : (
        <span className="ph-label">Article preview</span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- src/components/ArticleHero.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full gate and commit**

Run: `npm run lint && npm run typecheck && npm run test:run`

```bash
git add src/components/ArticleHero.tsx src/components/ArticleHero.test.tsx
git commit -m "feat(drawer): ArticleHero with og:image + gradient fallback"
```

---

### Task 5: `ScoreCard` component

**Files:**
- Create: `src/components/ScoreCard.tsx`
- Test: `src/components/ScoreCard.test.tsx` (create)

**Interfaces:**
- Consumes: `ArticleDigest` from `@/lib/types`; `InlineMarkdown`; `LinkIcon` from `./icons`.
- Produces: `ScoreCard({ digest: ArticleDigest | null; digestsLoaded: boolean; description: string; url: string; onAsk: (q: string) => void })`.

- [ ] **Step 1: Write the failing test**

Create `src/components/ScoreCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScoreCard from './ScoreCard';
import type { ArticleDigest } from '@/lib/types';

const DIGEST: ArticleDigest = {
  tldr: 'The gist.',
  takeaways: ['First', 'Second', 'Third'],
  whyItMatters: 'Because impact.',
  tags: ['Claude', 'MCP', 'Security'],
  questions: ['What is MCP?', 'Why now?'],
};

const noop = () => {};

describe('ScoreCard', () => {
  it('shows a skeleton while digests are loading', () => {
    const { container } = render(
      <ScoreCard digest={null} digestsLoaded={false} description="x" url="u" onAsk={noop} />,
    );
    expect(container.querySelector('.score-card-loading')).toBeInTheDocument();
  });

  it('renders the digest when present', () => {
    render(<ScoreCard digest={DIGEST} digestsLoaded description="x" url="u" onAsk={noop} />);
    expect(screen.getByText('The gist.')).toBeInTheDocument();
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Because impact.')).toBeInTheDocument();
    expect(screen.getByText('MCP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What is MCP?' })).toBeInTheDocument();
  });

  it('calls onAsk with the question when a chip is clicked', () => {
    const onAsk = vi.fn();
    render(<ScoreCard digest={DIGEST} digestsLoaded description="x" url="u" onAsk={onAsk} />);
    fireEvent.click(screen.getByRole('button', { name: 'Why now?' }));
    expect(onAsk).toHaveBeenCalledWith('Why now?');
  });

  it('falls back to the description + original link when digest is null', () => {
    render(
      <ScoreCard digest={null} digestsLoaded description="The summary." url="https://x/a" onAsk={noop} />,
    );
    expect(screen.getByText('The summary.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /original article/i })).toHaveAttribute('href', 'https://x/a');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/components/ScoreCard.test.tsx`
Expected: FAIL — cannot resolve `./ScoreCard`.

- [ ] **Step 3: Implement the component**

Create `src/components/ScoreCard.tsx`:

```tsx
'use client';

import type { ArticleDigest } from '@/lib/types';
import InlineMarkdown from './InlineMarkdown';
import { LinkIcon } from './icons';

interface ScoreCardProps {
  digest: ArticleDigest | null;
  digestsLoaded: boolean;
  description: string; // fallback excerpt when there's no digest
  url: string; // original article link
  onAsk: (question: string) => void;
}

function OriginalLink({ url }: { url: string }) {
  return (
    <a
      className="source-chip score-original"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <LinkIcon />
      <span className="source-chip-title">Read the original article</span>
    </a>
  );
}

function ScoreCardSkeleton() {
  return (
    <div className="score-card score-card-loading" aria-hidden="true">
      <div className="score-skel score-skel-line" />
      <div className="score-skel score-skel-line short" />
      <div className="score-skel score-skel-block" />
      <div className="score-skel score-skel-tags" />
    </div>
  );
}

export default function ScoreCard({ digest, digestsLoaded, description, url, onAsk }: ScoreCardProps) {
  if (!digestsLoaded) return <ScoreCardSkeleton />;

  if (!digest) {
    return (
      <div className="score-card">
        <p className="drawer-summary">{description}</p>
        <OriginalLink url={url} />
      </div>
    );
  }

  return (
    <div className="score-card">
      <p className="score-tldr">
        <InlineMarkdown text={digest.tldr} />
      </p>

      <ul className="score-takeaways">
        {digest.takeaways.map((t, i) => (
          <li key={i}>
            <InlineMarkdown text={t} />
          </li>
        ))}
      </ul>

      {/* Reuses the chat Impact-card styling (.impact) with a card-appropriate label. */}
      <div className="impact">
        <div className="impact-label">
          <span aria-hidden="true">💼</span> Why it matters
        </div>
        <p className="impact-text">
          <InlineMarkdown text={digest.whyItMatters} />
        </p>
      </div>

      <div className="drawer-tags">
        {digest.tags.map((t) => (
          <span key={t} className="tag">
            {t}
          </span>
        ))}
      </div>

      <div className="score-asks">
        <div className="score-asks-label">Ask the tutor</div>
        {digest.questions.map((q) => (
          <button key={q} type="button" className="score-ask" onClick={() => onAsk(q)}>
            {q}
          </button>
        ))}
      </div>

      <OriginalLink url={url} />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- src/components/ScoreCard.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full gate and commit**

Run: `npm run lint && npm run typecheck && npm run test:run`

```bash
git add src/components/ScoreCard.tsx src/components/ScoreCard.test.tsx
git commit -m "feat(drawer): ScoreCard with loading/ready/fallback states + question chips"
```

---

### Task 6: Refactor `ArticleDrawer` to compose hero + score card

**Files:**
- Modify: `src/components/ArticleDrawer.tsx`
- Test: `src/components/ArticleDrawer.test.tsx` (create)

**Interfaces:**
- Consumes: `ArticleHero` (Task 4), `ScoreCard` (Task 5), `Article` + `ArticleDigest` from `@/lib/types`.
- Produces: `ArticleDrawer({ article, digest, digestsLoaded, accentColor, open, onClose, onAsk })`.

- [ ] **Step 1: Write the failing test**

Create `src/components/ArticleDrawer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ArticleDrawer from './ArticleDrawer';
import type { Article, ArticleDigest } from '@/lib/types';

const ARTICLE: Article = {
  title: 'Big Post',
  url: 'https://claude.com/blog/big',
  pubDate: '2026-06-10T00:00:00Z',
  description: 'Excerpt.',
  body: 'Body',
  summary: '',
  heroImage: '',
};
const DIGEST: ArticleDigest = {
  tldr: 'Gist',
  takeaways: ['a'],
  whyItMatters: 'w',
  tags: ['T'],
  questions: ['Ask me?'],
};

function renderDrawer(overrides: Partial<React.ComponentProps<typeof ArticleDrawer>> = {}) {
  return render(
    <ArticleDrawer
      article={ARTICLE}
      digest={DIGEST}
      digestsLoaded
      accentColor="#abc"
      open
      onClose={() => {}}
      onAsk={() => {}}
      {...overrides}
    />,
  );
}

describe('ArticleDrawer', () => {
  it('renders the title and the score card', () => {
    renderDrawer();
    expect(screen.getByRole('heading', { name: 'Big Post' })).toBeInTheDocument();
    expect(screen.getByText('Gist')).toBeInTheDocument();
  });

  it('routes a chip click to onAsk', () => {
    const onAsk = vi.fn();
    renderDrawer({ onAsk });
    fireEvent.click(screen.getByRole('button', { name: 'Ask me?' }));
    expect(onAsk).toHaveBeenCalledWith('Ask me?');
  });

  it('closes on Escape when open', () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/components/ArticleDrawer.test.tsx`
Expected: FAIL — `ArticleDrawer` doesn't accept the new props / render the digest.

- [ ] **Step 3: Rewrite `ArticleDrawer.tsx`**

Replace the entire file with:

```tsx
'use client';

import { useEffect } from 'react';
import type { Article, ArticleDigest } from '@/lib/types';
import { formatShortDate } from './sidebar/kb';
import { CloseIcon } from './icons';
import ArticleHero from './ArticleHero';
import ScoreCard from './ScoreCard';

interface ArticleDrawerProps {
  article: Article | null;
  digest: ArticleDigest | null;
  digestsLoaded: boolean;
  accentColor: string;
  open: boolean;
  onClose: () => void;
  onAsk: (question: string) => void;
}

export default function ArticleDrawer({
  article,
  digest,
  digestsLoaded,
  accentColor,
  open,
  onClose,
  onAsk,
}: ArticleDrawerProps) {
  // Esc closes the drawer (focus return is handled by the shell).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <aside className={`drawer${open ? ' open' : ''}`} aria-hidden={!open}>
      {article && (
        <div className="drawer-inner">
          <div className="drawer-head">
            <span className="drawer-date">{formatShortDate(article.pubDate)}</span>
            <button
              type="button"
              className="drawer-close"
              onClick={onClose}
              aria-label="Close article"
            >
              <CloseIcon />
            </button>
          </div>
          <h2 className="drawer-title">{article.title}</h2>
          <ArticleHero src={article.heroImage} alt={article.title} accentColor={accentColor} />
          <ScoreCard
            digest={digest}
            digestsLoaded={digestsLoaded}
            description={article.description}
            url={article.url}
            onAsk={onAsk}
          />
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- src/components/ArticleDrawer.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full gate and commit**

Run: `npm run lint && npm run typecheck && npm run test:run`
Note: this will fail to typecheck `AppShell.tsx` (it still renders `<ArticleDrawer>` with the old props). That's fixed in Task 7 — if running tasks strictly in isolation, expect a typecheck error here on `AppShell.tsx` and resolve it in Task 7. To keep each commit green, do Step 5's commit together with Task 7, or temporarily run only the targeted tests. Recommended: commit the two together.

```bash
git add src/components/ArticleDrawer.tsx src/components/ArticleDrawer.test.tsx
git commit -m "feat(drawer): compose ArticleHero + ScoreCard; new digest/onAsk props"
```

---

### Task 7: Wire `AppShell` — prefetch digests, accent color, chip → chat

**Files:**
- Modify: `src/components/AppShell.tsx`
- Test: `src/components/AppShell.digest.test.tsx` (create)

**Interfaces:**
- Consumes: `ArticleDigest` from `@/lib/types`; `categoryFor` from `./sidebar/kb`; `GET /api/digest` (Task 3); the new `ArticleDrawer` props (Task 6); existing `sendMessage`.

- [ ] **Step 1: Write the failing test**

Create `src/components/AppShell.digest.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import AppShell from './AppShell';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (String(url).includes('/api/digest')) {
        return Promise.resolve({ ok: true, json: async () => ({ digests: {} }) });
      }
      // /api/scrape and anything else
      return Promise.resolve({ ok: true, json: async () => ({ articles: [] }) });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('AppShell — digest prefetch', () => {
  it('fetches /api/digest on mount', async () => {
    render(<AppShell />);
    await waitFor(() =>
      expect(
        (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some((c) =>
          String(c[0]).includes('/api/digest'),
        ),
      ).toBe(true),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/components/AppShell.digest.test.tsx`
Expected: FAIL — `/api/digest` is never requested.

- [ ] **Step 3: Add imports**

In `src/components/AppShell.tsx`, extend the type import and add `categoryFor`:

```ts
import type { Message, Article, ArticleDigest } from '@/lib/types';
```

Add near the other component/util imports:

```ts
import { categoryFor } from './sidebar/kb';
```

- [ ] **Step 4: Add digest state + prefetch effect**

After the `const [drawerOpen, setDrawerOpen] = useState(false);` line, add:

```ts
  const [digests, setDigests] = useState<Record<string, ArticleDigest | null>>({});
  const [digestsLoaded, setDigestsLoaded] = useState(false);
```

After the existing `useEffect(() => { loadArticles(); }, [loadArticles]);`, add a mount-only prefetch (non-blocking; the sidebar already renders from `/api/scrape`):

```ts
  // Prefetch the per-article digests once, in the background. The sidebar list
  // never waits on this; the drawer reads from `digests` when an article opens.
  useEffect(() => {
    fetch('/api/digest')
      .then((r) => r.json())
      .then((d: { digests?: Record<string, ArticleDigest | null> }) => setDigests(d.digests ?? {}))
      .catch(console.error)
      .finally(() => setDigestsLoaded(true));
  }, []);
```

- [ ] **Step 5: Compute the active article's accent color**

Add after the `timings` `useMemo` (anywhere among the hooks, before `return`):

```ts
  // Category color of the active article, for the hero gradient fallback. Keeps
  // the palette logic in one place (sidebar/kb), matching the KB card dots.
  const activeAccent = useMemo(() => {
    if (!activeArticle) return categoryFor(0).color;
    const i = articles.findIndex((a) => a.url === activeArticle.url);
    return categoryFor(i >= 0 ? i : 0).color;
  }, [activeArticle, articles]);
```

- [ ] **Step 6: Update the `<ArticleDrawer>` render**

Replace the existing `<ArticleDrawer ... />` line with:

```tsx
      <ArticleDrawer
        article={activeArticle}
        digest={activeArticle ? digests[activeArticle.url] ?? null : null}
        digestsLoaded={digestsLoaded}
        accentColor={activeAccent}
        open={drawerOpen}
        onClose={closeDrawer}
        onAsk={(q) => {
          closeDrawer();
          void sendMessage(q);
        }}
      />
```

- [ ] **Step 7: Run the new test and the existing AppShell test**

Run: `npm run test:run -- src/components/AppShell.digest.test.tsx src/components/AppShell.test.tsx`
Expected: PASS. (The existing test's blanket fetch stub returns `{ articles: [] }` for `/api/digest` too, so `digests` is `{}` — no behavior change there.)

- [ ] **Step 8: Run the full gate and commit**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: PASS (typecheck now clean — `AppShell` passes the new props).

```bash
git add src/components/AppShell.tsx src/components/AppShell.digest.test.tsx
git commit -m "feat(drawer): prefetch digests, pass accent color, wire chip -> sendMessage"
```

---

### Task 8: Style the score card (`globals.css`)

**Files:**
- Modify: `src/app/globals.css`

No unit test (CSS). Deliverable: the gate passes and the drawer renders all three states correctly in the browser.

- [ ] **Step 1: Update the hero rule for image + tinted gradient fallback**

In `src/app/globals.css`, find the existing `.drawer-hero { ... }` rule. Ensure it contains `position: relative;` and `overflow: hidden;`, and set its background to the category-tinted gradient (replace the existing hatch/placeholder background):

```css
.drawer-hero {
  position: relative;
  overflow: hidden;
  border-radius: 14px;
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
  background: linear-gradient(
    135deg,
    color-mix(in oklch, var(--hero-accent, var(--faint)) 22%, transparent),
    color-mix(in oklch, var(--hero-accent, var(--faint)) 6%, transparent)
  );
}
```

- [ ] **Step 2: Append the new rules**

Add after the drawer styles block:

```css
/* ── article score card ─────────────────────────────────────────────── */
.drawer-hero-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.score-card { display: flex; flex-direction: column; gap: 16px; }

.score-tldr {
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink);
  margin: 0;
  text-wrap: pretty;
}

.score-takeaways {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.score-takeaways li {
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink-soft);
}

.score-asks { display: flex; flex-direction: column; gap: 8px; }
.score-asks-label {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--faint);
}
.score-ask {
  text-align: left;
  font-size: 14px;
  line-height: 1.45;
  color: var(--ink);
  padding: 10px 12px;
  border: 1px solid var(--faint);
  border-radius: 12px;
  background: var(--surface, rgba(255, 255, 255, 0.5));
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.score-ask:hover {
  border-color: var(--ink-soft);
  background: rgba(255, 255, 255, 0.8);
}

.score-original { align-self: flex-start; }

/* skeleton while digests prefetch */
.score-card-loading { gap: 14px; }
.score-skel {
  border-radius: 8px;
  background: linear-gradient(90deg, var(--faint) 25%, rgba(255, 255, 255, 0.6) 50%, var(--faint) 75%);
  background-size: 200% 100%;
  animation: score-shimmer 1.3s ease-in-out infinite;
}
.score-skel-line { height: 14px; }
.score-skel-line.short { width: 60%; }
.score-skel-block { height: 64px; }
.score-skel-tags { height: 22px; width: 50%; }

@keyframes score-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .score-skel { animation: none; }
}
```

> Note: `--ink`, `--ink-soft`, `--faint`, `--mono` are existing Aurora-Mist tokens (used by the current drawer rules). If `--surface` isn't defined, the inline fallback (`rgba(255,255,255,0.5)`) applies. Verify token names against the `:root` block in `globals.css` and adjust if any differ.

- [ ] **Step 3: Verify the gate**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: PASS (no test references these styles by computed value; component tests only assert class presence).

- [ ] **Step 4: Manual verification in the browser**

Stop any running build first. Then:

Run: `npm run dev`
Then open `http://localhost:3000`, click a knowledge-base card, and confirm:
- Hero shows a real image, or a tinted gradient when the article has no `og:image`.
- TL;DR, 3–4 takeaways, a "Why it matters" callout, 3 tags, and 2–3 question chips render.
- A brief skeleton appears if you open a card before `/api/digest` resolves.
- Clicking a question chip closes the drawer and sends that question to the tutor (an answer streams in).
- An article whose digest failed shows the description excerpt + the "Read the original article" link (no chips).

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css
git commit -m "style(drawer): score-card layout, tinted hero, question chips, skeleton"
```

---

## Self-Review

**Spec coverage:**
- og:image hero → Task 1 (+ Task 4 render, Task 8 styles). ✓
- LLM digest, pre-computed, cached, fail-soft, mirrors summarize → Task 2. ✓
- `/api/digest` endpoint (Approach A) → Task 3. ✓
- Prefetch into client state, non-blocking sidebar → Task 7. ✓
- Decomposed drawer (`ArticleDrawer`/`ArticleHero`/`ScoreCard`), 3 states → Tasks 4–6. ✓
- Suggested question chips → tutor (`sendMessage`) → Task 5 (chip) + Task 7 (wiring). ✓
- No score/difficulty/read-time → digest type omits them. ✓
- Reuse Impact styling, SourceChips-style link, InlineMarkdown → Task 5. ✓
- Tests for digest/og:image/ScoreCard/ArticleHero/chip → Tasks 1–7. ✓

**Type consistency:** `ArticleDigest` (5 fields) defined in `types.ts` (Task 2), consumed identically in `digest.ts`, `ScoreCard`, `ArticleDrawer`, `AppShell`. `digestArticle`/`getArticleDigests` names match across Tasks 2/3. `ArticleHero`/`ScoreCard`/`ArticleDrawer` prop names match across Tasks 4–7. `Article.heroImage` added in Task 1, consumed in Tasks 6–7. ✓

**Placeholder scan:** none — every step shows the code or exact command.

**Cross-task ordering caveat:** Task 6 leaves `AppShell.tsx` temporarily out of sync with `ArticleDrawer`'s props; Task 7 fixes it. Commit Tasks 6 and 7 together (or run targeted tests between them) to keep typecheck green at each commit boundary.
