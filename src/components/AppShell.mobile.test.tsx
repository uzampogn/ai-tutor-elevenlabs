import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppShell from './AppShell';

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ articles: [] }) }));
});
afterEach(() => vi.unstubAllGlobals());

describe('AppShell — mobile sidebar overlay', () => {
  it('renders no scrim on desktop even when the sidebar is open', async () => {
    mockMatchMedia(false); // desktop
    const user = userEvent.setup();
    const { container } = render(<AppShell />);
    await user.click(screen.getByRole('button', { name: 'Expand knowledge base' }));
    expect(container.querySelector('.scrim')).toBeNull();
  });

  it('renders a scrim on mobile when open, and tapping it closes the sidebar', async () => {
    mockMatchMedia(true); // mobile
    const user = userEvent.setup();
    const { container } = render(<AppShell />);
    const app = container.querySelector('.app') as HTMLElement;

    await user.click(screen.getByRole('button', { name: 'Expand knowledge base' }));
    expect(app.classList.contains('sidebar-collapsed')).toBe(false);
    const scrim = container.querySelector('.scrim') as HTMLElement;
    expect(scrim).not.toBeNull();

    await user.click(scrim);
    expect(app.classList.contains('sidebar-collapsed')).toBe(true);
    expect(container.querySelector('.scrim')).toBeNull();
  });

  it('closes the sidebar on Escape (mobile)', async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();
    const { container } = render(<AppShell />);
    const app = container.querySelector('.app') as HTMLElement;

    await user.click(screen.getByRole('button', { name: 'Expand knowledge base' }));
    expect(app.classList.contains('sidebar-collapsed')).toBe(false);
    await user.keyboard('{Escape}');
    expect(app.classList.contains('sidebar-collapsed')).toBe(true);
  });

  // The KB overlay (z above the drawer) would hide the article drawer on mobile,
  // so opening an article must dismiss the overlay (master→detail). Desktop keeps
  // the sidebar + drawer side by side, so it must NOT close.
  const article = {
    title: 'Test Article', url: 'https://example.com/a', pubDate: '2026-06-18',
    description: 'd', body: 'b', summary: 's', heroImage: '',
  };
  function mockArticlesFetch() {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: unknown) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          String(url).includes('/api/scrape') ? { articles: [article] } : { digests: {} },
      }),
    ));
  }

  it('mobile: opening an article dismisses the KB overlay (master→detail)', async () => {
    mockMatchMedia(true);
    mockArticlesFetch();
    const user = userEvent.setup();
    const { container } = render(<AppShell />);
    const app = container.querySelector('.app') as HTMLElement;

    await user.click(screen.getByRole('button', { name: 'Expand knowledge base' }));
    expect(app.classList.contains('sidebar-collapsed')).toBe(false);
    await user.click(await screen.findByText('Test Article'));
    expect(app.classList.contains('sidebar-collapsed')).toBe(true);
  });

  it('desktop: opening an article keeps the sidebar open (side-by-side)', async () => {
    mockMatchMedia(false);
    mockArticlesFetch();
    const user = userEvent.setup();
    const { container } = render(<AppShell />);
    const app = container.querySelector('.app') as HTMLElement;

    await user.click(screen.getByRole('button', { name: 'Expand knowledge base' }));
    expect(app.classList.contains('sidebar-collapsed')).toBe(false);
    await user.click(await screen.findByText('Test Article'));
    expect(app.classList.contains('sidebar-collapsed')).toBe(false);
  });

  it('tracks visualViewport on mobile and sets --kb-inset', () => {
    mockMatchMedia(true);
    const prevInner = window.innerHeight;
    window.innerHeight = 844; // layout viewport (jsdom defaults to 768)
    const listeners: Record<string, () => void> = {};
    const vv = {
      height: 844, width: 390, offsetTop: 0,
      addEventListener: (e: string, cb: () => void) => { listeners[e] = cb; },
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('visualViewport', vv);
    // window.innerHeight stays 844; shrink the visual viewport => keyboard open.
    render(<AppShell />);
    vv.height = 544;
    listeners['resize']?.();
    expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('300px');
    window.innerHeight = prevInner;
  });
});
