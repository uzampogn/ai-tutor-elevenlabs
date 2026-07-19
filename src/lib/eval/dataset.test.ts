import { describe, it, expect } from 'vitest';
import { questionId, mergeCandidates, type EvalItem } from './dataset';

const item = (q: string, over: Partial<EvalItem> = {}): EvalItem => ({
  id: questionId(q), question: q, expectedSlugs: ['post-a'], kind: 'single', curated: false, ...over,
});

describe('questionId', () => {
  it('is stable and insensitive to case/whitespace', () => {
    expect(questionId('What is MCP?')).toBe(questionId('  what is mcp?  '));
  });
  it('differs for different questions', () => {
    expect(questionId('What is MCP?')).not.toBe(questionId('What is RAG?'));
  });
});

describe('mergeCandidates', () => {
  it('appends only unseen candidates', () => {
    const existing = [item('q1')];
    const merged = mergeCandidates(existing, [item('q1'), item('q2')]);
    expect(merged.map((i) => i.question)).toEqual(['q1', 'q2']);
  });
  it('never mutates existing items (curated flags and labels preserved)', () => {
    const curated = item('q1', { curated: true, expectedSlugs: ['hand-fixed'], kind: 'multi' });
    const merged = mergeCandidates([curated], [item('q1')]);
    expect(merged[0]).toEqual(curated);
    expect(merged).toHaveLength(1);
  });
  it('empty existing → all candidates', () => {
    expect(mergeCandidates([], [item('q1'), item('q2')])).toHaveLength(2);
  });
});
