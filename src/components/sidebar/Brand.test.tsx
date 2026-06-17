import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Brand from './Brand';

describe('Brand', () => {
  it('renders the product name', () => {
    render(<Brand />);
    expect(screen.getByText('AI News Tutor')).toBeInTheDocument();
  });

  it('no longer renders a duplicate brand mark (the toggle provides it now)', () => {
    const { container } = render(<Brand />);
    expect(container.querySelector('.brand-mark')).toBeNull();
  });
});
