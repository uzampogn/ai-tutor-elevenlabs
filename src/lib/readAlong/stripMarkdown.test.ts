import { describe, it, expect } from 'vitest';
import { stripMarkdown } from './stripMarkdown';

describe('stripMarkdown — citation markers (spec/rag-retrieval-citations 02)', () => {
  it('removes a glued marker and its preceding space', () => {
    expect(stripMarkdown('A claim [1]. Next.')).toBe('A claim. Next.');
  });
  it('removes adjacent markers', () => {
    expect(stripMarkdown('Fast [1][2]. Done.')).toBe('Fast. Done.');
  });
  it('keeps a start-of-line marker (same guard as the display side)', () => {
    expect(stripMarkdown('[1] leads the line')).toBe('[1] leads the line');
  });
  it('does not touch 3+ digit brackets', () => {
    expect(stripMarkdown('see [123] here')).toBe('see [123] here');
  });
  it('markdown links still resolve to their text (existing rule wins)', () => {
    expect(stripMarkdown('read [this](https://x.y) now')).toBe('read this now');
  });
});
