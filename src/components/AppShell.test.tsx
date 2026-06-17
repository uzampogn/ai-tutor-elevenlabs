import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppShell from './AppShell';

beforeEach(() => {
  // AppShell fetches /api/scrape on mount; stub it so the tree mounts cleanly.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ articles: [] }) }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppShell — sidebar toggle wiring', () => {
  it('starts collapsed and toggles the .app class open/closed', async () => {
    const user = userEvent.setup();
    const { container } = render(<AppShell />);
    const app = container.querySelector('.app') as HTMLElement;

    // Default closed.
    expect(app.classList.contains('sidebar-collapsed')).toBe(true);

    // Open.
    await user.click(screen.getByRole('button', { name: 'Expand knowledge base' }));
    expect(app.classList.contains('sidebar-collapsed')).toBe(false);

    // Close again.
    await user.click(screen.getByRole('button', { name: 'Collapse knowledge base' }));
    expect(app.classList.contains('sidebar-collapsed')).toBe(true);
  });
});
