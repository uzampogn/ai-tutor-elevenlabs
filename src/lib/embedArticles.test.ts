import { describe, it, expect, vi, beforeEach } from 'vitest';
import { contentHash } from './summarize';

const db = vi.hoisted(() => ({
  getEmbeddingStates: vi.fn(),
  updateEmbeddings: vi.fn(),
  slugFromUrl: (u: string) => (u.match(/\/blog\/([^/?#]+)/)?.[1] ?? u),
}));
vi.mock('./db', () => db);

const embeddings = vi.hoisted(() => ({
  embedTexts: vi.fn(),
  embeddingsEnabled: vi.fn(),
  EMBEDDING_MODEL: 'voyage-3.5-lite',
  EMBEDDING_DIMS: 1024,
}));
vi.mock('./embeddings', () => embeddings);

import { embedStaleArticles, embeddedHashFor } from './embedArticles';

const art = (slug: string, body = 'body text') => ({
  title: `T ${slug}`, url: `https://claude.com/blog/${slug}`, body,
});

beforeEach(() => {
  db.getEmbeddingStates.mockReset().mockResolvedValue(new Map());
  db.updateEmbeddings.mockReset().mockResolvedValue(undefined);
  embeddings.embedTexts.mockReset().mockResolvedValue([[0.1, 0.2]]);
  embeddings.embeddingsEnabled.mockReset().mockReturnValue(true);
});

describe('embedStaleArticles', () => {
  it('no-ops when embeddings are disabled', async () => {
    embeddings.embeddingsEnabled.mockReturnValue(false);
    await embedStaleArticles([art('a')]);
    expect(db.getEmbeddingStates).not.toHaveBeenCalled();
    expect(embeddings.embedTexts).not.toHaveBeenCalled();
  });

  it('embeds only stale articles (steady state = 0 API calls)', async () => {
    const a = art('a');
    db.getEmbeddingStates.mockResolvedValue(
      new Map([['a', embeddedHashFor(a.title, a.body)]]),
    );
    await embedStaleArticles([a]);
    expect(embeddings.embedTexts).not.toHaveBeenCalled();
    expect(db.updateEmbeddings).not.toHaveBeenCalled();
  });

  it('embeds title + capped body and persists model-prefixed hashes', async () => {
    const a = art('a');
    embeddings.embedTexts.mockResolvedValue([[1, 2, 3]]);
    await embedStaleArticles([a]);
    const [inputs, inputType] = embeddings.embedTexts.mock.calls[0];
    expect(inputType).toBe('document');
    expect(inputs[0].startsWith(`T a\n\n`)).toBe(true);
    expect(db.updateEmbeddings).toHaveBeenCalledWith([
      { slug: 'a', embedding: [1, 2, 3],
        embeddedHash: `voyage-3.5-lite:${contentHash(a.title, a.body)}` },
    ]);
  });

  it('does nothing (and does not throw) when embedTexts fails', async () => {
    embeddings.embedTexts.mockResolvedValue(null);
    await expect(embedStaleArticles([art('a')])).resolves.toBeUndefined();
    expect(db.updateEmbeddings).not.toHaveBeenCalled();
  });

  it('swallows db errors (embedding must never block ingest)', async () => {
    db.getEmbeddingStates.mockRejectedValue(new Error('db down'));
    await expect(embedStaleArticles([art('a')])).resolves.toBeUndefined();
  });

  it('skips articles with empty bodies', async () => {
    await embedStaleArticles([art('a', '')]);
    expect(embeddings.embedTexts).not.toHaveBeenCalled();
  });
});
