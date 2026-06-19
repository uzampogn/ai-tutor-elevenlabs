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

/** Extract just the `@media (max-width: 880px) { … }` block (brace-balanced). */
function block880(src: string): string {
  const at = src.indexOf('@media (max-width: 880px)');
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(open, j + 1);
  }
  return '';
}
const mobile880 = normalize(block880(css));

describe('Mobile sidebar overlay', () => {
  it('no longer hides the sidebar or its toggle', () => {
    expect(mobile880).not.toContain('.sidebar { display: none');
    expect(mobile880).not.toContain('.sidebar-toggle { display: none');
  });
  it('promotes the sidebar to a fixed slide-in overlay', () => {
    expect(mobile880).toContain('position: fixed');
    expect(mobile880).toContain('translateX(-100%)');
  });
  it('defines the scrim', () => {
    expect(mobile880).toContain('.scrim');
  });
});

describe('Mobile touch targets & drawer', () => {
  it('bumps mic/send buttons to a 44px target', () => {
    expect(mobile880).toContain('.mic-btn, .send-btn { width: 44px; height: 44px');
  });
  it('insets the drawer for the safe area', () => {
    expect(mobile880).toContain('.drawer-inner');
    expect(mobile880).toContain('env(safe-area-inset-bottom)');
  });
});
