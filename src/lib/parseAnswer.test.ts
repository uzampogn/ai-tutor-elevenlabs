import { describe, it, expect } from 'vitest';
import { parseAnswer, matchSources, parseInline } from './parseAnswer';
import type { Article } from './scraper';

const article = (over: Partial<Article> = {}): Article => ({
  title: 'Introducing Claude Opus 4.8',
  url: 'https://www.anthropic.com/news/claude-opus-4-8',
  pubDate: 'Mon, 02 Jun 2026 00:00:00 GMT',
  description: 'A new model.',
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
