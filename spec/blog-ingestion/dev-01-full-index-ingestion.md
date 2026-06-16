# Dev Spec 01 — Full-Index Ingestion (all articles · full body · junk filtering)

> Implements PRD `./blog-ingestion-full-index.md` → **P0-1, P0-2, P0-6**.
> Depends on: nothing (first to land). Unblocks: Dev Spec 02 (needs `Article.body`).
> Touch surface: `src/lib/scraper.ts`, `src/lib/scraper.test.ts`. No route/UI behavior change.

## Objective

Make `getClaudeArticles()` return **every valid article** the blog index exposes in one fetch (no top-10 cap, no date filter), with each article carrying its **full body text**, and with **junk links filtered out** (generic "Read more" anchors, `/blog/category|tag/*` listing links). `buildArticleContext` stays on the short `description` for now (Dev Spec 02 moves it to summaries) so this ships without a token blowup.

## Current behavior (baseline to change)

`src/lib/scraper.ts` today: parses up to `MAX_CANDIDATES = 40` index cards, fetches each body, sorts newest-first, then `.slice(0, MAX_ARTICLES /* 10 */)`. `Article` = `{ title, url, pubDate, description }` where `description` is capped at `DESCRIPTION_CAP = 2500`. Observed prod defects: an article titled **"Read more"** and `/blog/category/*` links treated as posts.

## Changes

### 1. Data model — add `body`

```ts
export interface Article {
  title: string;
  url: string;
  pubDate: string;     // ISO 8601, or '' if unparseable
  description: string; // short excerpt for the sidebar/drawer (<= EXCERPT_CAP)
  body: string;        // NEW: full article text (<= BODY_CAP), '' if unavailable
}
```
- `description` becomes a short excerpt (derived from body or og:description), **not** the 2,500-char blob.
- Constants: replace `DESCRIPTION_CAP = 2500` with `EXCERPT_CAP = 320` (description) and `BODY_CAP = 60_000` (safety bound on body). Document both.

### 2. P0-6 — junk filtering in `parseIndex` / `slugFromHref`

- **Reserved listing paths.** Add `const RESERVED_BLOG_SEGMENTS = new Set(['category','categories','tag','tags','author','authors','topic','topics','page']);`. In `slugFromHref`, return `null` when the first path segment is reserved (so `/blog/category/announcements` → not an article). Already returns the first segment via `^/blog/([^/?#]+)` — just reject reserved values.
- **Generic anchor text.** Add `const GENERIC_LINK_TEXT = new Set(['read more','read article','read post','learn more','continue reading','read']);`. Treat an anchor whose normalized (`stripHtml(...).toLowerCase()`) text is generic as a *body link*, not a title source.
- **Best-title dedupe.** Replace the "first-seen wins" dedupe with a `Map<slug, IndexCard>`:
  - For each anchor → `{ slug, title, url, pubDate }` where `title` may be empty/generic.
  - If slug unseen → insert. If seen → **upgrade** the stored card when the existing title is empty/generic and the new one is real. Merge in a `pubDate` if the stored one is empty.
  - If, after the full pass, a card's title is still empty/generic, try the nearest ancestor heading (`h1,h2,h3` within up to 3 parent levels — extend `findCardDate`'s walk pattern); if still none, **drop** the card (it is a dup of a real card or a non-post link).
- Keep the `MAX_CANDIDATES` guard but raise to `100` and rename intent in a comment to "safety bound, not a result cap".

### 3. P0-2 — full body extraction in `parseArticleBody`

Return `{ body, description, pubDate }` (add `body`). Precedence for **body**:
1. JSON-LD `articleBody` (string) when present — the most complete source.
2. Else concatenate text of `main p, article p` (reuse `SEL_BODY_PARAGRAPH`) joined by `\n\n`, skipping paragraphs < 2 chars.
3. Normalize whitespace via `stripHtml`, then cap at `BODY_CAP`.

**description** (excerpt) precedence, unchanged in spirit but shortened:
1. JSON-LD `description` → 2. `og:description` / meta description → 3. first `BODY` sentence(s).
Cap at `EXCERPT_CAP`.

`fetchArticleBody` returns the new `Article` shape (`body` included; on fetch failure, `body: ''`, `description: ''`, keep index `title`/`url`).

### 4. P0-1 — ingest all, no cap, no date filter (`getClaudeArticles`)

- Fetch every candidate body (already does), sort newest-first by `dateValue(pubDate)` (already does), then **return all** — delete `.slice(0, MAX_ARTICLES)` and the `MAX_ARTICLES` constant.
- Dateless real articles: `dateValue` returns `-Infinity` → they naturally sort last and are **kept** (do not filter them out).
- Cache (`CACHE_TTL_MS = 1h`) and the error fallback are untouched here (Dev Spec 03 owns refresh/observability).

### 5. `buildArticleContext` — unchanged here

Still renders `description`. (Dev Spec 02 switches it to `summary` and adds the budget guard.) This keeps Spec-01 context small (~24 × ≤320 chars).

## Edge cases

- Index with a `Read more` anchor pointing to slug X **and** a real titled anchor for X → one card, real title. (Regression.)
- `/blog/category/announcements` in the index → excluded entirely. (Regression.)
- Article page with no JSON-LD → body via DOM paragraphs; still non-empty when content exists.
- Article with unparseable/missing date → included, sorted last, `pubDate: ''`.
- Pathological huge body → truncated at `BODY_CAP`, no crash.

## Testing strategy

**Stack/pattern:** Vitest, fixture `global.fetch` stub + `vi.resetModules()` (existing `scraper.test.ts` patterns). No network.

**Rewrite existing assertions (gaps this spec creates):**
- `scraper.test.ts:117` "returns the 10 most recent (drops oldest of 11)" → **"returns all valid articles, newest-first"** (assert length == number of valid candidates; oldest is **present**, not dropped).
- Cache-hit test `expect(callsAfterFirst).toBe(12)` → recompute as `1 index + N candidate bodies`; assert it equals `1 + validCandidateCount` rather than a hard-coded number.
- `buildArticleContext` "exactly 10 blocks" → `blocks.length === articles.length`.

**New unit tests:**

| Area | Case |
|------|------|
| P0-1 all | index with 12 valid cards → 12 returned (not 10) |
| P0-1 dateless | a card whose article has no `datePublished` → included, sorted last, `pubDate === ''` |
| P0-2 full body | `articleBody` of >2,500 chars survives intact in `body` (not truncated to excerpt); `description.length <= EXCERPT_CAP` |
| P0-2 DOM fallback | article with no JSON-LD → `body` built from `<p>` text, non-empty |
| P0-2 cap | `articleBody` of 200k chars → `body.length <= BODY_CAP` |
| P0-6 generic text | anchor text "Read more" for slug X (+ real anchor for X) → 1 card titled with the real title; **no** article titled "Read more" |
| P0-6 reserved path | `/blog/category/x` and `/blog/tag/y` anchors → excluded from results |
| P0-6 dedupe | same slug via two anchors → one card, non-generic title wins |

**Fixtures to extend** in `scraper.test.ts`: add a `Read more` anchor, a `/blog/category/announcements` link, a dateless article page, and a long-`articleBody` page to the existing fixture set.

## Definition of Done

| Check | Command |
|-------|---------|
| All Vitest suites green (incl. rewritten scraper tests) | `npm run test:run` |
| Types clean (`Article.body`) | `npm run typecheck` |
| Build succeeds | `npm run build` |
| Live spot-check: `/api/scrape` returns ~24 items, none titled "Read more" or a category name | manual `curl` |
