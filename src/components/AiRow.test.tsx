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
    render(<AiRow content={content} streaming={false} articles={[]} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />);

    expect(screen.getByText('This reshapes enterprise budgets.')).toBeInTheDocument();
    // The ImpactCard label only appears when the card renders.
    expect(screen.getByText(/Business Impact/i)).toBeInTheDocument();
    expect(screen.getByText('Here is the main explanation of the topic.')).toBeInTheDocument();
  });

  it('renders no impact card when content has no Business Impact section', () => {
    const content = 'Just a plain answer with no special section.';
    render(<AiRow content={content} streaming={false} articles={[]} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />);

    expect(screen.queryByText(/Business Impact/i)).toBeNull();
    expect(screen.getByText('Just a plain answer with no special section.')).toBeInTheDocument();
  });

  it('renders a source link when content mentions an article title', () => {
    const articles = [article()];
    const content = 'The Claude Opus 4 launch was a major step forward for the industry.';
    render(<AiRow content={content} streaming={false} articles={articles} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />);

    const link = screen.getByRole('link', { name: /Claude Opus 4 launch/ });
    expect(link).toHaveAttribute('href', 'https://www.anthropic.com/news/claude-opus-4');
  });

  it('renders no source links when no article titles match', () => {
    const articles = [article()];
    const content = 'An unrelated answer mentioning nothing in the knowledge base.';
    render(<AiRow content={content} streaming={false} articles={articles} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />);

    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders ul list items for bullet-point content, not raw "- " text', () => {
    const content = '- item one\n- item two';
    render(<AiRow content={content} streaming={false} articles={[]} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('item one');
    expect(items[1].textContent).toBe('item two');
    expect(screen.queryByText(/^- /)).toBeNull();
  });

  it('renders a grouped label as a <p> and its bullets as <li>, with no raw "- " text', () => {
    const content = '**🛠️ Developer Tools**\n- alpha release\n- beta access';
    const { container } = render(<AiRow content={content} streaming={false} articles={[]} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />);

    const para = container.querySelector('p.ai-para');
    expect(para).not.toBeNull();
    expect(para?.textContent).toContain('Developer Tools');

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('alpha release');
    expect(items[1].textContent).toBe('beta access');
    expect(screen.queryByText(/^- /)).toBeNull();
  });

  it('renders an ol for numbered list content', () => {
    const content = '1. first\n2. second';
    const { container } = render(<AiRow content={content} streaming={false} articles={[]} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />);

    const ol = container.querySelector('ol');
    expect(ol).not.toBeNull();
    const items = screen.getAllByRole('listitem');
    expect(items[0].textContent).toBe('first');
    expect(items[1].textContent).toBe('second');
  });
});