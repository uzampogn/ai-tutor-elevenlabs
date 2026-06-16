import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KbCard from './KbCard';
import type { Article } from '@/lib/types';

const article: Article = {
  title: 'Anthropic publishes new safety research',
  url: 'https://www.anthropic.com/research/safety',
  pubDate: 'Tue, 03 Jun 2025 00:00:00 GMT',
  description: 'desc',
  body: 'full body',
  summary: 'summary',
};

describe('KbCard', () => {
  it('renders the article title', () => {
    render(<KbCard article={article} index={0} active={false} onOpen={() => {}} />);
    expect(screen.getByText(article.title)).toBeInTheDocument();
  });

  it('calls onOpen when the card is clicked', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<KbCard article={article} index={0} active={false} onOpen={onOpen} />);
    await user.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});