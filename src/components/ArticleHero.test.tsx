import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ArticleHero from './ArticleHero';

describe('ArticleHero', () => {
  it('renders the image when src is present', () => {
    render(<ArticleHero src="https://x/y.png" alt="Title" accentColor="#abc" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://x/y.png');
  });

  it('shows the gradient fallback when src is empty', () => {
    render(<ArticleHero src="" alt="Title" accentColor="#abc" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Article preview')).toBeInTheDocument();
  });

  it('falls back to the gradient when the image fails to load', () => {
    render(<ArticleHero src="https://x/broken.png" alt="Title" accentColor="#abc" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Article preview')).toBeInTheDocument();
  });
});
