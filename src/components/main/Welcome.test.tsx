import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Welcome from './Welcome';
import { SUGGESTED } from '@/lib/types';

describe('Welcome', () => {
  it('renders all 4 suggested questions as buttons', () => {
    render(<Welcome onAsk={() => {}} />);
    for (const q of SUGGESTED) {
      expect(screen.getByRole('button', { name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeInTheDocument();
    }
    expect(SUGGESTED).toHaveLength(4);
  });

  it('does not render the "Live knowledge base" badge', () => {
    render(<Welcome onAsk={() => {}} />);
    expect(screen.queryByText(/live knowledge base/i)).toBeNull();
    expect(document.querySelector('.welcome-badge')).toBeNull();
  });

  it('calls onAsk with the exact question string when a chip is clicked', async () => {
    const user = userEvent.setup();
    const onAsk = vi.fn();
    render(<Welcome onAsk={onAsk} />);

    const target = SUGGESTED[1];
    await user.click(screen.getByText(target));

    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledWith(target);
  });
});