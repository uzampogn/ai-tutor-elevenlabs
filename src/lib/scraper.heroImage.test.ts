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
