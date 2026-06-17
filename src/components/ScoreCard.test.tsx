import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScoreCard from './ScoreCard';
import type { ArticleDigest } from '@/lib/types';

const DIGEST: ArticleDigest = {
  tldr: 'The gist.',
  takeaways: ['First', 'Second', 'Third'],
  whyItMatters: 'Because impact.',
  tags: ['Claude', 'MCP', 'Security'],
  questions: ['What is MCP?', 'Why now?'],
};

const noop = () => {};

describe('ScoreCard', () => {
  it('shows a skeleton while digests are loading', () => {
    const { container } = render(
      <ScoreCard digest={null} digestsLoaded={false} description="x" url="u" onAsk={noop} />,
    );
    expect(container.querySelector('.score-card-loading')).toBeInTheDocument();
  });

  it('renders the digest when present', () => {
    render(<ScoreCard digest={DIGEST} digestsLoaded description="x" url="u" onAsk={noop} />);
    expect(screen.getByText('The gist.')).toBeInTheDocument();
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Because impact.')).toBeInTheDocument();
    expect(screen.getByText('MCP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What is MCP?' })).toBeInTheDocument();
  });

  it('calls onAsk with the question when a chip is clicked', () => {
    const onAsk = vi.fn();
    render(<ScoreCard digest={DIGEST} digestsLoaded description="x" url="u" onAsk={onAsk} />);
    fireEvent.click(screen.getByRole('button', { name: 'Why now?' }));
    expect(onAsk).toHaveBeenCalledWith('Why now?');
  });

  it('falls back to the description + original link when digest is null', () => {
    render(
      <ScoreCard digest={null} digestsLoaded description="The summary." url="https://x/a" onAsk={noop} />,
    );
    expect(screen.getByText('The summary.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /original article/i })).toHaveAttribute('href', 'https://x/a');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
