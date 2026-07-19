import { describe, it, expect } from 'vitest';
import { stripMarkdown } from './stripMarkdown';

describe('stripMarkdown emphasis flanking', () => {
  it('strips real emphasis markers', () => {
    expect(stripMarkdown('a **bold** word')).toBe('a bold word');
    expect(stripMarkdown('a __bold__ word')).toBe('a bold word');
    expect(stripMarkdown('an *em* word')).toBe('an em word');
    expect(stripMarkdown('an _em_ word')).toBe('an em word');
    expect(stripMarkdown('(*note*) and _x_')).toBe('(note) and x');
  });

  it('keeps intra-word underscores and asterisks', () => {
    expect(stripMarkdown('The user_id and auth_token fields.')).toBe(
      'The user_id and auth_token fields.',
    );
    expect(stripMarkdown('snake_case_name stays')).toBe('snake_case_name stays');
    expect(stripMarkdown('compute a*b*c fast')).toBe('compute a*b*c fast');
  });

  it('does not pair stray markers across whitespace/lines', () => {
    expect(stripMarkdown('5 * 3 and 4 * 2')).toBe('5 * 3 and 4 * 2');
    expect(stripMarkdown('one _\ntwo _ three')).toBe('one _\ntwo _ three');
  });

  it('is idempotent on every fixture', () => {
    const fixtures = [
      'a **bold** word', 'The user_id and auth_token fields.', '5 * 3 and 4 * 2',
      '## H\n\n- item one\n  - nested\n\n> quote\n\n---\n\n`code` and [t](u) 💼',
    ];
    for (const f of fixtures) {
      const once = stripMarkdown(f);
      expect(stripMarkdown(once)).toBe(once);
    }
  });
});

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
