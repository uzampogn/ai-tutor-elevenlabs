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

import { embedStaleArticles, embeddedHashFor, EMBED_MAX_PER_RUN } from './embedArticles';

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

  it('persists nothing (and does not throw) when embedTexts fails', async () => {
    embeddings.embedTexts.mockResolvedValue(null);
    await expect(embedStaleArticles([art('a')])).resolves.toEqual({ embedded: 0, backlog: 1 });
    expect(db.updateEmbeddings).not.toHaveBeenCalled();
  });

  it('swallows db errors (embedding must never block ingest)', async () => {
    db.getEmbeddingStates.mockRejectedValue(new Error('db down'));
    await expect(embedStaleArticles([art('a')])).resolves.toEqual({ embedded: 0, backlog: 0 });
  });

  it('skips articles with empty bodies', async () => {
    await embedStaleArticles([art('a', '')]);
    expect(embeddings.embedTexts).not.toHaveBeenCalled();
  });

  // Backlog-ratchet regression (2026-08): a single all-or-nothing batch call
  // exceeded Voyage free-tier limits once the stale set grew, so every nightly
  // cron 429'd wholesale, persisted nothing, and the backlog could only grow
  // (15/25 prod articles ended up unembedded). Per-article calls + immediate
  // persistence make partial progress durable, so the backlog always drains.
  describe('per-article embedding (backlog ratchet fix)', () => {
    it('embeds one article per API call and persists each success immediately', async () => {
      embeddings.embedTexts.mockResolvedValue([[1]]);
      await embedStaleArticles([art('a'), art('b'), art('c')]);
      expect(embeddings.embedTexts).toHaveBeenCalledTimes(3);
      for (const call of embeddings.embedTexts.mock.calls) {
        expect(call[0]).toHaveLength(1); // one article per request
      }
      expect(db.updateEmbeddings).toHaveBeenCalledTimes(3);
    });

    it('keeps successes persisted when a later article fails, then stops', async () => {
      embeddings.embedTexts
        .mockResolvedValueOnce([[1]])
        .mockResolvedValueOnce(null); // e.g. Voyage 429 mid-run
      await embedStaleArticles([art('a'), art('b'), art('c')]);
      expect(embeddings.embedTexts).toHaveBeenCalledTimes(2); // stopped after the failure
      expect(db.updateEmbeddings).toHaveBeenCalledTimes(1); // 'a' survived the run
      expect(db.updateEmbeddings.mock.calls[0][0][0].slug).toBe('a');
    });

    it('caps embeds per run so a burst never exceeds the rate-limit budget', async () => {
      const many = Array.from({ length: EMBED_MAX_PER_RUN + 4 }, (_, i) => art(`a${i}`));
      embeddings.embedTexts.mockResolvedValue([[1]]);
      await embedStaleArticles(many);
      expect(embeddings.embedTexts).toHaveBeenCalledTimes(EMBED_MAX_PER_RUN);
    });
  });

  // Embedding health flag: the pipeline failed silently for weeks (Voyage 429s
  // swallowed) — surface the backlog so it's observable and alertable.
  describe('embedding-health reporting', () => {
    it('reports embedded/backlog counts on success', async () => {
      embeddings.embedTexts.mockResolvedValue([[1]]);
      expect(await embedStaleArticles([art('a'), art('b')])).toEqual({ embedded: 2, backlog: 0 });
    });

    it('reports the remaining backlog when a mid-run failure stops the loop', async () => {
      embeddings.embedTexts.mockResolvedValueOnce([[1]]).mockResolvedValueOnce(null);
      expect(await embedStaleArticles([art('a'), art('b'), art('c')])).toEqual({ embedded: 1, backlog: 2 });
    });

    it('reports the deferred remainder when the per-run cap truncates a burst', async () => {
      const many = Array.from({ length: EMBED_MAX_PER_RUN + 4 }, (_, i) => art(`a${i}`));
      embeddings.embedTexts.mockResolvedValue([[1]]);
      expect(await embedStaleArticles(many)).toEqual({ embedded: EMBED_MAX_PER_RUN, backlog: 4 });
    });

    it('logs an error-level line when a backlog remains (alertable in Vercel logs)', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      embeddings.embedTexts.mockResolvedValue(null);
      await embedStaleArticles([art('a')]);
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('[embed] backlog'))).toBe(true);
      errSpy.mockRestore();
    });

    it('reports zeros when disabled or nothing is stale', async () => {
      embeddings.embeddingsEnabled.mockReturnValue(false);
      expect(await embedStaleArticles([art('a')])).toEqual({ embedded: 0, backlog: 0 });
    });
  });
});
