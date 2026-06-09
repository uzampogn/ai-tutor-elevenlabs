import { parse, type HTMLElement } from 'node-html-parser';

export interface Article {
  title: string;
  url: string;
  pubDate: string;
  description: string;
}

const CLAUDE_BLOG = 'https://claude.com/blog';
const CLAUDE_ORIGIN = 'https://claude.com';

// --- DOM selectors (centralized so they're easy to update if claude.com drifts) ---
const SEL_ARTICLE_LINK = 'a[href^="/blog/"]'; // index article cards
const SEL_JSON_LD = 'script[type="application/ld+json"]'; // per-article structured data
const SEL_OG_DESCRIPTION = 'meta[property="og:description"]';
const SEL_META_DESCRIPTION = 'meta[name="description"]';
const SEL_ARTICLE_PUBLISHED = 'meta[property="article:published_time"]';
const SEL_BODY_PARAGRAPH = 'main p, article p, p'; // fallback excerpt source

const MAX_ARTICLES = 10;
const MAX_CANDIDATES = 40; // upper bound on index links we fetch before sorting by date
const DESCRIPTION_CAP = 2500;
const FETCH_HEADERS = { 'User-Agent': 'AI-Tutor-Bot/1.0' } as const;

let cachedArticles: Article[] | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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

/** Extract the `/blog/<slug>` slug from an href, or null if it's not a real article link. */
function slugFromHref(href: string): string | null {
  const match = href.match(/^\/blog\/([^/?#]+)/);
  return match ? match[1] : null;
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

/**
 * Stage 1: parse the blog index into de-duplicated candidate cards (document order).
 * The index mixes a featured grid with the chronological list, so the first cards are
 * NOT reliably the most recent — we collect all candidates and let the caller sort by
 * each article's authoritative `datePublished`.
 */
function parseIndex(html: string): IndexCard[] {
  const root = parse(html);
  const anchors = root.querySelectorAll(SEL_ARTICLE_LINK);
  const seen = new Set<string>();
  const cards: IndexCard[] = [];

  for (const a of anchors) {
    const href = a.getAttribute('href');
    if (!href) continue;
    const slug = slugFromHref(href);
    if (!slug || seen.has(slug)) continue;

    const title = stripHtml(a.text ?? '');
    if (!title) continue; // skip non-content links (icons, "read more" w/o text, etc.)

    // Any visible date on/near the card as a provisional pubDate.
    const provisionalDate = findCardDate(a);

    seen.add(slug);
    cards.push({
      title,
      url: new URL(href, CLAUDE_ORIGIN).toString(),
      slug,
      pubDate: provisionalDate,
    });

    if (cards.length >= MAX_CANDIDATES) break;
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

interface BodyData {
  description: string;
  pubDate: string;
}

/** Stage 2: extract description + ISO pubDate from a fetched article page. */
function parseArticleBody(html: string): BodyData {
  const root = parse(html);
  let description = '';
  let pubDate = '';

  // (a) JSON-LD Article — most stable.
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
    if (!description) {
      const desc = articleObj.description ?? articleObj.articleBody;
      if (typeof desc === 'string') description = desc;
    }
    if (pubDate && description) break;
  }

  // (b) Open Graph / meta.
  if (!description) {
    const og =
      root.querySelector(SEL_OG_DESCRIPTION)?.getAttribute('content') ??
      root.querySelector(SEL_META_DESCRIPTION)?.getAttribute('content');
    if (og) description = og;
  }
  if (!pubDate) {
    const published = root
      .querySelector(SEL_ARTICLE_PUBLISHED)
      ?.getAttribute('content');
    if (published) pubDate = published;
  }

  // (c) Fallback: first non-trivial paragraph of the main content.
  if (!description) {
    for (const p of root.querySelectorAll(SEL_BODY_PARAGRAPH)) {
      const text = stripHtml(p.text ?? '');
      if (text.length > 40) {
        description = text;
        break;
      }
    }
  }

  return {
    description: stripHtml(description).slice(0, DESCRIPTION_CAP),
    pubDate,
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
    const body = parseArticleBody(html);
    return {
      title: card.title,
      url: card.url,
      pubDate: toIsoDate(body.pubDate || card.pubDate),
      description: body.description,
    };
  } catch (err) {
    // Degrade only this article — keep its index title/url, leave description empty.
    console.error(`[scraper] Failed to fetch article body for ${card.url}:`, err);
    return {
      title: card.title,
      url: card.url,
      pubDate: toIsoDate(card.pubDate),
      description: '',
    };
  }
}

export async function getClaudeArticles(): Promise<Article[]> {
  if (cachedArticles && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cachedArticles;
  }

  try {
    const res = await fetch(CLAUDE_BLOG, {
      headers: FETCH_HEADERS,
      next: { revalidate: 3600 },
    });

    if (!res.ok) throw new Error(`Blog index fetch failed: HTTP ${res.status}`);

    const html = await res.text();
    const cards = parseIndex(html);

    // The index isn't reliably newest-first (featured grid + chronological list), so
    // fetch every candidate's authoritative datePublished, then sort and take the latest 10.
    const fetched = await Promise.all(cards.map(fetchArticleBody));
    const articles = fetched
      .sort((a, b) => dateValue(b.pubDate) - dateValue(a.pubDate))
      .slice(0, MAX_ARTICLES);

    cachedArticles = articles;
    cacheTime = Date.now();
    return cachedArticles;
  } catch (err) {
    console.error('[scraper] Failed to fetch Claude blog:', err);
    return cachedArticles ?? [];
  }
}

export function buildArticleContext(articles: Article[]): string {
  if (articles.length === 0) {
    return 'No articles currently available. The Claude blog may be temporarily unavailable.';
  }
  return articles
    .map(
      (a, i) =>
        `## [Article ${i + 1}] ${a.title}\nPublished: ${a.pubDate}\nURL: ${a.url}\n\n${a.description}`
    )
    .join('\n\n---\n\n');
}
