import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import InlineMarkdown from './InlineMarkdown';

describe('InlineMarkdown', () => {
  it('renders **x** as a <strong>', () => {
    const { container } = render(<InlineMarkdown text="**x**" />);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong).toHaveTextContent('x');
  });

  it('renders *y* as an <em>', () => {
    const { container } = render(<InlineMarkdown text="*y*" />);
    const em = container.querySelector('em');
    expect(em).not.toBeNull();
    expect(em).toHaveTextContent('y');
  });

  it('renders _z_ as an <em>', () => {
    const { container } = render(<InlineMarkdown text="_z_" />);
    expect(container.querySelector('em')).toHaveTextContent('z');
  });

  it('passes plain text through without emphasis tags', () => {
    const { container } = render(<InlineMarkdown text="just plain text" />);
    expect(screen.getByText('just plain text')).toBeInTheDocument();
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('em')).toBeNull();
  });
});