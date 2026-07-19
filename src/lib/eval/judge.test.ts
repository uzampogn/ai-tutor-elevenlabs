import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { buildJudgePrompt, parseJudgeJson, judgeAnswer } from './judge';

const VALID = JSON.stringify({
  groundedness: { score: 4, rationale: 'mostly grounded' },
  citation_faithfulness: { score: 5, rationale: 'citations accurate' },
  relevance: { score: 5, rationale: 'on topic' },
  pedagogy: { score: 3, rationale: 'a bit dense' },
});

function fakeClient(replies: string[]): Anthropic {
  const create = vi.fn();
  for (const r of replies) create.mockResolvedValueOnce({ content: [{ type: 'text', text: r }] });
  return { messages: { create } } as unknown as Anthropic;
}

describe('buildJudgePrompt', () => {
  it('contains the question, sources, and answer verbatim', () => {
    const p = buildJudgePrompt('Q_MARK', 'SRC_MARK', 'ANS_MARK');
    expect(p).toContain('Q_MARK');
    expect(p).toContain('SRC_MARK');
    expect(p).toContain('ANS_MARK');
    expect(p).toContain('groundedness');
    expect(p).toContain('ONLY');
  });
});

describe('parseJudgeJson', () => {
  it('parses a valid verdict into namespaced scores', () => {
    const v = parseJudgeJson(VALID)!;
    expect(v.scores['judge.groundedness']).toBe(4);
    expect(v.scores['judge.pedagogy']).toBe(3);
    expect(v.rationales['judge.groundedness']).toBe('mostly grounded');
  });
  it('tolerates a ```json fence around the object', () => {
    expect(parseJudgeJson('```json\n' + VALID + '\n```')).not.toBeNull();
  });
  it('rejects out-of-range scores and missing keys', () => {
    expect(parseJudgeJson(VALID.replace('"score":4', '"score":9'))).toBeNull();
    expect(parseJudgeJson('{"groundedness": {"score": 4, "rationale": "x"}}')).toBeNull();
    expect(parseJudgeJson('not json at all')).toBeNull();
  });
});

describe('judgeAnswer', () => {
  const args = { question: 'q', sourcesBlock: 's', answer: 'a' };
  beforeEach(() => vi.restoreAllMocks());

  it('returns verdict on first valid reply', async () => {
    const v = await judgeAnswer(fakeClient([VALID]), args);
    expect(v?.scores['judge.relevance']).toBe(5);
  });
  it('retries once on malformed output, then succeeds', async () => {
    const client = fakeClient(['garbage', VALID]);
    const v = await judgeAnswer(client, args);
    expect(v).not.toBeNull();
    expect((client.messages.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });
  it('returns null after two malformed replies (failed item, no throw)', async () => {
    const v = await judgeAnswer(fakeClient(['garbage', 'more garbage']), args);
    expect(v).toBeNull();
  });
  it('returns null when the API call itself throws', async () => {
    const client = { messages: { create: vi.fn().mockRejectedValue(new Error('boom')) } } as unknown as Anthropic;
    expect(await judgeAnswer(client, { question: 'q', sourcesBlock: 's', answer: 'a' })).toBeNull();
  });
});
