import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { streamMock, getGroundingContextMock, getClaudeArticlesMock } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  getGroundingContextMock: vi.fn(),
  getClaudeArticlesMock: vi.fn(),
}));

// Mock the Anthropic SDK: default export is a class whose instances expose messages.stream.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: streamMock };
  },
}));
vi.mock('@/lib/scraper', () => ({
  getGroundingContext: getGroundingContextMock,
  getClaudeArticles: getClaudeArticlesMock,
}));

const { retrieveArticlesMock } = vi.hoisted(() => ({ retrieveArticlesMock: vi.fn() }));
vi.mock('@/lib/retrieval', () => ({ retrieveArticles: retrieveArticlesMock }));

import { POST } from './route';

type Chunk = { type: string; delta?: { type: string; text: string } };

function fakeStream(chunks: Chunk[]) {
  return (async function* () {
    for (const c of chunks) yield c;
  })();
}

function post(messages: unknown[]) {
  const req = new Request('http://localhost/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages }),
  });
  return POST(req as unknown as NextRequest);
}

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

beforeEach(() => {
  streamMock.mockReset().mockReturnValue(
    fakeStream([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }]),
  );
  getGroundingContextMock.mockReset().mockResolvedValue('GROUNDING_MARKER');
  getClaudeArticlesMock.mockReset();
  retrieveArticlesMock.mockReset().mockResolvedValue([]);
});

describe('POST /api/chat — grounding from the cached context', () => {
  it('injects getGroundingContext() and never scrapes on the request path', async () => {
    const res = await post([{ role: 'user', content: 'hi' }]);
    expect(res.status).toBe(200);
    expect(getGroundingContextMock).toHaveBeenCalledTimes(1);
    expect(getClaudeArticlesMock).not.toHaveBeenCalled();

    // Shape-agnostic so this assertion survives Task 3 (string today, block array after C).
    const sysArg = streamMock.mock.calls[0][0].system;
    const sysText = typeof sysArg === 'string' ? sysArg : sysArg[0].text;
    expect(sysText).toContain('GROUNDING_MARKER');
  });

  it('streams the model text deltas back to the client', async () => {
    streamMock.mockReturnValue(
      fakeStream([
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
      ]),
    );
    const res = await post([{ role: 'user', content: 'hi' }]);
    expect(await readAll(res)).toBe('Hello world');
  });

  it('sends the system prompt as an ephemeral cache_control block (prompt caching)', async () => {
    await post([{ role: 'user', content: 'hi' }]);
    const sysArg = streamMock.mock.calls[0][0].system;
    expect(Array.isArray(sysArg)).toBe(true);
    expect(sysArg[0]).toMatchObject({
      type: 'text',
      cache_control: { type: 'ephemeral' },
    });
    expect(sysArg[0].text).toContain('GROUNDING_MARKER');
  });
});

describe('POST /api/chat — RAG retrieved block (spec/rag-retrieval-citations)', () => {
  const retrieved = (slug: string, body = 'FULL BODY') => ({
    slug, title: `Title ${slug}`, url: `https://claude.com/blog/${slug}`,
    pubDate: '', description: '', body, summary: 'sum', heroImage: '', similarity: 0.9,
  });

  it('no retrieval → single cached block and no X-Sources header (byte-identical to today)', async () => {
    const res = await post([{ role: 'user', content: 'hi' }]);
    const sysArg = streamMock.mock.calls[0][0].system;
    expect(sysArg).toHaveLength(1);
    expect(res.headers.get('X-Sources')).toBeNull();
  });

  it('retrieval hit → appends an uncached block with capped bodies; block 1 untouched', async () => {
    retrieveArticlesMock.mockResolvedValue([
      retrieved('post-a', 'A'.repeat(9_000)), retrieved('post-b'),
    ]);
    const res = await post([
      { role: 'assistant', content: 'earlier' },
      { role: 'user', content: 'tell me about MCP' },
    ]);
    expect(retrieveArticlesMock).toHaveBeenCalledWith('tell me about MCP');

    const sysArg = streamMock.mock.calls[0][0].system;
    expect(sysArg).toHaveLength(2);
    // Block 1: cached grounding block, byte-identical to the no-retrieval case.
    expect(sysArg[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } });
    expect(sysArg[0].text).toContain('GROUNDING_MARKER');
    // Block 2: uncached, titled sources with capped bodies.
    expect(sysArg[1].cache_control).toBeUndefined();
    expect(sysArg[1].text).toContain('[Source 1] Title post-a');
    expect(sysArg[1].text).toContain('[Source 2] Title post-b');
    expect(sysArg[1].text).toContain('URL: https://claude.com/blog/post-a');
    expect(sysArg[1].text).not.toContain('A'.repeat(8_001)); // BODY_EXCERPT_CAP

    expect(res.headers.get('X-Sources')).toBe('post-a,post-b');
  });

  it('embeds the LATEST user message, not the first', async () => {
    await post([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'second question' },
    ]);
    expect(retrieveArticlesMock).toHaveBeenCalledWith('second question');
  });

  it('retrieved block instructs inline [n] markers keyed to source numbers', async () => {
    retrieveArticlesMock.mockResolvedValue([retrieved('post-a')]);
    await post([{ role: 'user', content: 'q' }]);
    const sysArg = streamMock.mock.calls[0][0].system;
    expect(sysArg[1].text).toContain('inline marker like [1]');
    expect(sysArg[1].text).not.toContain('write its article title EXACTLY');
  });

  it('no retrieval → no marker instruction anywhere new (single block)', async () => {
    await post([{ role: 'user', content: 'q' }]);
    const sysArg = streamMock.mock.calls[0][0].system;
    expect(sysArg).toHaveLength(1);
    expect(sysArg[0].text).not.toContain('inline marker like [1]');
  });
});
