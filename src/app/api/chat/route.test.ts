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
});
