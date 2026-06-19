import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Anthropic SDK so ingest summarization (dev-spec-02) returns a canned
// summary instead of making a live API call. No network in CI.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({ messages: { create: createMock } })),
}));
const CANNED_SUMMARY = 'Canned summary for testing.';

/**
 * Fixture-based unit tests for the Claude blog scraper.
 *
 * `global.fetch` is stubbed with hand-authored HTML fixtures that match the
 * selectors/strategies the scraper actually uses:
 *   - the index page exposes >=10 `<a href="/blog/...">` cards
 *   - each article page carries a JSON-LD `Article` block (datePublished + description)
 *
 * The scraper caches in-process, so each test re-imports the module via
 * `vi.resetModules()` + dynamic `import()` to get a fresh cache — except the
 * cache-hit test, which intentionally reuses one instance.
 */

const ORIGIN = 'https://claude.com';
const EXCERPT_CAP = 320; // keep in sync with scraper.ts
const BODY_CAP = 60_000; // keep in sync with scraper.ts

// --- Fixtures -------------------------------------------------------------

const SLUGS = [
  'claude-for-foundation-models', // i=0 → newest
  'introducing-dynamic-workflows-in-claude-code',
  'claude-opus-4-8',
  'constitutional-ai-2',
  'economic-index-q2',
  'agent-sdk-ga',
  'mcp-everywhere',
  'voice-mode-launch',
  'enterprise-controls',
  'research-preview-notes',
  'oldest-eleventh-article', // i=10 → oldest; kept now (no top-10 cap)
];

/** Deterministic date per slug: lower index = more recent (day 11 down to day 01). */
function isoFor(i: number): string {
  return `2026-06-${String(11 - i).padStart(2, '0')}T09:00:00.000Z`;
}

function indexHtml(): string {
  // Render cards in REVERSE chronological-index order (oldest anchor first) so document
  // order is the opposite of recency — this proves the scraper sorts by date, not position.
  const cards = SLUGS.map((slug, i) => ({ slug, i }))
    .reverse()
    .map(
      ({ slug, i }) => `
      <article class="card">
        <a href="/blog/${slug}">Article Title ${i + 1}: ${slug}</a>
        <time datetime="${isoFor(i)}">provisional</time>
      </article>`
    )
    .join('\n');
  return `<!doctype html><html><body><main>${cards}</main></body></html>`;
}

function articleHtml(slug: string, i: number): string {
  // Real claude.com uses BlogPosting with a human "Jun 08, 2026" date; here we use ISO,
  // and a separate test exercises the human-format → ISO normalization path.
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'Claude' },
      {
        '@type': 'BlogPosting',
        headline: `Article Title ${i + 1}`,
        datePublished: isoFor(i),
        description: `This is the JSON-LD description for ${slug}. It explains the article in detail.`,
      },
    ],
  };
  return `<!doctype html><html><head>
    <meta property="og:description" content="OG fallback for ${slug}" />
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
  </head><body><main><p>First paragraph fallback content for ${slug}.</p></main></body></html>`;
}

function htmlResponse(body: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

/** A fetch mock that routes the index URL vs per-article URLs to the right fixture. */
function makeFetchMock() {
  return vi.fn((input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === `${ORIGIN}/blog`) {
      return Promise.resolve(htmlResponse(indexHtml()));
    }
    const m = url.match(/\/blog\/([^/?#]+)/);
    if (m) {
      const slug = m[1];
      const i = SLUGS.indexOf(slug);
      return Promise.resolve(htmlResponse(articleHtml(slug, i < 0 ? 0 : i)));
    }
    return Promise.resolve(htmlResponse('<html></html>', false, 404));
  });
}

async function freshScraper() {
  vi.resetModules();
  return import('./scraper');
}

beforeEach(() => {
  vi.restoreAllMocks();
  createMock.mockReset();
  createMock.mockResolvedValue({ content: [{ type: 'text', text: CANNED_SUMMARY }] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- Parsing --------------------------------------------------------------

describe('getClaudeArticles — parsing', () => {
  it('returns ALL valid articles, sorted newest-first (no top-10 cap; oldest is kept)', async () => {
    vi.stubGlobal('fetch', makeFetchMock());
    const { getClaudeArticles } = await freshScraper();
    const articles = await getClaudeArticles();

    // Every valid candidate is returned — not capped at 10.
    expect(articles).toHaveLength(SLUGS.length);

    const slugs = articles.map((a) => a.url.replace(`${ORIGIN}/blog/`, ''));
    // The oldest candidate must be PRESENT (previously dropped), and the newest present...
    expect(slugs).toContain('oldest-eleventh-article');
    expect(slugs).toContain(SLUGS[0]);
    // ...and despite the index listing cards oldest-first, results are newest-first.
    const times = articles.map((a) => new Date(a.pubDate).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('tracks the index count automatically (12 valid cards → 12 returned)', async () => {
    const slugs = Array.from({ length: 12 }, (_, i) => `post-${i}`);
    const idx = `<!doctype html><html><body><main>${slugs
      .map(
        (s, i) =>
          `<a href="/blog/${s}">Post ${i}</a><time datetime="${isoFor(i)}"></time>`
      )
      .join('\n')}</main></body></html>`;
    const fetchMock = vi.fn((input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${ORIGIN}/blog`) return Promise.resolve(htmlResponse(idx));
      const m = url.match(/\/blog\/([^/?#]+)/);
      const slug = m ? m[1] : 'x';
      return Promise.resolve(htmlResponse(articleHtml(slug, slugs.indexOf(slug))));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles } = await freshScraper();
    expect(await getClaudeArticles()).toHaveLength(12);
  });

  it('keeps a dateless article, sorted last, with pubDate === ""', async () => {
    const idx = `<!doctype html><html><body><main>
      <section class="grid">
        <article><a href="/blog/dated-post">Dated Post</a><time datetime="${isoFor(0)}"></time></article>
      </section>
      <section class="list">
        <div><div><a href="/blog/dateless-post">Dateless Post</a></div></div>
      </section>
    </main></body></html>`;
    const datelessLd = {
      '@type': 'BlogPosting',
      headline: 'Dateless Post',
      description: 'A real article that happens to have no datePublished anywhere.',
    };
    const fetchMock = vi.fn((input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${ORIGIN}/blog`) return Promise.resolve(htmlResponse(idx));
      if (url.includes('dateless-post')) {
        return Promise.resolve(
          htmlResponse(
            `<html><head><script type="application/ld+json">${JSON.stringify(
              datelessLd
            )}</script></head><body><main><p>Body for the dateless post.</p></main></body></html>`
          )
        );
      }
      return Promise.resolve(htmlResponse(articleHtml('dated-post', 0)));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles } = await freshScraper();
    const articles = await getClaudeArticles();

    expect(articles).toHaveLength(2);
    const dateless = articles.find((a) => a.url.endsWith('dateless-post'))!;
    expect(dateless).toBeDefined();
    expect(dateless.pubDate).toBe(''); // never dropped for a missing date
    expect(articles[articles.length - 1].url).toContain('dateless-post'); // sorts last
  });

  it('absolutizes every url to https://claude.com/blog/...', async () => {
    vi.stubGlobal('fetch', makeFetchMock());
    const { getClaudeArticles } = await freshScraper();
    const articles = await getClaudeArticles();
    for (const a of articles) {
      expect(a.url.startsWith('https://claude.com/blog/')).toBe(true);
    }
  });

  it('emits ISO pubDates that parse to valid Dates', async () => {
    vi.stubGlobal('fetch', makeFetchMock());
    const { getClaudeArticles } = await freshScraper();
    const articles = await getClaudeArticles();
    for (const a of articles) {
      // ISO from JSON-LD datePublished.
      expect(a.pubDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Number.isNaN(new Date(a.pubDate).getTime())).toBe(false);
    }
  });

  it('gives every happy-path article a non-empty description, body, and summary', async () => {
    vi.stubGlobal('fetch', makeFetchMock());
    const { getClaudeArticles } = await freshScraper();
    const articles = await getClaudeArticles();
    for (const a of articles) {
      expect(a.description.length).toBeGreaterThan(0);
      expect(a.body.length).toBeGreaterThan(0);
      expect(a.summary).toBe(CANNED_SUMMARY); // summarized on ingest (P0-3)
    }
  });

  it('de-duplicates by slug (a repeated card appears once)', async () => {
    // Inject a duplicate of the first slug; it must not appear twice.
    const dupIndex = `<!doctype html><html><body><main>
      <a href="/blog/${SLUGS[0]}">Dup A</a>
      <a href="/blog/${SLUGS[0]}">Dup A again</a>
      ${SLUGS.slice(1)
        .map((s, i) => `<a href="/blog/${s}">Card ${i}</a>`)
        .join('\n')}
    </main></body></html>`;
    const fetchMock = vi.fn((input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${ORIGIN}/blog`) return Promise.resolve(htmlResponse(dupIndex));
      const m = url.match(/\/blog\/([^/?#]+)/);
      const slug = m ? m[1] : 'x';
      return Promise.resolve(htmlResponse(articleHtml(slug, SLUGS.indexOf(slug))));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles } = await freshScraper();
    const articles = await getClaudeArticles();
    const slugs = articles.map((a) => a.url.replace(`${ORIGIN}/blog/`, ''));
    expect(new Set(slugs).size).toBe(slugs.length); // no dupes
    expect(slugs[0]).toBe(SLUGS[0]); // newest still surfaces first
  });

  it('normalizes a human "Jun 08, 2026" datePublished to ISO 8601', async () => {
    // Mirrors the real claude.com BlogPosting date format (not ISO).
    const humanLd = (slug: string) =>
      `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
        '@type': 'BlogPosting',
        headline: slug,
        datePublished: 'Jun 08, 2026',
        description: `Human-dated article ${slug} with a descriptive body.`,
      })}</script></head><body></body></html>`;
    const fetchMock = vi.fn((input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${ORIGIN}/blog`) {
        return Promise.resolve(
          htmlResponse(
            `<main><a href="/blog/only-one">Only One</a></main>`
          )
        );
      }
      return Promise.resolve(htmlResponse(humanLd('only-one')));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles } = await freshScraper();
    const [article] = await getClaudeArticles();
    expect(article.pubDate).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO
    expect(new Date(article.pubDate).getUTCFullYear()).toBe(2026);
  });
});

// --- Full body (P0-2) -----------------------------------------------------

describe('getClaudeArticles — full body extraction', () => {
  function singleArticleScraper(articlePage: string) {
    const fetchMock = vi.fn((input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${ORIGIN}/blog`) {
        return Promise.resolve(
          htmlResponse(
            `<main><a href="/blog/the-post">The Post</a><time datetime="${isoFor(0)}"></time></main>`
          )
        );
      }
      return Promise.resolve(htmlResponse(articlePage));
    });
    vi.stubGlobal('fetch', fetchMock);
    return freshScraper();
  }

  it('keeps a long JSON-LD articleBody intact in body; description stays a short excerpt', async () => {
    const longBody =
      'Anthropic shipped a major update. '.repeat(120); // ~4000 chars, > old 2500 cap
    const ld = {
      '@type': 'BlogPosting',
      headline: 'Long Post',
      datePublished: isoFor(0),
      description: 'A concise structured description that should become the excerpt.',
      articleBody: longBody,
    };
    const page = `<html><head><script type="application/ld+json">${JSON.stringify(
      ld
    )}</script></head><body></body></html>`;
    const { getClaudeArticles } = await singleArticleScraper(page);
    const [article] = await getClaudeArticles();

    expect(article.body.length).toBeGreaterThan(2500); // NOT truncated to an excerpt
    expect(article.body).toContain('Anthropic shipped a major update.');
    expect(article.description.length).toBeLessThanOrEqual(EXCERPT_CAP);
  });

  it('builds body from <p> text when there is no JSON-LD', async () => {
    const page = `<html><head></head><body><main>
      <p>First substantive paragraph about the launch.</p>
      <p>x</p>
      <p>Second substantive paragraph with the technical details.</p>
    </main></body></html>`;
    const { getClaudeArticles } = await singleArticleScraper(page);
    const [article] = await getClaudeArticles();

    expect(article.body.length).toBeGreaterThan(0);
    expect(article.body).toContain('First substantive paragraph');
    expect(article.body).toContain('Second substantive paragraph');
    expect(article.body).not.toContain('\n\nx'); // < 2 char paragraph skipped
  });

  it('caps a pathological body at BODY_CAP', async () => {
    const huge = 'A'.repeat(200_000);
    const ld = {
      '@type': 'BlogPosting',
      headline: 'Huge Post',
      datePublished: isoFor(0),
      articleBody: huge,
    };
    const page = `<html><head><script type="application/ld+json">${JSON.stringify(
      ld
    )}</script></head><body></body></html>`;
    const { getClaudeArticles } = await singleArticleScraper(page);
    const [article] = await getClaudeArticles();

    expect(article.body.length).toBeLessThanOrEqual(BODY_CAP);
  });
});

// --- Junk filtering (P0-6) ------------------------------------------------

describe('getClaudeArticles — junk filtering', () => {
  it('uses the real title (not "Read more") and never emits a generic-text article', async () => {
    const idx = `<!doctype html><html><body><main>
      <article>
        <h2>Claude Ships Something Big</h2>
        <a href="/blog/big-ship">Claude Ships Something Big</a>
        <a href="/blog/big-ship">Read more</a>
        <time datetime="${isoFor(0)}"></time>
      </article>
    </main></body></html>`;
    const fetchMock = vi.fn((input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${ORIGIN}/blog`) return Promise.resolve(htmlResponse(idx));
      return Promise.resolve(htmlResponse(articleHtml('big-ship', 0)));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles } = await freshScraper();
    const articles = await getClaudeArticles();

    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe('Claude Ships Something Big');
    expect(articles.some((a) => /^read more$/i.test(a.title))).toBe(false);
  });

  it('falls back to a nearby heading when every anchor for a slug is generic', async () => {
    const idx = `<!doctype html><html><body><main>
      <article>
        <h3>Heading-Derived Title</h3>
        <a href="/blog/heading-only">Read more</a>
        <time datetime="${isoFor(0)}"></time>
      </article>
    </main></body></html>`;
    const fetchMock = vi.fn((input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${ORIGIN}/blog`) return Promise.resolve(htmlResponse(idx));
      return Promise.resolve(htmlResponse(articleHtml('heading-only', 0)));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles } = await freshScraper();
    const articles = await getClaudeArticles();

    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe('Heading-Derived Title');
  });

  it('excludes /blog/category/* and /blog/tag/* listing links', async () => {
    const idx = `<!doctype html><html><body><main>
      <a href="/blog/real-post">Real Post</a><time datetime="${isoFor(0)}"></time>
      <a href="/blog/category/announcements">Announcements</a>
      <a href="/blog/tag/research">Research</a>
      <a href="/blog/author/team">Team</a>
    </main></body></html>`;
    const fetchMock = vi.fn((input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${ORIGIN}/blog`) return Promise.resolve(htmlResponse(idx));
      return Promise.resolve(htmlResponse(articleHtml('real-post', 0)));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles } = await freshScraper();
    const articles = await getClaudeArticles();

    expect(articles).toHaveLength(1);
    expect(articles[0].url).toBe(`${ORIGIN}/blog/real-post`);
    const slugs = articles.map((a) => a.url);
    expect(slugs.some((u) => u.includes('/category/'))).toBe(false);
    expect(slugs.some((u) => u.includes('/tag/'))).toBe(false);
    expect(slugs.some((u) => u.includes('/author/'))).toBe(false);
  });

  it('dedupes two anchors to the same slug, keeping the non-generic title', async () => {
    const idx = `<!doctype html><html><body><main>
      <a href="/blog/dup-slug">Learn more</a>
      <a href="/blog/dup-slug">The Authoritative Title</a>
      <time datetime="${isoFor(0)}"></time>
    </main></body></html>`;
    const fetchMock = vi.fn((input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${ORIGIN}/blog`) return Promise.resolve(htmlResponse(idx));
      return Promise.resolve(htmlResponse(articleHtml('dup-slug', 0)));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles } = await freshScraper();
    const articles = await getClaudeArticles();

    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe('The Authoritative Title');
  });
});

// --- Caching --------------------------------------------------------------

describe('getClaudeArticles — caching', () => {
  it('does not re-invoke fetch on a second call within TTL (cache hit)', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles } = await freshScraper();

    const first = await getClaudeArticles();
    const callsAfterFirst = fetchMock.mock.calls.length;
    const validCandidateCount = SLUGS.length;
    expect(callsAfterFirst).toBe(1 + validCandidateCount); // 1 index + N candidate bodies
    const summaryCallsAfterFirst = createMock.mock.calls.length;
    expect(summaryCallsAfterFirst).toBe(validCandidateCount); // one summary per article

    const second = await getClaudeArticles();
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst); // unchanged
    expect(createMock.mock.calls.length).toBe(summaryCallsAfterFirst); // 0 new summary calls
    expect(second).toBe(first); // same cached reference
  });
});

// --- Resilience -----------------------------------------------------------

describe('getClaudeArticles — resilience', () => {
  it('returns [] (no throw) when the index fetch rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down')))
    );
    const { getClaudeArticles } = await freshScraper();
    await expect(getClaudeArticles()).resolves.toEqual([]);
  });

  it('returns [] (no throw) when the index fetch 404s', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(htmlResponse('not found', false, 404)))
    );
    const { getClaudeArticles } = await freshScraper();
    await expect(getClaudeArticles()).resolves.toEqual([]);
  });

  it('degrades only the failing article when one body fetch errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const badSlug = SLUGS[2];
    const fetchMock = vi.fn((input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `${ORIGIN}/blog`) return Promise.resolve(htmlResponse(indexHtml()));
      const m = url.match(/\/blog\/([^/?#]+)/);
      const slug = m ? m[1] : 'x';
      if (slug === badSlug) return Promise.resolve(htmlResponse('boom', false, 500));
      return Promise.resolve(htmlResponse(articleHtml(slug, SLUGS.indexOf(slug))));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles } = await freshScraper();
    const articles = await getClaudeArticles();

    expect(articles).toHaveLength(SLUGS.length); // whole feed survives
    const degraded = articles.find((a) => a.url.endsWith(badSlug))!;
    expect(degraded).toBeDefined();
    expect(degraded.url).toBe(`${ORIGIN}/blog/${badSlug}`); // index title/url kept
    expect(degraded.description).toBe(''); // body left empty
    expect(degraded.body).toBe('');
    // The others still have descriptions.
    expect(
      articles.filter((a) => a.description.length > 0).length
    ).toBe(SLUGS.length - 1);
  });
});

// --- Context --------------------------------------------------------------

describe('buildArticleContext', () => {
  it('produces one ## [Article n] markdown block per article', async () => {
    vi.stubGlobal('fetch', makeFetchMock());
    const { getClaudeArticles, buildArticleContext } = await freshScraper();
    const articles = await getClaudeArticles();
    const ctx = buildArticleContext(articles);

    expect(ctx).toContain('## [Article 1] ');
    expect(ctx).toContain(`## [Article ${articles.length}] `);
    expect(ctx).toContain(`URL: ${articles[0].url}`);
    expect(ctx).toContain(`Published: ${articles[0].pubDate}`);
    expect(ctx).toContain(articles[0].summary); // grounding is the SUMMARY (P0-5), not body
    // One block per article, joined by the --- separator.
    expect(ctx.split('\n\n---\n\n')).toHaveLength(articles.length);
  });

  it('builds grounding from summaries (not bodies), newest-first', async () => {
    const { buildArticleContext } = await freshScraper();
    const articles = Array.from({ length: 24 }, (_, i) => ({
      title: `Post ${i}`,
      url: `https://claude.com/blog/post-${i}`,
      pubDate: `2026-06-${String(24 - i).padStart(2, '0')}T00:00:00.000Z`,
      description: `desc ${i}`,
      body: `FULLBODY-${i} `.repeat(200), // large; must NOT leak into context
      summary: `SUMMARY-${i}`,
      heroImage: '',
    }));
    const ctx = buildArticleContext(articles);
    expect(ctx).toContain('SUMMARY-0');
    expect(ctx).not.toContain('FULLBODY');
    // Newest-first ordering preserved.
    expect(ctx.indexOf('## [Article 1] ')).toBeLessThan(ctx.indexOf('## [Article 2] '));
  });

  it('never exceeds the CONTEXT_CHAR_CEILING, keeping the freshest blocks', async () => {
    const { buildArticleContext } = await freshScraper();
    const big = 'x'.repeat(700); // a maxed-out summary
    const articles = Array.from({ length: 40 }, (_, i) => ({
      title: `Post ${i}`,
      url: `https://claude.com/blog/post-${i}`,
      pubDate: '2026-06-01T00:00:00.000Z',
      description: 'd',
      body: 'BODY'.repeat(500),
      summary: `S${i}-${big}`,
      heroImage: '',
    }));
    const ctx = buildArticleContext(articles);
    expect(ctx.length).toBeLessThanOrEqual(20_000); // hard ceiling enforced
    const blocks = ctx.split('\n\n---\n\n');
    expect(blocks.length).toBeLessThan(40); // clipped — not every article fits
    expect(ctx).toContain('## [Article 1] '); // newest block always kept
    expect(ctx).not.toContain('BODY'); // summaries only
  });

  it('returns the unavailable message for an empty list', async () => {
    const { buildArticleContext } = await freshScraper();
    expect(buildArticleContext([])).toMatch(/No articles currently available/);
  });
});

// --- Freshness & observable staleness (P0-4) ------------------------------

describe('getClaudeArticles — freshness, force, observable staleness', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cold start: before any success, lastSuccessfulFetch is null and stale is true', async () => {
    const { getIngestionStatus } = await freshScraper();
    const s = getIngestionStatus();
    expect(s.lastSuccessfulFetch).toBeNull();
    expect(s.ageMs).toBeNull();
    expect(s.stale).toBe(true);
    expect(s.count).toBe(0);
  });

  it('after a success: ageMs ~0, not stale, count tracks the feed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T00:00:00.000Z'));
    vi.stubGlobal('fetch', makeFetchMock());
    const { getClaudeArticles, getIngestionStatus } = await freshScraper();

    await getClaudeArticles();
    const s = getIngestionStatus();
    expect(s.ageMs).toBe(0);
    expect(s.stale).toBe(false);
    expect(s.count).toBe(SLUGS.length);
    expect(s.lastError).toBeNull();
    expect(s.lastSuccessfulFetch).toBe('2026-06-10T00:00:00.000Z');
  });

  it('force bypasses the TTL and re-scrapes within the cache window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T00:00:00.000Z'));
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const { getClaudeArticles } = await freshScraper();

    const indexCalls = () =>
      fetchMock.mock.calls.filter((c) => String(c[0]) === `${ORIGIN}/blog`).length;

    await getClaudeArticles();
    expect(indexCalls()).toBe(1);

    // Still well within the 1h TTL — a normal call would be a cache hit, but force re-scrapes.
    await getClaudeArticles({ force: true });
    expect(indexCalls()).toBe(2);
  });

  // NOTE: the former "June 10→15 regression" test (module-memory last-good on a
  // failed scrape) is superseded by the DB-backed equivalent in scraper.db.test.ts
  // ('on scrape failure serves last-good DB rows…'), since last-good now lives in
  // Postgres rather than module memory.
});
