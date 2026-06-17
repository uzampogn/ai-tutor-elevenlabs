import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import AppShell from './AppShell';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (String(url).includes('/api/digest')) {
        return Promise.resolve({ ok: true, json: async () => ({ digests: {} }) });
      }
      // /api/scrape and anything else
      return Promise.resolve({ ok: true, json: async () => ({ articles: [] }) });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('AppShell — digest prefetch', () => {
  it('fetches /api/digest on mount', async () => {
    render(<AppShell />);
    await waitFor(() =>
      expect(
        (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some((c) =>
          String(c[0]).includes('/api/digest'),
        ),
      ).toBe(true),
    );
  });
});
