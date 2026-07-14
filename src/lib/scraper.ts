import { parse, type HTMLElement } from 'node-html-parser';
import { summarizeAll } from './summarize';
import { unstable_cache } from 'next/cache';
import * as db from './db';
import { embedStaleArticles } from './embedArticles';

export interface Article {
  title: string;
  url: string;
  pubDate: string; // ISO 8601, or '' if unparseable
  description: string; // short excerpt for the sidebar/drawer (<= EXCERPT_CAP)
  body: string; // full article text (<= BODY_CAP), '' if unavailable
  summary: string; // compact grounding text for chat context (<= SUMMARY_CHAR_CAP)
  heroImage: string; // og:image URL for the drawer hero, '' if absent/unresolvable
}

// Hard ceiling for the assembled chat grounding context (P0-5). ~24 summaries
// of <=700 chars plus block headers fit comfortably under 20k chars (~5k tokens);
// the budget stays flat as the article count grows because blocks are summaries.
const CONTEXT_CHAR_CEILING = 20_000;
const CONTEXT_SEPARATOR = '\n\n---\n\n';

const CLAUDE_BLOG = 'https://claude.com/blog';
const CLAUDE_ORIGIN = 'https://claude.com';

// --- DOM selectors (centralized so they're easy to update if claude.com drifts) ---
const SEL_ARTICLE_LINK = 'a[href^="/blog/"]'; // index article cards
const SEL_JSON_LD = 'script[type="application/ld+json"]'; // per-article structured data
const SEL_OG_DESCRIPTION = 'meta[property="og:description"]';
const SEL_OG_IMAGE = 'meta[property="og:image"]';
const SEL_META_DESCRIPTION = 'meta[name="description"]';
const SEL_ARTICLE_PUBLISHED = 'meta[property="article:published_time"]';
const SEL_BODY_PARAGRAPH = 'main p, article p, p'; // body / fallback excerpt source

// Safety bound on index links we parse before resolving — NOT a result cap. We
// ingest every valid candidate the index exposes; this only guards against a
// pathological page exposing thousands of anchors.
const MAX_CANDIDATES = 100;
// Short excerpt shown on the sidebar card / drawer (derived from body or og:description).
const EXCERPT_CAP = 320;
// Generous safety bound on a single article body. Real Claude posts are far
// smaller; this only truncates pathological pages so they can't blow up memory
// or the summarizer input. ~60k chars ≈ ~15k tokens, plenty for full posts.
const BODY_CAP = 60_000;
const FETCH_HEADERS = { 'User-Agent': 'AI-Tutor-Bot/1.0' } as const;

// First path segment values that are listing/taxonomy pages, never real posts.
const RESERVED_BLOG_SEGMENTS = new Set([
  'category',
  'categories',
  'tag',
  'tags',
  'author',
  'authors',
  'topic',
  'topics',
  'page',
]);

// Generic anchor text that is a "read the post" link, not a usable title.
const GENERIC_LINK_TEXT = new Set([
  'read more',
  'read article',
  'read post',
  'learn more',
  'continue reading',
  'read',
]);

// --- Read-through cache + freshness snapshot (DB is the source of truth) ---
const READ_CACHE_TTL_MS = 60 * 1000; // short in-mem cache over Postgres reads
// Age beyond which a read self-heals. Derived signal only — never gates serving
// (we still return last-good DB rows). Tuned to the daily cron — Vercel Hobby caps
// cron jobs at once/day — so 26h = one missed daily run plus buffer; steady-state
// reads hit the DB and the scrape+summarize path stays off the request path.
const STALE_THRESHOLD_MS = 26 * 60 * 60 * 1000;

let readCache: Article[] | null = null;
let readCacheTime = 0;
let inflight: Promise<Article[]> | null = null;

// Synchronous status snapshot, refreshed from kb_meta on every getClaudeArticles call.
let snapCount = 0;
let snapLastSuccess = 0; // epoch ms, 0 = never
let snapError: string | null = null;

export interface IngestionStatus {
  count: number;
  lastSuccessfulFetch: string | null; // ISO, or null if never succeeded
  ageMs: number | null; // now - lastSuccessfulFetch, or null if never succeeded
  stale: boolean; // ageMs > STALE_THRESHOLD_MS (true before the first success)
  lastError: string | null;
}

/**
 * Snapshot of ingestion freshness for observability (exposed via /api/scrape).
 * Synchronous: reads a module snapshot refreshed from kb_meta on each
 * getClaudeArticles call, so the route contract stays unchanged.
 */
export function getIngestionStatus(): IngestionStatus {
  const ageMs = snapLastSuccess ? Date.now() - snapLastSuccess : null;
  return {
    count: snapCount,
    lastSuccessfulFetch: snapLastSuccess ? new Date(snapLastSuccess).toISOString() : null,
    ageMs,
    stale: ageMs === null || ageMs > STALE_THRESHOLD_MS,
    lastError: snapError,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when an anchor/heading text is a real title (non-empty, not a generic link label). */
function isUsableTitle(title: string): boolean {
  const t = title.trim().toLowerCase();
  return t.length > 0 && !GENERIC_LINK_TEXT.has(t);
}

/** Extract the `/blog/<slug>` slug from an href, or null if it's not a real article link. */
function slugFromHref(href: string): string | null {
  const match = href.match(/^\/blog\/([^/?#]+)/);
  if (!match) return null;
  const slug = match[1];
  // Reject listing/taxonomy paths (/blog/category/*, /blog/tag/*, ...).
  if (RESERVED_BLOG_SEGMENTS.has(slug.toLowerCase())) return null;
  return slug;
}

/** Normalize a date string (e.g. "Jun 08, 2026") to ISO 8601; pass through if unparseable. */
function toIsoDate(value: string): string {
  if (!value) return '';
  const t = Date.parse(value);
  return Number.isNaN(t) ? value : new Date(t).toISOString();
}

/** Numeric sort key for a date string; unparseable/empty dates sink to the bottom. */
function dateValue(value: string): number {
  const t = Date.parse(value);
  return Number.isNaN(t) ? -Infinity : t;
}

interface IndexCard {
  title: string;
  url: string;
  slug: string;
  pubDate: string;
}

interface IndexCardDraft extends IndexCard {
  anchor: HTMLElement; // kept so we can fall back to a card heading for the title
}

/**
 * Stage 1: parse the blog index into de-duplicated candidate cards (document order).
 * The index mixes a featured grid with the chronological list, so the first cards are
 * NOT reliably the most recent — we collect all candidates and let the caller sort by
 * each article's authoritative `datePublished`.
 *
 * Junk filtering (P0-6): listing/taxonomy links are rejected by `slugFromHref`; generic
 * anchor text ("Read more", "Learn more") is treated as a body link, not a title source;
 * multiple anchors to the same slug dedupe to one card keeping the richest (non-generic)
 * title, falling back to a nearby heading and dropping the card if no real title exists.
 */
function parseIndex(html: string): IndexCard[] {
  const root = parse(html);
  const anchors = root.querySelectorAll(SEL_ARTICLE_LINK);
  const drafts = new Map<string, IndexCardDraft>();

  for (const a of anchors) {
    const href = a.getAttribute('href');
    if (!href) continue;
    const slug = slugFromHref(href);
    if (!slug) continue;

    // Skip new slugs once we hit the safety bound, but keep upgrading known ones.
    if (!drafts.has(slug) && drafts.size >= MAX_CANDIDATES) continue;

    const title = stripHtml(a.text ?? '');
    const provisionalDate = findCardDate(a);
    const existing = drafts.get(slug);

    if (!existing) {
      drafts.set(slug, {
        title,
        url: new URL(href, CLAUDE_ORIGIN).toString(),
        slug,
        pubDate: provisionalDate,
        anchor: a,
      });
      continue;
    }

    // Upgrade a placeholder/generic title with a real one; backfill a missing date.
    if (!isUsableTitle(existing.title) && isUsableTitle(title)) {
      existing.title = title;
    }
    if (!existing.pubDate && provisionalDate) {
      existing.pubDate = provisionalDate;
    }
  }

  const cards: IndexCard[] = [];
  for (const draft of Array.from(drafts.values())) {
    let title = draft.title;
    if (!isUsableTitle(title)) {
      // Last resort: a nearby card heading. If there's still no real title, the
      // card is a dup of a real one or a non-post link — drop it.
      title = findCardHeading(draft.anchor);
      if (!isUsableTitle(title)) continue;
    }
    cards.push({ title, url: draft.url, slug: draft.slug, pubDate: draft.pubDate });
  }

  return cards;
}

/** Look for a human-readable date inside the anchor or its nearest ancestor card. */
function findCardDate(anchor: HTMLElement): string {
  const dateRe = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/;

  // <time datetime> is the most reliable signal if present.
  const time = anchor.querySelector('time');
  if (time) {
    const dt = time.getAttribute('datetime');
    if (dt) return dt;
    const t = stripHtml(time.text ?? '');
    if (t) return t;
  }

  const inAnchor = anchor.text?.match(dateRe);
  if (inAnchor) return inAnchor[0];

  // Walk up a couple of levels to catch a sibling date on the card.
  let node: HTMLElement | null = anchor.parentNode;
  for (let i = 0; i < 3 && node; i++) {
    const t = node.querySelector?.('time');
    if (t) {
      const dt = t.getAttribute('datetime');
      if (dt) return dt;
    }
    const m = node.text?.match(dateRe);
    if (m) return m[0];
    node = node.parentNode;
  }

  return '';
}

/** Find the nearest ancestor card heading for an anchor whose own text is generic/empty. */
function findCardHeading(anchor: HTMLElement): string {
  let node: HTMLElement | null = anchor.parentNode;
  for (let i = 0; i < 3 && node; i++) {
    const h = node.querySelector?.('h1, h2, h3');
    if (h) {
      const t = stripHtml(h.text ?? '');
      if (isUsableTitle(t)) return t;
    }
    node = node.parentNode;
  }
  return '';
}

/** Coerce a JSON-LD payload into the list of objects it may contain (array, @graph, single). */
function flattenJsonLd(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    return parsed.flatMap(flattenJsonLd);
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj['@graph'])) {
      return (obj['@graph'] as unknown[]).flatMap(flattenJsonLd);
    }
    return [obj];
  }
  return [];
}

function typeMatchesArticle(type: unknown): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some(
    (t) => typeof t === 'string' && /article|blogposting|newsarticle/i.test(t)
  );
}

/** Trim `text` to at most `cap` chars, backing off to a sentence or word boundary. */
function excerptFrom(text: string, cap: number): string {
  const clean = text.trim();
  if (clean.length <= cap) return clean;
  const slice = clean.slice(0, cap);
  const lastSentence = slice.lastIndexOf('. ');
  if (lastSentence > cap * 0.5) return slice.slice(0, lastSentence + 1).trim();
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim();
}

interface BodyData {
  body: string;
  description: string;
  pubDate: string;
  heroImage: string;
}

/** Stage 2: extract full body + short description + ISO pubDate from a fetched article page. */
function parseArticleBody(html: string): BodyData {
  const root = parse(html);
  let description = '';
  let pubDate = '';
  let articleBody = '';

  // (a) JSON-LD Article — most stable source for body, description, and date.
  for (const script of root.querySelectorAll(SEL_JSON_LD)) {
    const raw = script.text?.trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // malformed JSON-LD block — try the next one.
    }
    const objects = flattenJsonLd(parsed);
    const articleObj =
      objects.find((o) => typeMatchesArticle(o['@type'])) ?? objects[0];
    if (!articleObj) continue;

    if (!pubDate && typeof articleObj.datePublished === 'string') {
      pubDate = articleObj.datePublished;
    }
    if (!articleBody && typeof articleObj.articleBody === 'string') {
      articleBody = articleObj.articleBody;
    }
    if (!description && typeof articleObj.description === 'string') {
      description = articleObj.description;
    }
    if (pubDate && articleBody && description) break;
  }

  // Body precedence: JSON-LD articleBody → concatenated main/article paragraphs.
  let body = '';
  if (articleBody) {
    body = stripHtml(articleBody);
  } else {
    const paragraphs: string[] = [];
    for (const p of root.querySelectorAll(SEL_BODY_PARAGRAPH)) {
      const text = stripHtml(p.text ?? '');
      if (text.length >= 2) paragraphs.push(text);
    }
    body = paragraphs.join('\n\n');
  }
  body = body.slice(0, BODY_CAP);

  // Description (short excerpt): JSON-LD description → og/meta → first body sentence(s).
  if (!description) {
    const og =
      root.querySelector(SEL_OG_DESCRIPTION)?.getAttribute('content') ??
      root.querySelector(SEL_META_DESCRIPTION)?.getAttribute('content');
    if (og) description = og;
  }
  if (!description && body) {
    description = body;
  }
  if (!pubDate) {
    const published = root
      .querySelector(SEL_ARTICLE_PUBLISHED)
      ?.getAttribute('content');
    if (published) pubDate = published;
  }

  // Hero image: og:image, resolved to an absolute URL. Missing/malformed → ''
  // (the drawer falls back to a tinted gradient).
  let heroImage = '';
  const ogImage = root.querySelector(SEL_OG_IMAGE)?.getAttribute('content');
  if (ogImage) {
    try {
      heroImage = new URL(ogImage, CLAUDE_ORIGIN).toString();
    } catch {
      heroImage = '';
    }
  }

  return {
    body,
    description: excerptFrom(stripHtml(description), EXCERPT_CAP),
    pubDate,
    heroImage,
  };
}

async function fetchArticleBody(card: IndexCard): Promise<Article> {
  try {
    const res = await fetch(card.url, {
      headers: FETCH_HEADERS,
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const parsed = parseArticleBody(html);
    return {
      title: card.title,
      url: card.url,
      pubDate: toIsoDate(parsed.pubDate || card.pubDate),
      description: parsed.description,
      body: parsed.body,
      summary: '', // filled by summarizeAll after sorting (see getClaudeArticles)
      heroImage: parsed.heroImage,
    };
  } catch (err) {
    // Degrade only this article — keep its index title/url, leave body/description empty.
    console.error(`[scraper] Failed to fetch article body for ${card.url}:`, err);
    return {
      title: card.title,
      url: card.url,
      pubDate: toIsoDate(card.pubDate),
      description: '',
      body: '',
      summary: '',
      heroImage: '',
    };
  }
}

/**
 * DB-first read with a live self-heal fallback. Steady state (daily cron keeps
 * Postgres fresh) returns precomputed rows with no scrape/summarize on the request
 * path. `force` (the cron) and an empty/stale table drive an inline scrape that
 * summarizes only new/changed articles and writes the result back.
 */
export async function getClaudeArticles(
  opts: { force?: boolean } = {}
): Promise<Article[]> {
  if (!opts.force) {
    if (readCache && Date.now() - readCacheTime < READ_CACHE_TTL_MS) return readCache;
    const [rows, meta] = await Promise.all([db.getArticles(), db.readMeta()]);
    snapCount = rows.length;
    snapLastSuccess = meta.lastSuccessfulFetch ?? 0;
    snapError = meta.lastError;
    const fresh =
      meta.lastSuccessfulFetch != null &&
      Date.now() - meta.lastSuccessfulFetch <= STALE_THRESHOLD_MS;
    if (rows.length > 0 && fresh) {
      readCache = rows;
      readCacheTime = Date.now();
      return rows;
    }
    // empty or stale → fall through to a self-heal scrape
  }
  // Per-instance single-flight: concurrent cold reads collapse to one scrape.
  if (!inflight) {
    inflight = scrapeAndPersist().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Scrape + summarize misses + persist. On failure, serve last-good DB rows. */
async function scrapeAndPersist(): Promise<Article[]> {
  try {
    const res = await fetch(CLAUDE_BLOG, {
      headers: FETCH_HEADERS,
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`Blog index fetch failed: HTTP ${res.status}`);
    const html = await res.text();
    const cards = parseIndex(html);

    // The index isn't reliably newest-first (featured grid + chronological list), so
    // fetch every candidate's authoritative datePublished, then sort newest-first and
    // keep ALL of them — no count cap, no date filter. Dateless real articles have a
    // -Infinity sort key, so they sink to the bottom but are still included.
    const fetched = await Promise.all(cards.map(fetchArticleBody));
    const articles = fetched.sort(
      (a, b) => dateValue(b.pubDate) - dateValue(a.pubDate)
    );

    // Summarize misses only — the durable known-summaries map skips unchanged
    // content (0 API calls). Failures degrade to a body excerpt (hash === '')
    // so the next run retries them; articles are never dropped.
    const known = await db.getKnownSummaries();
    const results = await summarizeAll(articles, known);
    articles.forEach((a, i) => {
      a.summary = results[i].summary;
    });

    const rows = articles.map((a, i) => ({ ...a, hash: results[i].hash }));
    await db.upsertArticles(rows);
    // Embed new/changed articles for RAG retrieval. Internally guarded: no-ops
    // without VOYAGE_API_KEY and swallows all errors — never blocks ingest.
    await embedStaleArticles(rows);
    // Guard: only prune when the scrape returned articles, so a garbage/empty
    // scrape can never wipe the table.
    if (rows.length > 0) await db.deleteMissing(rows.map((r) => db.slugFromUrl(r.url)));
    const now = Date.now();
    await db.writeMeta({ lastSuccessfulFetch: now, lastError: null });

    snapCount = articles.length;
    snapLastSuccess = now;
    snapError = null;
    readCache = articles;
    readCacheTime = now;
    return articles;
  } catch (err) {
    // Failure: serve last-good DB rows and record the error, but DO NOT advance the
    // freshness clock — so staleness reflects reality and the next call retries.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[scraper] scrape failed; serving last-good DB rows:', err);
    const meta = await db.readMeta();
    await db.writeMeta({ lastError: msg });
    const rows = await db.getArticles();
    snapCount = rows.length;
    snapLastSuccess = meta.lastSuccessfulFetch ?? 0;
    snapError = msg;
    readCache = rows;
    readCacheTime = Date.now();
    return rows;
  }
}

export function buildArticleContext(articles: Article[]): string {
  if (articles.length === 0) {
    return 'No articles currently available. The Claude blog may be temporarily unavailable.';
  }

  // Build grounding from SUMMARIES (P0-5), not full bodies, and enforce a hard
  // char ceiling so the system prompt stays bounded regardless of article count.
  // Articles are newest-first, so the freshest posts are always included.
  const blocks: string[] = [];
  let total = 0;
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    const grounding = a.summary || a.description; // fall back if a summary is empty
    const block = `## [Article ${i + 1}] ${a.title}\nPublished: ${a.pubDate}\nURL: ${a.url}\n\n${grounding}`;
    const added = block.length + (blocks.length > 0 ? CONTEXT_SEPARATOR.length : 0);
    if (blocks.length > 0 && total + added > CONTEXT_CHAR_CEILING) break;
    blocks.push(block);
    total += added;
  }
  return blocks.join(CONTEXT_SEPARATOR);
}

// --- Cross-instance grounding cache (chat hot-path; see spec/chat-latency) ---
// /api/chat must never scrape or summarize on the request path. The module-level
// caches above are per-instance and empty on cold starts, so the assembled context
// is wrapped in Vercel's Data Cache (shared across function instances). Even a cold
// /api/chat instance then gets a cache hit instead of re-summarizing every article.

/** Cache tag for the assembled grounding context; the cron invalidates it via revalidateTag. */
export const GROUNDING_TAG = 'grounding';

// Daily time-based backstop. The /api/scrape/refresh cron is the primary refresh
// (it calls revalidateTag(GROUNDING_TAG)); this only bounds staleness if the cron is
// missed. Stale-while-revalidate means a read never blocks on the recompute.
const GROUNDING_REVALIDATE_SECONDS = 60 * 60 * 24;

/** Uncached assembly: scrape (cached fetches) + summaries + context build. Exported for testing. */
export async function buildGroundingContext(): Promise<string> {
  const articles = await getClaudeArticles();
  return buildArticleContext(articles);
}

/**
 * Cross-instance grounding context for the chat route. Backed by Vercel's Data Cache,
 * so every instance — including cold /api/chat starts — reads the assembled context
 * without re-scraping or re-summarizing. Refreshed daily (backstop) and on demand by
 * the cron via revalidateTag(GROUNDING_TAG).
 */
export const getGroundingContext = unstable_cache(
  buildGroundingContext,
  ['grounding-context'],
  { revalidate: GROUNDING_REVALIDATE_SECONDS, tags: [GROUNDING_TAG] },
);
