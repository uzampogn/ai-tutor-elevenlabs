import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { MAX_CHARS } from './chunking';

// --- Helpers -----------------------------------------------------------------

/** Minimal stand-in for NextRequest: the route only calls req.json(). */
function makeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

/** Build a fake ElevenLabs /with-timestamps JSON payload for a given text. */
function fakeElevenLabsBody(text: string) {
  const characters = Array.from(text);
  return {
    // 4 bytes of "audio" per request, base64-encoded.
    audio_base64: btoa('MP3X'),
    alignment: {
      characters,
      character_start_times_seconds: characters.map((_, i) => i * 0.1),
      character_end_times_seconds: characters.map((_, i) => i * 0.1 + 0.1),
    },
    normalized_alignment: {
      characters,
      character_start_times_seconds: characters.map((_, i) => i * 0.1),
      character_end_times_seconds: characters.map((_, i) => i * 0.1 + 0.1),
    },
  };
}

/** A Response-like object whose .json()/.text() the route reads. */
function okResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}
function errResponse(status: number, message: string) {
  return {
    ok: false,
    status,
    json: async () => ({ error: message }),
    text: async () => message,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.ELEVENLABS_API_KEY = 'test-key';
  delete process.env.ELEVENLABS_VOICE_ID;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_VOICE_ID;
});

// --- Empty text → 400 --------------------------------------------------------

describe('POST /api/speak — guardrails', () => {
  it('returns 400 for empty text without calling ElevenLabs', async () => {
    const res = await POST(makeReq({ text: '   ' }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 500 when ELEVENLABS_API_KEY is missing', async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const res = await POST(makeReq({ text: 'hello' }));
    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// --- Endpoint, model, voice --------------------------------------------------

describe('POST /api/speak — request shape', () => {
  it('calls the /with-timestamps endpoint (not /stream) with turbo model and default voice', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string);
      return Promise.resolve(okResponse(fakeElevenLabsBody(sent.text)));
    });

    const res = await POST(makeReq({ text: 'Hello world. This is a test.' }));
    expect(res.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/with-timestamps');
    expect(url).not.toContain('/stream');
    // Default voice id when env unset.
    expect(url).toContain('21m00Tcm4TlvDq8ikWAM');

    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.model_id).toBe('eleven_turbo_v2');
  });

  it('uses ELEVENLABS_VOICE_ID from env when set', async () => {
    process.env.ELEVENLABS_VOICE_ID = 'custom-voice-123';
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string);
      return Promise.resolve(okResponse(fakeElevenLabsBody(sent.text)));
    });

    await POST(makeReq({ text: 'Voice test.' }));
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('custom-voice-123');
  });

  it('sets Cache-Control: no-store on the response', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string);
      return Promise.resolve(okResponse(fakeElevenLabsBody(sent.text)));
    });
    const res = await POST(makeReq({ text: 'cache test.' }));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

// --- Multi-chunk + response shape -------------------------------------------

describe('POST /api/speak — multi-chunk stitching', () => {
  it('splits a >2000-char body into N>1 upstream calls and returns one stitched result', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string);
      return Promise.resolve(okResponse(fakeElevenLabsBody(sent.text)));
    });

    // Build a >2000-char multi-sentence body.
    let text = '';
    for (let i = 0; i < 6; i++) {
      text += 'This is sentence number ' + i + ' with some filler words. ';
      text += 'word '.repeat(80) + 'end. ';
    }
    expect(text.length).toBeGreaterThan(MAX_CHARS);

    const res = await POST(makeReq({ text }));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

    const json = await res.json();
    // SpeakResult shape.
    expect(typeof json.audioBase64).toBe('string');
    expect(json.alignment).toBeDefined();
    expect(Array.isArray(json.alignment.chars)).toBe(true);
    expect(Array.isArray(json.alignment.charStartTimesSec)).toBe(true);
    expect(Array.isArray(json.alignment.charEndTimesSec)).toBe(true);

    // Stitched chars reconstruct the (stripped) spoken text exactly.
    expect(json.alignment.chars.join('')).toBe(text.trim());

    // Times monotonic non-decreasing across the whole stitched array.
    const starts = json.alignment.charStartTimesSec as number[];
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]).toBeGreaterThanOrEqual(starts[i - 1]);
    }
  });

  it('returns audioBase64 that decodes to non-empty bytes', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string);
      return Promise.resolve(okResponse(fakeElevenLabsBody(sent.text)));
    });
    const res = await POST(makeReq({ text: 'Hello. World.' }));
    const json = await res.json();
    const decoded = atob(json.audioBase64);
    expect(decoded.length).toBeGreaterThan(0);
  });
});

// --- Fail-soft ---------------------------------------------------------------

describe('POST /api/speak — fail-soft', () => {
  it('returns a partial stitched result when a later chunk 500s, and logs the error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // First call succeeds, second fails.
    let call = 0;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string);
      call += 1;
      if (call === 1) return Promise.resolve(okResponse(fakeElevenLabsBody(sent.text)));
      return Promise.resolve(errResponse(500, 'upstream boom'));
    });

    // Multi-chunk input so at least 2 upstream calls happen.
    let text = '';
    for (let i = 0; i < 6; i++) {
      text += 'Sentence ' + i + ' filler. ' + 'word '.repeat(80) + 'end. ';
    }
    expect(text.length).toBeGreaterThan(MAX_CHARS);

    const res = await POST(makeReq({ text }));
    // Not a 500 — the partial first chunk is returned.
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.audioBase64).toBe('string');
    expect(json.alignment.chars.length).toBeGreaterThan(0);
    // The error was logged.
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns 500 when the very first chunk fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue(errResponse(500, 'boom'));
    const res = await POST(makeReq({ text: 'short text.' }));
    expect(res.status).toBe(500);
    expect(errSpy).toHaveBeenCalled();
  });
});
