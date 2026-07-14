import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const KEY = 'test-voyage-key';

async function freshEmbeddings() {
  vi.resetModules();
  return import('./embeddings');
}

function voyageResponse(vectors: number[][]) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data: vectors.map((embedding, index) => ({ embedding, index })) }),
  } as unknown as Response;
}

beforeEach(() => {
  process.env.VOYAGE_API_KEY = KEY;
});
afterEach(() => {
  delete process.env.VOYAGE_API_KEY;
  vi.unstubAllGlobals();
});

describe('embedTexts', () => {
  it('no-ops (null, no fetch) without VOYAGE_API_KEY', async () => {
    delete process.env.VOYAGE_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { embedTexts, embeddingsEnabled } = await freshEmbeddings();
    expect(embeddingsEnabled()).toBe(false);
    expect(await embedTexts(['x'], 'document')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns [] for empty input without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { embedTexts } = await freshEmbeddings();
    expect(await embedTexts([], 'document')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts model, input and input_type with the bearer key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(voyageResponse([[1, 2]]));
    vi.stubGlobal('fetch', fetchMock);
    const { embedTexts } = await freshEmbeddings();
    const out = await embedTexts(['hello'], 'query');
    expect(out).toEqual([[1, 2]]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.voyageai.com/v1/embeddings');
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body)).toMatchObject({
      input: ['hello'], model: 'voyage-3.5-lite', input_type: 'query',
    });
  });

  it('returns null on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response));
    const { embedTexts } = await freshEmbeddings();
    expect(await embedTexts(['x'], 'document')).toBeNull();
  });

  it('returns null on a malformed response (count mismatch)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(voyageResponse([[1]])));
    const { embedTexts } = await freshEmbeddings();
    expect(await embedTexts(['a', 'b'], 'document')).toBeNull();
  });

  it('splits >128 inputs into sequential batches', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(voyageResponse(Array.from({ length: 128 }, () => [1])))
      .mockResolvedValueOnce(voyageResponse([[2], [2]]));
    vi.stubGlobal('fetch', fetchMock);
    const { embedTexts } = await freshEmbeddings();
    const out = await embedTexts(Array.from({ length: 130 }, (_, i) => `t${i}`), 'document');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(130);
  });
});
