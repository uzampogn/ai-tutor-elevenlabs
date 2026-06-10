import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Regression lock for the "Whiter & Cleaner" UI reskin.
 *
 * Spec: spec/UI-RESKIN-WHITER-CLEANER.md
 *
 * This suite reads the raw globals.css from disk and asserts the LOCKED
 * reskin token values. Any accidental revert of the reskin (e.g. restoring
 * the old cool-blue palette or the radial-gradient accent wash) will fail
 * here, even though the values are pure CSS that no unit test would otherwise
 * exercise.
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

describe('"Whiter & Cleaner" reskin — locked :root token values', () => {
  const tokens: Array<[string, string]> = [
    ['--bg', 'oklch(0.968 0.0015 95)'],
    ['--panel', 'oklch(1 0 0)'],
    ['--panel-2', 'oklch(1 0 0)'],
    ['--ink', 'oklch(0.24 0.006 95)'],
    ['--ink-soft', 'oklch(0.44 0.006 95)'],
    ['--muted', 'oklch(0.60 0.005 95)'],
    ['--faint', 'oklch(0.74 0.004 95)'],
    ['--line', 'oklch(0.915 0.003 95)'],
    ['--line-2', 'oklch(0.95 0.002 95)'],
  ];

  it.each(tokens)('locks %s to %s', (name, value) => {
    expectToken(name, value);
  });
});

describe('"Whiter & Cleaner" reskin — brand accent retained', () => {
  it('keeps --accent: #c75b39', () => {
    expectToken('--accent', '#c75b39');
  });
});

describe('"Whiter & Cleaner" reskin — flat canvas (accent wash removed)', () => {
  it('uses a flat background on .app', () => {
    // Isolate the .app rule block and confirm it paints a flat var(--bg).
    const appBlock = css.match(/\.app\s*\{[^}]*\}/);
    expect(appBlock, 'expected an .app rule block in globals.css').not.toBeNull();
    expect(normalize(appBlock![0])).toContain('background: var(--bg);');
  });

  it('contains no radial-gradient anywhere (accent wash gone)', () => {
    expect(css).not.toContain('radial-gradient');
  });
});

describe('"Whiter & Cleaner" reskin — old cool-blue palette removed', () => {
  it('drops the old --bg value oklch(0.991 0.006 252)', () => {
    expect(css).not.toContain('oklch(0.991 0.006 252)');
  });

  it('contains no hue-252 (cool-blue) artifacts', () => {
    expect(css).not.toContain('252)');
  });
});
