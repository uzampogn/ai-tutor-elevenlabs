import { describe, it, expect } from 'vitest';
import { parseAnswer, matchSources, parseInline, parseBlocks } from './parseAnswer';
import type { Article } from './scraper';

const article = (over: Partial<Article> = {}): Article => ({
  title: 'Introducing Claude Opus 4.8',
  url: 'https://www.anthropic.com/news/claude-opus-4-8',
  pubDate: 'Mon, 02 Jun 2026 00:00:00 GMT',
  description: 'A new model.',
  body: 'A new model. Full body text.',
  summary: 'A new model summary.',
  ...over,
});

describe('parseAnswer', () => {
  it('splits body and impact on a 💼 Business Impact heading', () => {
    const md = 'Claude got faster.\n\n💼 Business Impact\nTeams ship sooner.';
    const { body, impact } = parseAnswer(md);
    expect(body).toBe('Claude got faster.');
    expect(impact).toBe('Teams ship sooner.');
  });

  it('matches the heading without the emoji and case-insensitively', () => {
    const { body, impact } = parseAnswer('Intro text.\n\nbusiness impact\nThe money part.');
    expect(body).toBe('Intro text.');
    expect(impact).toBe('The money part.');
  });

  it('matches a markdown-styled heading (## / ** / trailing colon)', () => {
    const a = parseAnswer('A.\n\n## Business Impact:\nX.');
    expect(a.impact).toBe('X.');
    const b = parseAnswer('A.\n\n**Business Impact**\nY.');
    expect(b.impact).toBe('Y.');
  });

  it('returns impact null when no heading is present (streaming-safe)', () => {
    const { body, impact } = parseAnswer('Just an answer still streaming in');
    expect(body).toBe('Just an answer still streaming in');
    expect(impact).toBeNull();
  });

  it('handles empty / whitespace input', () => {
    expect(parseAnswer('')).toEqual({ body: '', impact: null });
    expect(parseAnswer('   \n  ')).toEqual({ body: '', impact: null });
  });
});

describe('matchSources', () => {
  const articles = [
    article({ title: 'Introducing Claude Opus 4.8', url: 'https://a/1' }),
    article({ title: 'Constitutional AI explained', url: 'https://a/2' }),
    article({ title: 'Economic Index Q2', url: 'https://a/3' }),
  ];

  it('returns articles whose title appears in the answer', () => {
    const answer = 'As covered in Introducing Claude Opus 4.8, the model is faster.';
    const found = matchSources(answer, articles);
    expect(found).toHaveLength(1);
    expect(found[0].url).toBe('https://a/1');
  });

  it('matches case-insensitively', () => {
    const found = matchSources('see constitutional ai explained for details', articles);
    expect(found.map((a) => a.url)).toContain('https://a/2');
  });

  it('returns [] when nothing matches', () => {
    expect(matchSources('a totally unrelated answer', articles)).toEqual([]);
  });

  it('does not return duplicates when a title appears twice', () => {
    const answer = 'Economic Index Q2 ... and again Economic Index Q2.';
    const found = matchSources(answer, articles);
    expect(found.filter((a) => a.url === 'https://a/3')).toHaveLength(1);
  });
});

describe('parseBlocks', () => {
  it('returns a single paragraph block for plain text', () => {
    const blocks = parseBlocks('Hello world');
    expect(blocks).toEqual([{ type: 'paragraph', text: 'Hello world' }]);
  });

  it('parses two ul blocks separated by a blank line', () => {
    const blocks = parseBlocks('- a\n- b\n\n- c\n- d');
    expect(blocks).toEqual([
      { type: 'ul', items: ['a', 'b'] },
      { type: 'ul', items: ['c', 'd'] },
    ]);
  });

  it('parses an ol block', () => {
    const blocks = parseBlocks('1. a\n2. b');
    expect(blocks).toEqual([{ type: 'ol', items: ['a', 'b'] }]);
  });

  it('returns [paragraph, ul] for mixed text + list', () => {
    const blocks = parseBlocks('Some intro\n\n- a\n- b');
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'Some intro' },
      { type: 'ul', items: ['a', 'b'] },
    ]);
  });

  it('handles a partial/streaming bullet list without crashing', () => {
    expect(() => parseBlocks('- first item\n- second item')).not.toThrow();
    const blocks = parseBlocks('- first item\n- second item');
    expect(blocks[0].type).toBe('ul');
  });

  it('returns [] for empty input', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks('   ')).toEqual([]);
  });

  it('supports * as a ul prefix', () => {
    const blocks = parseBlocks('* x\n* y');
    expect(blocks).toEqual([{ type: 'ul', items: ['x', 'y'] }]);
  });

  it('groups a label line + bullets (no blank line) into [paragraph, ul]', () => {
    const blocks = parseBlocks('**Developer Tools**\n- a\n- b');
    expect(blocks).toEqual([
      { type: 'paragraph', text: '**Developer Tools**' },
      { type: 'ul', items: ['a', 'b'] },
    ]);
  });

  it('splits a mixed ol + ul run within one chunk into [ol, ul]', () => {
    const blocks = parseBlocks('1. a\n2. b\n- c\n- d');
    expect(blocks).toEqual([
      { type: 'ol', items: ['a', 'b'] },
      { type: 'ul', items: ['c', 'd'] },
    ]);
  });

  it('groups single-newline-separated bullets into one ul', () => {
    const blocks = parseBlocks('- a\n- b\n- c');
    expect(blocks).toEqual([{ type: 'ul', items: ['a', 'b', 'c'] }]);
  });

  it('does not crash on a trailing partial line after bullets', () => {
    expect(() => parseBlocks('- a\n- b\nSome trailing prose')).not.toThrow();
    const blocks = parseBlocks('- a\n- b\nSome trailing prose');
    expect(blocks).toEqual([
      { type: 'ul', items: ['a', 'b'] },
      { type: 'paragraph', text: 'Some trailing prose' },
    ]);
  });
});

describe('parseInline', () => {
  it('parses bold', () => {
    const toks = parseInline('hello **world**');
    expect(toks).toContainEqual({ type: 'strong', value: 'world' });
    expect(toks[0]).toEqual({ type: 'text', value: 'hello ' });
  });

  it('parses italics with * and _', () => {
    expect(parseInline('*a*')).toContainEqual({ type: 'em', value: 'a' });
    expect(parseInline('_b_')).toContainEqual({ type: 'em', value: 'b' });
  });

  it('passes plain text through as a single text token', () => {
    expect(parseInline('nothing special')).toEqual([
      { type: 'text', value: 'nothing special' },
    ]);
  });
});
