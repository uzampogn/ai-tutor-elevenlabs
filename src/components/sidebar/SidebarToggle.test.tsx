import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SidebarToggle from './SidebarToggle';

describe('SidebarToggle', () => {
  it('labels itself "Expand" and sets aria-expanded=false when closed', () => {
    render(<SidebarToggle open={false} onToggle={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Expand knowledge base' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn).toHaveAttribute('aria-controls', 'kb-sidebar');
  });

  it('labels itself "Collapse" and sets aria-expanded=true when open', () => {
    render(<SidebarToggle open={true} onToggle={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Collapse knowledge base' });
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('calls onToggle when clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<SidebarToggle open={false} onToggle={onToggle} />);
    await user.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
