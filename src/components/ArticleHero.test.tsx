import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ArticleHero from './ArticleHero';

describe('ArticleHero', () => {
  it('renders the image when src is present', () => {
    render(<ArticleHero src="https://x/y.png" alt="Title" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://x/y.png');
  });

  it('shows the drawn placeholder when src is empty', () => {
    render(<ArticleHero src="" alt="Title" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Article preview')).toBeInTheDocument();
  });

  it('falls back to the drawn placeholder when the image fails to load', () => {
    render(<ArticleHero src="https://x/broken.png" alt="Title" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Article preview')).toBeInTheDocument();
  });
});
