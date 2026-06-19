import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Anthropic SDK (no live calls) and the DB layer (control source of truth).
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn(() => ({ messages: { create: createMock } })) }));

const db = vi.hoisted(() => ({
  getArticles: vi.fn(), getKnownSummaries: vi.fn(), upsertArticles: vi.fn(),
  deleteMissing: vi.fn(), readMeta: vi.fn(), writeMeta: vi.fn(),
  slugFromUrl: (u: string) => (u.match(/\/blog\/([^/?#]+)/)?.[1] ?? u),
}));
vi.mock('@/lib/db', () => db);

const ORIGIN = 'https://claude.com';
const articleRow = (slug: string) => ({
  title: `T ${slug}`, url: `${ORIGIN}/blog/${slug}`, pubDate: '2026-06-10T09:00:00.000Z',
  description: 'd', body: 'b', summary: 's', heroImage: '',
});

function htmlResponse(body: string, ok = true, status = 200): Response {
  return { ok, status, text: () => Promise.resolve(body) } as unknown as Response;
}
function indexHtml() {
  return `<!doctype html><html><body><main>
    <article><a href="/blog/post-a">Post A</a><time datetime="2026-06-10T09:00:00.000Z">x</time></article>
  </main></body></html>`;
}
function articleHtml() {
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'BlogPosting', headline: 'Post A', datePublished: '2026-06-10T09:00:00.000Z', description: 'JSON-LD desc.' }] };
  return `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head>
    <body><main><p>Body paragraph.</p></main></body></html>`;
}
function makeFetchMock() {
  return vi.fn((input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === `${ORIGIN}/blog`) return Promise.resolve(htmlResponse(indexHtml()));
    return Promise.resolve(htmlResponse(articleHtml()));
  });
}
async function freshScraper() { vi.resetModules(); return import('./scraper'); }

beforeEach(() => {
  vi.restoreAllMocks();
  createMock.mockReset().mockResolvedValue({ content: [{ type: 'text', text: 'Canned.' }] });
  db.getArticles.mockReset().mockResolvedValue([]);
  db.getKnownSummaries.mockReset().mockResolvedValue(new Map());
  db.upsertArticles.mockReset().mockResolvedValue(undefined);
  db.deleteMissing.mockReset().mockResolvedValue(undefined);
  db.readMeta.mockReset().mockResolvedValue({ lastSuccessfulFetch: null, lastError: null });
  db.writeMeta.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('getClaudeArticles — DB-first', () => {
  it('serves fresh DB rows without scraping or summarizing', async () => {
    db.getArticles.mockResolvedValue([articleRow('post-a')]);
    db.readMeta.mockResolvedValue({ lastSuccessfulFetch: Date.now(), lastError: null });
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles } = await freshScraper();
    const out = await getClaudeArticles();
    expect(out).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('self-heals on an empty DB: scrapes, summarizes, persists, returns rows', async () => {
    db.getArticles.mockResolvedValue([]); // empty → self-heal
    vi.stubGlobal('fetch', makeFetchMock());
    const { getClaudeArticles } = await freshScraper();
    const out = await getClaudeArticles();
    expect(out.length).toBeGreaterThan(0);
    expect(createMock).toHaveBeenCalled();
    expect(db.upsertArticles).toHaveBeenCalled();
    expect(db.writeMeta).toHaveBeenCalledWith(expect.objectContaining({ lastError: null }));
  });

  it('self-heals when the DB is stale (older than the threshold)', async () => {
    db.getArticles.mockResolvedValue([articleRow('post-a')]);
    db.readMeta.mockResolvedValue({ lastSuccessfulFetch: Date.now() - 4 * 60 * 60 * 1000, lastError: null });
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles } = await freshScraper();
    await getClaudeArticles();
    expect(fetchMock).toHaveBeenCalled(); // 4h > 3h threshold → scraped
  });

  it('collapses two concurrent cold reads into a single scrape (single-flight)', async () => {
    db.getArticles.mockResolvedValue([]);
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles } = await freshScraper();
    await Promise.all([getClaudeArticles(), getClaudeArticles()]);
    const indexCalls = fetchMock.mock.calls.filter(([u]) => String(u) === `${ORIGIN}/blog`);
    expect(indexCalls).toHaveLength(1);
  });

  it('on scrape failure serves last-good DB rows, records the error, and keeps the clock', async () => {
    db.getArticles.mockResolvedValue([articleRow('post-a')]); // last-good lives in the DB now
    db.readMeta.mockResolvedValue({ lastSuccessfulFetch: 0, lastError: null }); // 0 = never → forces self-heal
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))));
    const { getClaudeArticles, getIngestionStatus } = await freshScraper();
    const out = await getClaudeArticles();
    expect(out).toHaveLength(1); // served from DB, not []
    expect(db.writeMeta).toHaveBeenCalledWith(expect.objectContaining({ lastError: expect.any(String) }));
    expect(getIngestionStatus().lastError).toBeTruthy();
  });

  it('getIngestionStatus reflects kb_meta after a DB-hit read', async () => {
    // 30 min ago: within the 3h stale threshold, so this is a fresh DB hit (no
    // self-heal). Anchored to Date.now() so the test is clock-independent.
    const ts = Date.now() - 30 * 60 * 1000;
    db.getArticles.mockResolvedValue([articleRow('post-a')]);
    db.readMeta.mockResolvedValue({ lastSuccessfulFetch: ts, lastError: null });
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles, getIngestionStatus } = await freshScraper();
    await getClaudeArticles();
    const s = getIngestionStatus();
    expect(fetchMock).not.toHaveBeenCalled(); // DB hit, not a self-heal scrape
    expect(s.count).toBe(1);
    expect(s.lastSuccessfulFetch).toBe(new Date(ts).toISOString());
    expect(s.lastError).toBeNull();
  });
});
