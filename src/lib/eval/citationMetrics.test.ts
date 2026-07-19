import { describe, it, expect } from 'vitest';
import { scoreCitations } from './citationMetrics';

describe('scoreCitations — in_range', () => {
  it('all markers within source count → 1', () => {
    expect(scoreCitations('Claim [1]. Other [2].', 2)['citations.in_range']).toBe(1);
  });
  it('marker above source count → 0', () => {
    expect(scoreCitations('Claim [3].', 2)['citations.in_range']).toBe(0);
  });
  it('marker [0] is out of range → 0', () => {
    expect(scoreCitations('Claim [0].', 2)['citations.in_range']).toBe(0);
  });
  it('no retrieval: any marker fails, none passes', () => {
    expect(scoreCitations('Claim [1].', 0)['citations.in_range']).toBe(0);
    expect(scoreCitations('Plain answer.', 0)['citations.in_range']).toBe(1);
  });
  it('no markers with sources available → in_range 1 (valid, just uncited)', () => {
    expect(scoreCitations('Plain answer.', 2)['citations.in_range']).toBe(1);
  });
});

describe('scoreCitations — coverage', () => {
  it('both sources cited → 1; one of two → 0.5', () => {
    expect(scoreCitations('A [1] and B [2].', 2)['citations.coverage']).toBe(1);
    expect(scoreCitations('A [1] only.', 2)['citations.coverage']).toBe(0.5);
  });
  it('duplicate markers count once', () => {
    expect(scoreCitations('A [1], again [1].', 2)['citations.coverage']).toBe(0.5);
  });
  it('omitted when nothing was retrieved', () => {
    expect('citations.coverage' in scoreCitations('Plain.', 0)).toBe(false);
  });
});

describe('scoreCitations — glue round-trip (read-aloud alignment invariant)', () => {
  it('every marker survives gluing as a sentinel', () => {
    expect(scoreCitations('Claim [1]. Adjacent [1][2].', 2)['citations.glue_roundtrip']).toBe(1);
  });
  it('no markers → trivially 1', () => {
    expect(scoreCitations('Plain.', 2)['citations.glue_roundtrip']).toBe(1);
  });
});
