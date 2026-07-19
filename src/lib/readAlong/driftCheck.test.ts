import { describe, it, expect } from 'vitest';
import { driftCheck } from './driftCheck';

describe('driftCheck', () => {
  const meta = { count: 3, charLengths: [700, 700, 400], alignSecs: [40, 41, 22] };
  it('debug under the threshold', () => {
    expect(driftCheck(103.1, 103.0, meta).level).toBe('debug');
  });
  it('warn past 0.25s drift, message carries the numbers', () => {
    const r = driftCheck(104.0, 103.0, meta);
    expect(r.level).toBe('warn');
    expect(r.message).toContain('delta=1.00s');
    expect(r.message).toContain('chunks=3');
  });
  it('tolerates missing meta (single-chunk / old response)', () => {
    expect(driftCheck(10.2, 10.0, undefined).level).toBe('debug');
  });
});
