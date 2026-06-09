import { XMLParser } from 'fast-xml-parser';

export interface Article {
  title: string;
  url: string;
  pubDate: string;
  description: string;
}

const ANTHROPIC_RSS = 'https://www.anthropic.com/rss.xml';

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

export async function getAnthropicArticles(): Promise<Article[]> {
  if (cachedArticles && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cachedArticles;
  }

  try {
    const res = await fetch(ANTHROPIC_RSS, {
      headers: { 'User-Agent': 'AI-Tutor-Bot/1.0' },
      next: { revalidate: 3600 },
    });

    if (!res.ok) throw new Error(`RSS fetch failed: HTTP ${res.status}`);

    const xml = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const data = parser.parse(xml);

    const rawItems = data?.rss?.channel?.item ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    cachedArticles = items.slice(0, 10).map((item: Record<string, unknown>) => ({
      title: stripHtml(String(item.title ?? '')),
      url: String(item.link ?? ''),
      pubDate: String(item.pubDate ?? ''),
      description: stripHtml(
        String(item['content:encoded'] ?? item.description ?? '')
      ).slice(0, 2500),
    }));

    cacheTime = Date.now();
    return cachedArticles;
  } catch (err) {
    console.error('[scraper] Failed to fetch Anthropic RSS:', err);
    return cachedArticles ?? [];
  }
}

export function buildArticleContext(articles: Article[]): string {
  if (articles.length === 0) {
    return 'No articles currently available. The RSS feed may be temporarily unavailable.';
  }
  return articles
    .map(
      (a, i) =>
        `## [Article ${i + 1}] ${a.title}\nPublished: ${a.pubDate}\nURL: ${a.url}\n\n${a.description}`
    )
    .join('\n\n---\n\n');
}
