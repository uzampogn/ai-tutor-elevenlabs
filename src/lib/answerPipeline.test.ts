import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getGroundingContextMock } = vi.hoisted(() => ({ getGroundingContextMock: vi.fn() }));
vi.mock('@/lib/scraper', () => ({ getGroundingContext: getGroundingContextMock }));

const { retrieveArticlesMock } = vi.hoisted(() => ({ retrieveArticlesMock: vi.fn() }));
vi.mock('@/lib/retrieval', () => ({ retrieveArticles: retrieveArticlesMock }));

import { prepareAnswerContext, CHAT_MODEL, CHAT_MAX_TOKENS } from './answerPipeline';

const retrieved = (slug: string, body = 'FULL BODY') => ({
  slug, title: `Title ${slug}`, url: `https://claude.com/blog/${slug}`,
  pubDate: '', description: '', body, summary: 'sum', heroImage: '', similarity: 0.9,
});

beforeEach(() => {
  getGroundingContextMock.mockReset().mockResolvedValue('GROUNDING_MARKER');
  retrieveArticlesMock.mockReset().mockResolvedValue([]);
});

describe('prepareAnswerContext', () => {
  it('exports the prod model constants', () => {
    expect(CHAT_MODEL).toBe('claude-sonnet-4-6');
    expect(CHAT_MAX_TOKENS).toBe(1024);
  });

  it('no retrieval → single cached grounding block', async () => {
    const { system, retrieved: r } = await prepareAnswerContext([{ role: 'user', content: 'hi' }]);
    expect(r).toEqual([]);
    expect(system).toHaveLength(1);
    expect(system[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } });
    expect(system[0].text).toContain('GROUNDING_MARKER');
  });

  it('retrieval hit → appends uncached [Source n] block with capped bodies', async () => {
    retrieveArticlesMock.mockResolvedValue([retrieved('post-a', 'A'.repeat(9_000)), retrieved('post-b')]);
    const { system, retrieved: r } = await prepareAnswerContext([
      { role: 'assistant', content: 'earlier' },
      { role: 'user', content: 'tell me about MCP' },
    ]);
    expect(retrieveArticlesMock).toHaveBeenCalledWith('tell me about MCP');
    expect(r.map((x) => x.slug)).toEqual(['post-a', 'post-b']);
    expect(system).toHaveLength(2);
    expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(system[1].cache_control).toBeUndefined();
    expect(system[1].text).toContain('[Source 1] Title post-a');
    expect(system[1].text).toContain('inline marker like [1]');
    expect(system[1].text).not.toContain('A'.repeat(8_001));
  });

  it('embeds the LATEST user message', async () => {
    await prepareAnswerContext([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'second' },
    ]);
    expect(retrieveArticlesMock).toHaveBeenCalledWith('second');
  });

  it('non-array messages → retrieves with empty question', async () => {
    await prepareAnswerContext(undefined);
    expect(retrieveArticlesMock).toHaveBeenCalledWith('');
  });
});
