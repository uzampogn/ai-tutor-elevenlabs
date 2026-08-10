import { describe, it, expect } from 'vitest';
import { scoreRetrieval } from './retrievalMetrics';

describe('scoreRetrieval — single/multi', () => {
  it('perfect hit at rank 1', () => {
    expect(scoreRetrieval(['a'], ['a', 'x', 'y'], 'single')).toEqual({
      'retrieval.recall': 1, 'retrieval.precision': 1 / 3, 'retrieval.mrr': 1,
    });
  });
  it('hit at rank 3 → mrr 1/3', () => {
    expect(scoreRetrieval(['a'], ['x', 'y', 'a'], 'single')['retrieval.mrr']).toBeCloseTo(1 / 3);
  });
  it('multi: one of two expected found', () => {
    const s = scoreRetrieval(['a', 'b'], ['a', 'x', 'y'], 'multi');
    expect(s['retrieval.recall']).toBeCloseTo(0.5);
    expect(s['retrieval.precision']).toBeCloseTo(1 / 3);
    expect(s['retrieval.mrr']).toBe(1);
  });
  it('total miss → all zeros', () => {
    expect(scoreRetrieval(['a'], ['x', 'y'], 'single')).toEqual({
      'retrieval.recall': 0, 'retrieval.precision': 0, 'retrieval.mrr': 0,
    });
  });
  it('empty retrieval on an expected question → zeros, no NaN', () => {
    expect(scoreRetrieval(['a'], [], 'single')).toEqual({
      'retrieval.recall': 0, 'retrieval.precision': 0, 'retrieval.mrr': 0,
    });
  });
  it('slug-order independence of recall/precision', () => {
    const a = scoreRetrieval(['a', 'b'], ['b', 'a'], 'multi');
    expect(a['retrieval.recall']).toBe(1);
    expect(a['retrieval.precision']).toBe(1);
  });
  it('duplicate retrieved slugs do not inflate recall past 1', () => {
    expect(scoreRetrieval(['a'], ['a', 'a'], 'single')).toEqual({
      'retrieval.recall': 1, 'retrieval.precision': 1, 'retrieval.mrr': 1,
    });
  });
  it('duplicate retrieved with a miss: distinct hits for recall, all hits for precision', () => {
    const s = scoreRetrieval(['a', 'b'], ['a', 'a', 'x'], 'multi');
    expect(s['retrieval.recall']).toBeCloseTo(0.5);
    expect(s['retrieval.precision']).toBeCloseTo(2 / 3);
    expect(s['retrieval.mrr']).toBe(1);
  });
  it('duplicate expected slugs are deduped', () => {
    expect(scoreRetrieval(['a', 'a'], ['a'], 'single')['retrieval.recall']).toBe(1);
  });
});

describe('scoreRetrieval — offtopic inversion', () => {
  it('passes when nothing retrieved', () => {
    expect(scoreRetrieval([], [], 'offtopic')).toEqual({ 'retrieval.offtopic_pass': 1 });
  });
  it('fails when anything retrieved', () => {
    expect(scoreRetrieval([], ['a'], 'offtopic')).toEqual({ 'retrieval.offtopic_pass': 0 });
  });
});

describe('scoreRetrieval — evergreen (article-agnostic)', () => {
  // Evergreen items ask about themes the blog always covers, with no expected
  // slugs — the KB is a rolling window, so slug-level golden answers rot.
  // The retrieval signal is binary: an on-topic question must surface sources.
  it('hit when anything is retrieved', () => {
    expect(scoreRetrieval([], ['a', 'b'], 'evergreen')).toEqual({ 'retrieval.hit': 1 });
  });
  it('miss when nothing is retrieved', () => {
    expect(scoreRetrieval([], [], 'evergreen')).toEqual({ 'retrieval.hit': 0 });
  });
});
