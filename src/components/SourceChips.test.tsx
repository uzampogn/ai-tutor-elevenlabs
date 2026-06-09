import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SourceChips from './SourceChips';
import type { Article } from '@/lib/types';

const article = (over: Partial<Article> = {}): Article => ({
  title: 'Claude 4 released',
  url: 'https://www.anthropic.com/news/claude-4',
  pubDate: 'Tue, 03 Jun 2025 00:00:00 GMT',
  description: 'desc',
  ...over,
});

describe('SourceChips', () => {
  it('renders one link per source with correct href and target/rel', () => {
    const sources = [
      article(),
      article({ title: 'New research', url: 'https://www.anthropic.com/research/x' }),
    ];
    render(<SourceChips sources={sources} />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);

    const first = screen.getByRole('link', { name: /Claude 4 released/ });
    expect(first).toHaveAttribute('href', 'https://www.anthropic.com/news/claude-4');
    expect(first).toHaveAttribute('target', '_blank');
    expect(first.getAttribute('rel')).toContain('noopener');
    expect(first.getAttribute('rel')).toContain('noreferrer');
  });

  it('renders nothing (no links) when sources is empty', () => {
    render(<SourceChips sources={[]} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});