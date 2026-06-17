import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ArticleDrawer from './ArticleDrawer';
import type { Article, ArticleDigest } from '@/lib/types';

const ARTICLE: Article = {
  title: 'Big Post',
  url: 'https://claude.com/blog/big',
  pubDate: '2026-06-10T00:00:00Z',
  description: 'Excerpt.',
  body: 'Body',
  summary: '',
  heroImage: '',
};
const DIGEST: ArticleDigest = {
  tldr: 'Gist',
  takeaways: ['a'],
  whyItMatters: 'w',
  tags: ['T'],
  questions: ['Ask me?'],
};

function renderDrawer(overrides: Partial<React.ComponentProps<typeof ArticleDrawer>> = {}) {
  return render(
    <ArticleDrawer
      article={ARTICLE}
      digest={DIGEST}
      digestsLoaded
      accentColor="#abc"
      open
      onClose={() => {}}
      onAsk={() => {}}
      {...overrides}
    />,
  );
}

describe('ArticleDrawer', () => {
  it('renders the title and the score card', () => {
    renderDrawer();
    expect(screen.getByRole('heading', { name: 'Big Post' })).toBeInTheDocument();
    expect(screen.getByText('Gist')).toBeInTheDocument();
  });

  it('routes a chip click to onAsk', () => {
    const onAsk = vi.fn();
    renderDrawer({ onAsk });
    fireEvent.click(screen.getByRole('button', { name: 'Ask me?' }));
    expect(onAsk).toHaveBeenCalledWith('Ask me?');
  });

  it('closes on Escape when open', () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
