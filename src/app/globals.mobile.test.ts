import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
const normalize = (s: string) => s.replace(/\s+/g, ' ');
const full = normalize(css);

describe('Mobile viewport fit', () => {
  it('uses 100dvh so the dock clears mobile browser chrome', () => {
    expect(full).toContain('100dvh');
  });
  it('pads the dock for the home-bar safe area', () => {
    expect(full).toContain('env(safe-area-inset-bottom)');
  });
});
