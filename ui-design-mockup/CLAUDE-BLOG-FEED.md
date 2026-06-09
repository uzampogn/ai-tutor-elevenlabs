# Claude.com Blog Feed — Integration Spec

> **Status:** Proposed · **Owner:** AI News Tutor · **Companion docs:** [SPEC.md](./SPEC.md), [TESTING.md](./TESTING.md)

## 1. Overview & goals

The app grounds every answer in "Anthropic's 10 most recent blog articles," fetched from `https://www.anthropic.com/rss.xml` and surfaced in the sidebar knowledge base, the article reader drawer, and the chat system prompt.

That RSS endpoint now returns **HTTP 404** — the data source is effectively dead — and Anthropic's blog content now lives at `https://claude.com/blog`.

**Goal:** replace the dead RSS source with a scraper for `https://claude.com/blog` that fetches the **last 10 articles**, including each article's body, and wires them through the existing UI and chat grounding with no change to the public data contract.

**Decisions (confirmed):**

- **Replace**, don't add — claude.com/blog becomes the single article source. No second feed, no feed-switcher UI.
- **Fetch each article body** — not just index metadata — so the reader drawer and chat context keep their excerpts.

**Non-goals:** pagination beyond 10 articles, a second/parallel feed, persistent (cross-process) caching, redesigning the sidebar/drawer UI.

## 2. Source analysis (verified)

| Property | Finding |
|----------|---------|
| Rendering | `https://claude.com/blog` is **server-rendered HTML** (~24 articles, ~760 KB); a plain `fetch` returns them all (confirmed). |
| RSS feed | **None.** `claude.com/rss.xml`, `claude.com/blog/rss.xml`, and `www.anthropic.com/rss.xml` all 404. `fast-xml-parser` no longer applies — this is **HTML scraping**. |
| Index ordering | **Not reliably newest-first.** The index mixes a *featured grid* with the chronological list, and date strings are **not** positionally aligned with anchors — so "first 10 anchors" yields the **wrong** 10. Recency must come from each article's `datePublished`, not card position. |
| Index fields | Per card: **title** + relative link `/blog/<slug>`. **No per-article JSON-LD and no reliable body** on the index — each post page must be fetched. |
| Article page | JSON-LD `@type: "BlogPosting"` carries `headline`, `description`, and `datePublished` in **human format** (`"Jun 08, 2026"`, **not ISO**). No `og:description`/meta description present, so **JSON-LD is the primary source**. |
| Link form | **Relative** (`/blog/<slug>`). Must be absolutized to `https://claude.com/blog/<slug>` — the old RSS gave absolute URLs the UI relies on. |

Verified live (`GET /api/scrape`): the scraper returns the correct latest 10 — `/blog/claude-for-foundation-models` (Jun 8) → `/blog/introducing-dynamic-workflows-in-claude-code` (May 28) — newest-first, all absolute URLs, ISO dates, non-empty descriptions.

## 3. Data model & API contract

**Unchanged.** The `Article` interface and the `/api/scrape` response shape stay exactly as they are, so `AppShell`, `KbList`, `KbCard`, `ArticleDrawer`, `SourceChips`, and `parseAnswer` need no changes.

```ts
// src/lib/scraper.ts — keep this shape verbatim
export interface Article {
  title: string;
  url: string;        // absolute: https://claude.com/blog/<slug>
  pubDate: string;    // ISO 8601 so formatShortDate() renders "JUN 08"
  description: string; // HTML-stripped excerpt, capped ~2500 chars
}
```

```jsonc
// GET /api/scrape — unchanged
{ "articles": Article[] }
```

> **Note:** `src/components/sidebar/kb.ts` → `formatShortDate(pubDate)` parses via `new Date()`. Emitting an **ISO** `pubDate` (from JSON-LD `datePublished`) keeps the "JUN 08" rendering working; a human string like "June 8, 2026" also parses but ISO is the contract.

## 4. Scraper design

Rewrite the fetch/parse internals of `src/lib/scraper.ts`. **Keep** the 1-hour in-memory cache and the graceful-fallback pattern (on failure, return cached or empty — never throw to the route). **Keep** `stripHtml()` and `buildArticleContext()` unchanged. **Rename** `getAnthropicArticles` → `getClaudeArticles`.

```ts
const CLAUDE_BLOG = 'https://claude.com/blog';
const CLAUDE_ORIGIN = 'https://claude.com';
// cachedArticles, cacheTime, CACHE_TTL_MS (1h) — keep as-is
```

### 4.1 Stage 1 — Index → candidate list

`fetch(CLAUDE_BLOG, { headers: { 'User-Agent': 'AI-Tutor-Bot/1.0' }, next: { revalidate: 3600 } })`, parse the HTML, and collect **all** article cards (capped at `MAX_CANDIDATES = 40`):

- Select anchors whose `href` starts with `/blog/` (`a[href^="/blog/"]`), de-duplicate by slug, preserve document order.
- For each: `title` (anchor text), `url = new URL(href, CLAUDE_ORIGIN).toString()` (absolute), and any on-card `<time>`/date text as a **provisional** `pubDate` (only used if the article page lacks one).
- **Do not** take "the first 10" — the index isn't newest-first (§2). Recency is resolved in Stage 3.

### 4.2 Stage 2 — Per-article body (excerpt + canonical date)

For each candidate URL, `fetch` the post page and extract `description` + `pubDate`, in priority order:

1. **JSON-LD `Article` / `BlogPosting`** (`<script type="application/ld+json">`, `@graph`-aware, type match is case-insensitive on `article|blogposting|newsarticle`): `datePublished` → `pubDate`; `description` / `articleBody` → excerpt. **Most stable / primary.**
2. **Open Graph / meta**: `og:description` (or `<meta name="description">`); `article:published_time` for the date.
3. **Fallback**: first non-trivial paragraph of the main content.

Normalize `pubDate` to **ISO 8601** via `toIsoDate()` (`Date.parse` then `toISOString`; pass through unchanged if unparseable) — the live `datePublished` is human format (`"Jun 08, 2026"`). Run `stripHtml()` on the excerpt and `.slice(0, 2500)`. Fetch candidates with `Promise.all`.

> **Note:** Each article fetch is wrapped so one failure degrades that article (keep index title/url, empty description) rather than failing the whole feed.

### 4.2b Stage 3 — Sort by recency, take 10

Sort the fetched articles by `dateValue(pubDate)` **descending** (unparseable/empty dates sink) and `.slice(0, MAX_ARTICLES = 10)`. This is what makes "the **last 10** articles" correct regardless of index layout.

### 4.3 Caching & resilience

- First call within TTL populates `cachedArticles` + `cacheTime`; subsequent calls return the cache without re-fetching.
- On index-fetch failure: return `cachedArticles ?? []` (preserves today's "feed unavailable" behavior in `buildArticleContext`).
- `console.error('[scraper] ...')` on failure, matching the current log style.

## 5. Integration points

| File | Change |
|------|--------|
| `src/lib/scraper.ts` | Rewrite §4; rename export to `getClaudeArticles`; keep `Article`, `stripHtml`, `buildArticleContext`. |
| `src/app/api/scrape/route.ts` | `import { getClaudeArticles }`; call it. |
| `src/app/api/chat/route.ts` | Swap import; change KB heading `Anthropic's 10 most recent blog articles` → `the Claude blog's 10 most recent articles`. Keep the verbatim-title citation rule and the `💼 Business Impact` requirement. |
| `src/components/AppShell.tsx` | No change (same `/api/scrape` response). |
| `src/lib/types.ts`, `src/lib/parseAnswer.ts` | No change (type shape preserved). |

**Copy polish (optional, recommended for consistency):**

| File | From → To |
|------|-----------|
| `src/components/sidebar/Brand.tsx` | "Anthropic blog × voice" → "Claude blog × voice" |
| `src/components/main/Topbar.tsx` | "Grounded in Anthropic's latest articles" → "Grounded in Claude's latest articles" |
| `src/components/main/Composer.tsx` | "grounded in Anthropic's RSS feed" → "grounded in the Claude blog" |
| `src/components/ArticleDrawer.tsx` | `TAGS = ['Anthropic', 'AI', 'Analysis']` → `['Claude', 'AI', 'Analysis']` |
| `src/app/layout.tsx` | metadata description: "…from Anthropic…" → "…from the Claude blog…" |

## 6. Dependencies

- **Add `node-html-parser`** — small, fast, no native build step — for stable DOM queries (index cards, JSON-LD/meta lookup). Add to `package.json` `dependencies`.
- **`fast-xml-parser`** is no longer used by this path; leave it or remove it (low priority).

> **Note:** A regex-only extraction is a viable dependency-free fallback (match `href="/blog/..."` anchors, then `application/ld+json` blocks), but it is more brittle. Prefer the parser.

## 7. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| HTML scraping is brittle vs RSS | Prefer JSON-LD / OG meta over positional DOM; DOM selectors as fallback; cache/empty graceful fallback preserves current behavior. |
| Bot blocking / JS-gated content | WebFetch confirmed server-rendered HTML, so a plain `fetch` + realistic `User-Agent` works. Re-verify at build time; if blocked, revisit UA / headers. |
| Relative URLs / inconsistent dates | Absolutize via `new URL(href, origin)`; normalize the human `datePublished` to ISO via `toIsoDate()` so `formatShortDate` renders correctly. |
| ~24 candidate requests per refresh | `MAX_CANDIDATES` cap + `Promise.all` + 1h cache keeps it to one burst per hour. Fetching all candidates is required to sort by date — the index has no trustworthy order. |
| Index markup changes over time | Centralize selectors at the top of `scraper.ts`; cover with fixture-based tests (§8) to catch drift. |

## 8. Testing strategy & gates

New `src/lib/scraper.test.ts` (vitest), mocking global `fetch` with index + article HTML fixtures. Mirror the style of `src/lib/parseAnswer.test.ts`.

- **Parsing / recency:** returns the **10 most recent**, **sorted newest-first** (index fixture rendered oldest-first to prove the sort; oldest of 11 dropped); `url` absolute; `pubDate` ISO (incl. a `"Jun 08, 2026"` → ISO normalization case); `description` non-empty; de-duped by slug.
- **Caching:** second call within TTL does **not** re-invoke `fetch`.
- **Resilience:** index-fetch error → returns cached/empty, no throw; a single article-fetch error degrades only that article.
- **Context:** `buildArticleContext()` over the parsed articles produces the expected markdown blocks.
- **Regression:** existing suite stays green (`KbCard.test.tsx` sample data needs no change).

Gate: `npm test` green before merge.

## 9. Verification checklist (end-to-end)

1. `npm run dev` → `GET /api/scrape` returns 10 articles with `claude.com/blog/...` URLs, ISO dates, non-empty descriptions.
2. Sidebar `KbList` shows 10 Claude-blog cards with "JUN 08"-style dates; clicking a card opens `ArticleDrawer` with the excerpt; `SourceChips` link to `claude.com/blog/<slug>`.
3. Chat: ask a question → answer cites a Claude-blog article title **verbatim** and ends with the `💼 Business Impact` block.
4. `npm test` green, including the new scraper test.

## 10. Out of scope / future

- A second/parallel feed or feed switcher (explicitly deferred).
- Pagination beyond the latest 10.
- Persistent or shared caching (Vercel Runtime Cache / KV) instead of per-process in-memory.
- Image/thumbnail extraction for richer cards.
