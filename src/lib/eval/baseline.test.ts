import { describe, it, expect } from 'vitest';
import { diffAgainstBaseline, toBaseline, defaultTolerance, formatDiffTable, type BaselineFile } from './baseline';

const base: BaselineFile = {
  runName: 'eval-abc123-1',
  acceptedAt: 'abc123',
  metrics: {
    'retrieval.recall': { value: 0.9, tolerance: 0.02 },
    'judge.groundedness': { value: 4.2, tolerance: 0.3 },
  },
};

describe('defaultTolerance', () => {
  it('judge metrics get 0.3, deterministic get 0.02', () => {
    expect(defaultTolerance('judge.pedagogy')).toBe(0.3);
    expect(defaultTolerance('retrieval.mrr')).toBe(0.02);
    expect(defaultTolerance('citations.in_range')).toBe(0.02);
  });
});

describe('diffAgainstBaseline', () => {
  it('within tolerance → ok, no failure', () => {
    const { rows, failed } = diffAgainstBaseline(base, { 'retrieval.recall': 0.89, 'judge.groundedness': 4.0 });
    expect(failed).toBe(false);
    expect(rows.every((r) => r.verdict === 'ok')).toBe(true);
  });
  it('exactly at tolerance boundary → ok', () => {
    expect(diffAgainstBaseline(base, { 'retrieval.recall': 0.88, 'judge.groundedness': 3.9 }).failed).toBe(false);
  });
  it('just below tolerance → FAIL with exit-worthy flag', () => {
    const { rows, failed } = diffAgainstBaseline(base, { 'retrieval.recall': 0.87, 'judge.groundedness': 4.2 });
    expect(failed).toBe(true);
    expect(rows.find((r) => r.metric === 'retrieval.recall')?.verdict).toBe('FAIL');
  });
  it('improvement → ok', () => {
    expect(diffAgainstBaseline(base, { 'retrieval.recall': 1, 'judge.groundedness': 5 }).failed).toBe(false);
  });
  it('metric absent from baseline → verdict "new", never fails', () => {
    const { rows, failed } = diffAgainstBaseline(base, {
      'retrieval.recall': 0.9, 'judge.groundedness': 4.2, 'citations.coverage': 0.5,
    });
    expect(failed).toBe(false);
    expect(rows.find((r) => r.metric === 'citations.coverage')?.verdict).toBe('new');
  });
  it('no baseline file → all rows "new", never fails', () => {
    const { rows, failed } = diffAgainstBaseline(null, { 'retrieval.recall': 0.1 });
    expect(failed).toBe(false);
    expect(rows[0].verdict).toBe('new');
  });
});

describe('toBaseline / formatDiffTable', () => {
  it('stamps default tolerances per metric family', () => {
    const b = toBaseline('run-1', 'sha1', { 'judge.relevance': 4.5, 'retrieval.mrr': 0.8 });
    expect(b.metrics['judge.relevance'].tolerance).toBe(0.3);
    expect(b.metrics['retrieval.mrr'].tolerance).toBe(0.02);
  });
  it('renders one aligned row per metric with verdicts', () => {
    const { rows } = diffAgainstBaseline(base, { 'retrieval.recall': 0.8, 'judge.groundedness': 4.2 });
    const table = formatDiffTable(rows);
    expect(table).toContain('retrieval.recall');
    expect(table).toContain('FAIL');
    expect(table).toContain('ok');
  });
});
