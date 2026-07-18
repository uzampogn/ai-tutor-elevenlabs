import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';

describe('/api/stt-token', () => {
  const realFetch = global.fetch;
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => {
    global.fetch = realFetch;
    vi.unstubAllEnvs();
  });

  it('returns 503 with no-store when ELEVENLABS_API_KEY is unset', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    const res = await POST();
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('mints a token via the ElevenLabs single-use-token endpoint', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'test-key');
    const upstream = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'tok-123' }), { status: 200 }),
    );
    global.fetch = upstream as unknown as typeof fetch;

    const res = await POST();
    expect(upstream).toHaveBeenCalledWith(
      'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe',
      { method: 'POST', headers: { 'xi-api-key': 'test-key' } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({ token: 'tok-123' });
    // the API key must never appear in the response
    expect(JSON.stringify(body)).not.toContain('test-key');
  });

  it('returns 502 when the upstream mint fails', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'test-key');
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('nope', { status: 401 })) as unknown as typeof fetch;
    const res = await POST();
    expect(res.status).toBe(502);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
