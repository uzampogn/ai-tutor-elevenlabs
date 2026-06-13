import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Regression lock for the "Aurora Mist" conversation-first redesign.
 *
 * Spec: spec/conversation-first-redesign.md
 *
 * This suite reads the raw globals.css from disk and asserts the LOCKED
 * Aurora Mist token values and structural guarantees (radial-gradient aurora
 * background, frosted-glass backdrop-filter, orb/dock CSS classes, and
 * reduced-motion guard). Any accidental revert to the old warm cream/terracotta
 * palette will fail here immediately.
 *
 * NOTE: This test reads globals.css from disk. If the design agent has not yet
 * landed the Aurora Mist CSS, this suite will fail — that is expected and fine.
 * The test is written against the final contract; it will go green once the CSS
 * lands.
 */

// Read the raw stylesheet from disk so this test locks the on-disk CSS,
// not a bundled/transformed version. Resolved from the project root
// (vitest runs with cwd at the project root).
const cssPath = resolve(process.cwd(), 'src/app/globals.css');
const css = readFileSync(cssPath, 'utf8');

/** Collapse any run of whitespace to a single space, for tolerant matching. */
const normalize = (s: string) => s.replace(/\s+/g, ' ');
const normalizedCss = normalize(css);

/** Assert a `--token: value;` declaration is present, tolerant of whitespace. */
function expectToken(name: string, value: string) {
  expect(
    normalizedCss,
    `expected token "${name}: ${value};" to be present in globals.css`,
  ).toContain(`${name}: ${value};`);
}

describe('Aurora Mist — locked :root token values', () => {
  const tokens: Array<[string, string]> = [
    ['--ink',          '#1B2236'],
    ['--ink-soft',     '#4A5470'],
    ['--muted',        '#7C86A0'],
    ['--faint',        '#9AA3BD'],
    ['--accent',       '#8AB4FF'],
    ['--accent-strong','#4F7BE8'],
    ['--accent-2',     '#C9B8FF'],
    ['--line',         '#E1E7F4'],
    ['--line-2',       '#EEF2FB'],
    ['--bg',           '#EDF1FB'],
    ['--panel',        '#FFFFFF'],
    ['--panel-2',      '#FFFFFF'],
  ];

  it.each(tokens)('locks %s to %s', (name, value) => {
    expectToken(name, value);
  });
});

describe('Aurora Mist — aurora background present', () => {
  it('uses a radial-gradient aurora background (not flat)', () => {
    expect(css, 'expected radial-gradient for aurora background').toContain('radial-gradient');
  });

  it('contains backdrop-filter for frosted glass surfaces', () => {
    expect(css, 'expected backdrop-filter for frosted glass').toContain('backdrop-filter');
  });
});

describe('Aurora Mist — old warm palette removed', () => {
  it('does NOT contain the old terracotta accent #c75b39', () => {
    expect(css, 'old terracotta accent #c75b39 must be absent').not.toContain('#c75b39');
  });
});

describe('Aurora Mist — orb and dock CSS classes present', () => {
  const requiredClasses = [
    '.orb-core',
    '.orb-bloom',
    '.orb-ring',
    '.input-mode-switch',
    '.voice-dock',
  ];

  it.each(requiredClasses)('contains class %s', (cls) => {
    expect(css, `expected class "${cls}" to be defined in globals.css`).toContain(cls);
  });
});

describe('Aurora Mist — motion guard present', () => {
  it('contains @media (prefers-reduced-motion: no-preference) guard for animations', () => {
    expect(
      css,
      'expected @media (prefers-reduced-motion: no-preference) guard',
    ).toContain('@media (prefers-reduced-motion: no-preference)');
  });
});
