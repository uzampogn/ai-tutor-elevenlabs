import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ImpactCard from './ImpactCard';

describe('ImpactCard', () => {
  it('renders the given text', () => {
    render(<ImpactCard text="This changes enterprise pricing." />);
    expect(screen.getByText('This changes enterprise pricing.')).toBeInTheDocument();
  });

  it('renders the Business Impact label', () => {
    render(<ImpactCard text="Some impact." />);
    expect(screen.getByText(/Business Impact/i)).toBeInTheDocument();
  });
});