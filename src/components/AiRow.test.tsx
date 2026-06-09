import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AiRow from './AiRow';
import type { Article } from '@/lib/types';

const article = (over: Partial<Article> = {}): Article => ({
  title: 'Claude Opus 4 launch',
  url: 'https://www.anthropic.com/news/claude-opus-4',
  pubDate: 'Tue, 03 Jun 2025 00:00:00 GMT',
  description: 'desc',
  ...over,
});

describe('AiRow', () => {
  it('renders the impact text and an ImpactCard when content has a Business Impact section', () => {
    const content =
      'Here is the main explanation of the topic.\n\n💼 Business Impact\n\nThis reshapes enterprise budgets.';
    render(<AiRow content={content} streaming={false} articles={[]} onReadAloud={() => {}} />);

    expect(screen.getByText('This reshapes enterprise budgets.')).toBeInTheDocument();
    // The ImpactCard label only appears when the card renders.
    expect(screen.getByText(/Business Impact/i)).toBeInTheDocument();
    expect(screen.getByText('Here is the main explanation of the topic.')).toBeInTheDocument();
  });

  it('renders no impact card when content has no Business Impact section', () => {
    const content = 'Just a plain answer with no special section.';
    render(<AiRow content={content} streaming={false} articles={[]} onReadAloud={() => {}} />);

    expect(screen.queryByText(/Business Impact/i)).toBeNull();
    expect(screen.getByText('Just a plain answer with no special section.')).toBeInTheDocument();
  });

  it('renders a source link when content mentions an article title', () => {
    const articles = [article()];
    const content = 'The Claude Opus 4 launch was a major step forward for the industry.';
    render(<AiRow content={content} streaming={false} articles={articles} onReadAloud={() => {}} />);

    const link = screen.getByRole('link', { name: /Claude Opus 4 launch/ });
    expect(link).toHaveAttribute('href', 'https://www.anthropic.com/news/claude-opus-4');
  });

  it('renders no source links when no article titles match', () => {
    const articles = [article()];
    const content = 'An unrelated answer mentioning nothing in the knowledge base.';
    render(<AiRow content={content} streaming={false} articles={articles} onReadAloud={() => {}} />);

    expect(screen.queryByRole('link')).toBeNull();
  });
});