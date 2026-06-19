import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for per-article summarization (dev-spec-02 / PRD P0-3).
 *
 * The Anthropic SDK is mocked — no live API calls. `createMock` is the stubbed
 * `client.messages.create`; the module instantiates the client at import time,
 * so we re-import via `vi.resetModules()` for a fresh summary cache (except the
 * cache tests, which intentionally reuse one import).
 */

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({ messages: { create: createMock } })),
}));

function cannedText(text: string) {
  return { content: [{ type: 'text', text }] };
}

async function freshSummarize() {
  vi.resetModules();
  return import('./summarize');
}

function article(over: Partial<{ title: string; url: string; body: string; pubDate: string }> = {}) {
  return {
    title: 'Claude Ships Something',
    url: 'https://claude.com/blog/claude-ships',
    body: 'Anthropic released a new capability with broad implications for builders.',
    pubDate: '2026-06-10T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  createMock.mockReset();
});

describe('summarizeArticle', () => {
  it('returns trimmed canned text capped at SUMMARY_CHAR_CAP', async () => {
    createMock.mockResolvedValue(cannedText('  Claude shipped a faster model.  '));
    const { summarizeArticle, SUMMARY_CHAR_CAP } = await freshSummarize();
    const s = await summarizeArticle(article());
    expect(s).toBe('Claude shipped a faster model.');
    expect(s.length).toBeLessThanOrEqual(SUMMARY_CHAR_CAP);
  });

  it('strips stray markdown into plain prose', async () => {
    createMock.mockResolvedValue(
      cannedText('# Big News\n\n**Claude** got *faster* and uses `tools` better.')
    );
    const { summarizeArticle } = await freshSummarize();
    const s = await summarizeArticle(article());
    expect(s).not.toContain('**');
    expect(s).not.toContain('`');
    expect(s).not.toMatch(/^#/);
    expect(s).toContain('Big News');
    expect(s).toContain('Claude');
    expect(s).toContain('faster');
  });

  it('falls back to a body excerpt (no throw) when the SDK rejects, and logs', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createMock.mockRejectedValue(new Error('API down'));
    const { summarizeArticle } = await freshSummarize();
    const body = 'A real article body that should become the excerpt fallback.';
    const s = await summarizeArticle(article({ body }));
    expect(s).toBe(body); // short body → returned verbatim as the excerpt
    expect(errSpy).toHaveBeenCalled();
  });

  it('does not call the API for an empty body (returns "")', async () => {
    const { summarizeArticle } = await freshSummarize();
    const s = await summarizeArticle(article({ body: '' }));
    expect(s).toBe('');
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('summarizeAll — caching', () => {
  it('reuses cached summaries on a second identical pass (0 new API calls)', async () => {
    createMock.mockResolvedValue(cannedText('canned summary'));
    const { summarizeAll } = await freshSummarize();
    const articles = [
      article({ url: 'https://claude.com/blog/a', body: 'body a' }),
      article({ url: 'https://claude.com/blog/b', body: 'body b' }),
      article({ url: 'https://claude.com/blog/c', body: 'body c' }),
    ];
    const first = await summarizeAll(articles);
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(first.every((r) => r.summary === 'canned summary')).toBe(true);
    expect(first.every((r) => r.hash !== '')).toBe(true); // real summaries carry a hash
    const second = await summarizeAll(articles);
    expect(createMock).toHaveBeenCalledTimes(3); // all L1 cache hits
    expect(second).toEqual(first);
  });

  it('re-summarizes exactly the one article whose body changed', async () => {
    createMock.mockResolvedValue(cannedText('canned summary'));
    const { summarizeAll } = await freshSummarize();
    const articles = [
      article({ url: 'https://claude.com/blog/a', body: 'body a' }),
      article({ url: 'https://claude.com/blog/b', body: 'body b' }),
    ];

    await summarizeAll(articles);
    expect(createMock).toHaveBeenCalledTimes(2);

    const edited = [articles[0], { ...articles[1], body: 'body b — revised' }];
    await summarizeAll(edited);
    expect(createMock).toHaveBeenCalledTimes(3); // exactly one new call
  });

  it('summarizes aligned to input order', async () => {
    createMock.mockImplementation(async (reqArg: { messages: { content: string }[] }) =>
      cannedText(`summary of: ${reqArg.messages[0].content.split('\n')[0]}`)
    );
    const { summarizeAll } = await freshSummarize();
    const articles = [
      article({ title: 'First', url: 'https://claude.com/blog/a', body: 'body a' }),
      article({ title: 'Second', url: 'https://claude.com/blog/b', body: 'body b' }),
    ];
    const out = await summarizeAll(articles);
    expect(out[0].summary).toContain('First');
    expect(out[1].summary).toContain('Second');
  });

  it('reuses a durable summary from the known map (0 API calls) when the hash matches', async () => {
    const { summarizeAll, contentHash } = await freshSummarize();
    const a = article({ url: 'https://claude.com/blog/a', body: 'body a' });
    const known = new Map([['a', { hash: contentHash(a.title, a.body), summary: 'durable summary' }]]);
    const out = await summarizeAll([a], known);
    expect(createMock).not.toHaveBeenCalled();
    expect(out[0]).toEqual({ summary: 'durable summary', hash: contentHash(a.title, a.body) });
  });

  it('marks an API-error fallback with hash === "" so it is not cached', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    createMock.mockRejectedValue(new Error('API down'));
    const { summarizeAll } = await freshSummarize();
    const a = article({ url: 'https://claude.com/blog/a', body: 'A body to excerpt.' });
    const out = await summarizeAll([a]);
    expect(out[0].summary).toBe('A body to excerpt.');
    expect(out[0].hash).toBe('');
  });
});

describe('summarizeAll — bounded concurrency', () => {
  it('runs at most 5 summary calls in flight for 24 misses', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    createMock.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return cannedText('canned summary');
    });

    const { summarizeAll } = await freshSummarize();
    const articles = Array.from({ length: 24 }, (_, i) =>
      article({ url: `https://claude.com/blog/post-${i}`, body: `body ${i}` })
    );

    await summarizeAll(articles);
    expect(createMock).toHaveBeenCalledTimes(24);
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(maxInFlight).toBeGreaterThan(1); // genuinely concurrent, not serial
  });
});
