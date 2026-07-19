import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ImpactCard from './ImpactCard';
import { buildSpokenDoc } from '@/lib/readAlong/spokenDoc';

describe('ImpactCard', () => {
  it('renders the impact words as [data-s]-wrapped spans', () => {
    const doc = buildSpokenDoc('Body.\n\n💼 Business Impact\n\nImpact words here.');
    const { container } = render(<ImpactCard doc={doc} />);

    expect(container.querySelector('.impact-text')?.textContent).toBe('Impact words here.');
    const impactSentences = doc.sentences.filter((s) => s.region === 'impact');
    expect(impactSentences.length).toBeGreaterThan(0);
    impactSentences.forEach((s) => {
      expect(container.querySelector(`[data-s="${s.id}"]`)).not.toBeNull();
    });
  });

  it('renders the Business Impact label, span-free', () => {
    const doc = buildSpokenDoc('Body.\n\n💼 Business Impact\n\nSome impact.');
    const { container } = render(<ImpactCard doc={doc} />);
    expect(screen.getByText(/Business Impact/i)).toBeInTheDocument();
    expect(container.querySelector('.impact-label [data-s]')).toBeNull();
    expect(container.querySelector('.impact-label [data-w]')).toBeNull();
  });
});
