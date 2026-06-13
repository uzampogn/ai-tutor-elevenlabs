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
    '.session-controls',
    '.newchat',
    '.voice-dock-unsupported',
  ];

  it.each(requiredClasses)('contains class %s', (cls) => {
    expect(css, `expected class "${cls}" to be defined in globals.css`).toContain(cls);
  });
});

describe('Conversation-first cleanup (pass 2) — removed chrome is gone', () => {
  // spec/conversation-first-cleanup.md: top bar, voice on/off toggle, welcome
  // badge, and the orb status readout were all removed.
  const removedClasses = [
    '.topbar',
    '.topbar-title',
    '.topbar-sub',
    '.voice-toggle',
    '.welcome-badge',
    '.voice-dock-status',
    '.voice-dock-hint',
  ];

  it.each(removedClasses)('does NOT contain removed class %s', (cls) => {
    expect(css, `class "${cls}" should have been removed in the pass-2 cleanup`).not.toContain(
      cls,
    );
  });

  it('caps the orb at 25vh and applies the −15% --orb-scale (spec/reduce-orb-size.md)', () => {
    // The design cap (248px / 25vh) is preserved; --orb-scale: 0.85 trims the
    // orb 15% to free vertical space for the conversation/text above it.
    expect(normalizedCss, 'expected --orb-scale: 0.85 on .orb').toContain('--orb-scale: 0.85;');
    expect(
      normalizedCss,
      'expected --orb-size capped at min(248px, 25vh) and scaled by --orb-scale',
    ).toContain('--orb-size: calc(min(248px, 25vh) * var(--orb-scale));');
  });
});

describe('Shell layout — .app is a full-width, non-centered grid', () => {
  // Regression lock: spec/layout-fix-sidebar-content-centering.md.
  // The `.app` shell must NOT be capped/centered (no max-width / margin-inline:
  // auto), or the 320px sidebar floats off the viewport's left edge. Extract
  // just the `.app { … }` rule so these assertions can't catch other selectors.
  const appRule = (() => {
    const start = normalizedCss.indexOf('.app {');
    const end = normalizedCss.indexOf('}', start);
    return normalizedCss.slice(start, end + 1);
  })();

  it('keeps the two-column grid (320px 1fr)', () => {
    expect(appRule, 'expected .app to keep grid-template-columns: 320px 1fr').toContain(
      'grid-template-columns: 320px 1fr;',
    );
  });

  it('does NOT center the shell with margin-inline: auto', () => {
    expect(appRule, '.app must not re-introduce margin-inline: auto').not.toContain(
      'margin-inline: auto',
    );
  });

  it('does NOT cap the shell with a max-width', () => {
    expect(appRule, '.app must not re-introduce a max-width cap').not.toContain('max-width:');
  });
});

describe('Welcome composition — text block + orb share main\'s center axis', () => {
  // Regression lock: spec/center-welcome-composition.md.
  // The welcome block is centered on main's axis at --welcome-col (text stays
  // left-aligned inside it) and vertically centered above the docked orb in the
  // welcome state only. Extract the bare `.welcome { … }` rule so these checks
  // can't match `.welcome-title`/`-grid`/`-chip`.
  const welcomeRule = (() => {
    const start = normalizedCss.indexOf('.welcome {');
    const end = normalizedCss.indexOf('}', start);
    return normalizedCss.slice(start, end + 1);
  })();

  it('defines the --welcome-col content-width token (620px)', () => {
    expectToken('--welcome-col', '620px');
  });

  it('centers the welcome block horizontally (margin-inline: auto)', () => {
    expect(welcomeRule, 'expected .welcome to center its block with margin-inline: auto').toContain(
      'margin-inline: auto',
    );
  });

  it('caps the welcome block at --welcome-col', () => {
    expect(welcomeRule, 'expected .welcome max-width: var(--welcome-col)').toContain(
      'max-width: var(--welcome-col)',
    );
  });

  it('vertically centers the thread in the welcome state only (:has scope)', () => {
    expect(
      normalizedCss,
      'expected .scroll:has(.welcome) .thread { margin: auto; } for welcome-only vertical centering',
    ).toContain('.scroll:has(.welcome) .thread { margin: auto; }');
  });
});

describe('Dark-strip backstop — light UA canvas guaranteed', () => {
  // Regression lock for the bottom "dark strip" bug: commit 38cc6e1 lacked the
  // html background-color backstop, so in OS dark mode the transparent root
  // canvas showed through the viewport's bottom gutter. Both of these guards
  // must stay so the strip can never return — even in dark mode or on a
  // partial CSS load.
  it('declares color-scheme: light so the UA never paints dark chrome', () => {
    expect(normalizedCss, 'expected `color-scheme: light;` (light-only design)').toContain(
      'color-scheme: light;',
    );
  });

  it('backstops the root canvas with html { background-color: var(--bg) }', () => {
    expect(normalizedCss, 'expected an html { background-color: var(--bg); } backstop').toContain(
      'html { background-color: var(--bg); }',
    );
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
