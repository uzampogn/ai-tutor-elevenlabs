import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ similarArticles: vi.fn() }));
vi.mock('./db', () => db);
const embeddings = vi.hoisted(() => ({ embedTexts: vi.fn() }));
vi.mock('./embeddings', () => embeddings);

import { retrieveArticles, SIM_FLOOR, RETRIEVAL_K } from './retrieval';

const row = (slug: string, similarity: number) => ({
  slug, similarity, title: `T ${slug}`, url: `https://claude.com/blog/${slug}`,
  pubDate: '', description: '', body: 'b', summary: 's', heroImage: '',
});

beforeEach(() => {
  embeddings.embedTexts.mockReset().mockResolvedValue([[0.1, 0.2]]);
  db.similarArticles.mockReset().mockResolvedValue([]);
});

describe('retrieveArticles', () => {
  it('returns [] for an empty question without embedding', async () => {
    expect(await retrieveArticles('   ')).toEqual([]);
    expect(embeddings.embedTexts).not.toHaveBeenCalled();
  });

  it('embeds the question as a query and returns rows above the floor', async () => {
    db.similarArticles.mockResolvedValue([row('a', 0.8), row('b', SIM_FLOOR - 0.01)]);
    const out = await retrieveArticles('what is mcp?');
    expect(embeddings.embedTexts).toHaveBeenCalledWith(
      ['what is mcp?'], 'query', expect.objectContaining({ signal: expect.anything() }),
    );
    expect(db.similarArticles).toHaveBeenCalledWith([0.1, 0.2], RETRIEVAL_K);
    expect(out.map((r) => r.slug)).toEqual(['a']);
  });

  it('returns [] when embedding is disabled or fails (null)', async () => {
    embeddings.embedTexts.mockResolvedValue(null);
    expect(await retrieveArticles('q')).toEqual([]);
    expect(db.similarArticles).not.toHaveBeenCalled();
  });

  it('returns [] when the db query throws', async () => {
    db.similarArticles.mockRejectedValue(new Error('boom'));
    expect(await retrieveArticles('q')).toEqual([]);
  });
});
