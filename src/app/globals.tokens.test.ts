import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Regression lock for the "Follow the Voice — Companion" world (decision D8;
 * direction contract in .impeccable/surfaces/src-app-page-tsx.md, palette
 * pinned in docs/inspiration/brief.md §4).
 *
 * Reads the raw globals.css from disk and asserts the pinned palette stops,
 * the single type family, the retired Aurora Mist materials staying gone, the
 * orb and read-along classes, and the reduced-motion guard.
 */

const cssPath = resolve(process.cwd(), 'src/app/globals.css');
const css = readFileSync(cssPath, 'utf8');

/** Collapse any run of whitespace to a single space, for tolerant matching. */
const normalize = (s: string) => s.replace(/\s+/g, ' ');
const normalizedCss = normalize(css);

function expectToken(name: string, value: string) {
  expect(normalizedCss, `expected token "${name}: ${value};" in globals.css`).toContain(`${name}: ${value};`);
}

/** The bare `<selector> { … }` rule body, so a check can't match a longer selector. */
function rule(selector: string): string {
  const start = normalizedCss.indexOf(`${selector} {`);
  expect(start, `expected a "${selector} {" rule`).toBeGreaterThan(-1);
  const end = normalizedCss.indexOf('}', start);
  return normalizedCss.slice(start, end + 1);
}

describe('Pinned palette — the sampled stops are declared verbatim', () => {
  const stops: Array<[string, string]> = [
    ['--teal-900', '#194D49'],
    ['--teal-600', '#2E8970'],
    ['--aqua-400', '#52A88D'],
    ['--sage-200', '#9AD1A9'],
    ['--mist-100', '#ABE4D0'],
    ['--lime-200', '#C0E2B0'],
    ['--lime-500', '#A2BA6E'],
    ['--glow-50', '#EEEFCF'],
    ['--peach-200', '#F1C9A7'],
    ['--peach-100', '#FBD8BB'],
  ];
  it.each(stops)('locks %s to %s', (name, value) => expectToken(name, value));

  it('grounds the page on the light anchor and inks it with the dark anchor', () => {
    expectToken('--ground', 'var(--glow-50)');
    expectToken('--ink', 'var(--teal-900)');
  });

  it('mixes every secondary tone from ink and ground — no grey hex', () => {
    for (const t of ['--ink-2', '--ink-3', '--ink-4', '--hair', '--hair-2', '--plane']) {
      const decl = normalizedCss.match(new RegExp(`${t}: ([^;]+);`))?.[1] ?? '';
      expect(decl, `${t} should be a color-mix of ink/ground`).toContain('color-mix(');
      expect(decl, `${t} must not be a hex literal`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });

  it('carries the full gradient on the orb core only', () => {
    const core = rule('.orb-core');
    for (const stop of ['--teal-900', '--teal-600', '--aqua-400', '--sage-200', '--lime-200', '--glow-50', '--peach-200']) {
      expect(core, `orb core should carry ${stop}`).toContain(`var(${stop})`);
    }
    // No other rule strings all of teal → peach together.
    const others = normalizedCss.replace(core, '');
    const fullRun = /var\(--teal-900\)[^}]*var\(--teal-600\)[^}]*var\(--aqua-400\)[^}]*var\(--sage-200\)[^}]*var\(--peach-200\)/;
    expect(others).not.toMatch(fullRun);
  });
});

describe('Type — Google Sans Flex is the only family, named on the root', () => {
  it("declares --font with 'Google Sans Flex' first", () => {
    expect(normalizedCss).toMatch(/--font: 'Google Sans Flex'/);
  });
  it('sets font-family directly on html (no :root/body variable hand-off)', () => {
    expect(rule('html')).toContain('font-family: var(--font)');
    expect(normalizedCss).not.toContain('var(--font-sans)');
    expect(normalizedCss).not.toContain('var(--font-serif)');
  });
  it('uses no monospace and no uppercase meta', () => {
    expect(css).not.toMatch(/monospace/);
    expect(css).not.toMatch(/text-transform: uppercase/);
  });
});

describe('Retired Aurora Mist materials stay gone', () => {
  it('has no frosted glass, no blue accent, no aurora blooms', () => {
    expect(css).not.toContain('backdrop-filter');
    expect(css).not.toContain('#8AB4FF');
    expect(css).not.toContain('#4F7BE8');
    expect(css).not.toContain('#C9B8FF');
    expect(css).not.toContain('#EDF1FB');
    expect(css).not.toContain('--glass');
  });
  it('has no chat bubbles and no floating mode pill', () => {
    for (const cls of ['.bubble-user', '.input-mode-switch', '.voice-dock', '.session-controls', '.newchat', '.ai-avatar']) {
      expect(css, `${cls} should be gone`).not.toContain(cls);
    }
  });
});

describe('Shell — rail · knowledge base · main plane', () => {
  it('keeps the three-track grid with the KB collapsing to nothing', () => {
    expect(rule('.app')).toContain('grid-template-columns: var(--rail) var(--kb) 1fr;');
    expect(rule('.app.sidebar-collapsed')).toContain('grid-template-columns: var(--rail) 0 1fr;');
  });
  it('sizes the rail at 56px and the KB at 300px', () => {
    expectToken('--rail', '56px');
    expectToken('--kb', '300px');
  });
  it('does not centre or cap the shell', () => {
    expect(rule('.app')).not.toContain('margin-inline: auto');
    expect(rule('.app')).not.toContain('max-width:');
  });
});

describe('Welcome composition — the orb centre stage', () => {
  it('defines the 620px welcome column and the orb sizes', () => {
    expectToken('--welcome-col', '620px');
    expectToken('--orb-centre', '144px');
    expectToken('--orb-home', '72px');
  });
  it('centres the welcome block horizontally and, welcome-only, vertically', () => {
    expect(rule('.welcome')).toContain('margin-inline: auto');
    expect(rule('.welcome')).toContain('max-width: var(--welcome-col)');
    expect(normalizedCss).toContain('.scroll:has(.welcome) .thread { margin: auto;');
  });
});

describe('The orb — four poses, a free body, one sparkle', () => {
  it.each(['.orb-stage', '.orb-body', '.orb-core', '.orb-bloom', '.orb-ring', '.orb-spark'])('defines %s', (cls) => {
    expect(css).toContain(cls);
  });
  it('gives each state a static pose outside the motion guard', () => {
    const guardAt = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    const before = css.slice(0, guardAt);
    for (const s of ['listening', 'thinking', 'speaking']) {
      expect(before, `static pose for ${s}`).toContain(`.orb[data-orb-state="${s}"]`);
    }
  });
  it('drifts with transform only (no layout property animation)', () => {
    const body = normalizedCss.slice(normalizedCss.indexOf('.orb-body { transition'));
    const decl = body.slice(0, body.indexOf('}'));
    expect(decl).toContain('transform .4s var(--ease-out-quart)');
    expect(decl).not.toMatch(/width|height|left|top/);
  });
});

describe('Read-along — class toggles, the playhead in the margin', () => {
  it.each(['.s-active', '.s-read'])('defines %s', (cls) => expect(css).toContain(cls));
  it('washes the active sentence with lime and settles read ink from the mix', () => {
    expect(rule('.s-active')).toContain('var(--wash)');
    expect(rule('.s-read')).toContain('var(--ink-2)');
  });
  it('draws the peach playhead and sage read ticks on the [data-s] spans', () => {
    expect(rule('.s-active::before')).toContain('var(--peach-200)');
    expect(rule('.s-read::before')).toContain('var(--sage-200)');
    expect(normalizedCss).toContain('.ai-body .s::before {');
  });
  it('changes only background and colour on the spans (no reflow)', () => {
    for (const r of [rule('.s-active'), rule('.s-read')]) {
      expect(r).not.toMatch(/font-size|font-weight|padding|margin|display/);
    }
  });
});

describe('Light UA canvas and the motion guard', () => {
  it('declares color-scheme: light and backstops the root canvas', () => {
    expect(normalizedCss).toContain('color-scheme: light;');
    expect(rule('html')).toContain('background-color: var(--ground)');
  });
  it('gates every animation behind prefers-reduced-motion: no-preference', () => {
    expect(css).toContain('@media (prefers-reduced-motion: no-preference)');
    const guardAt = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    const before = css.slice(0, guardAt);
    // No `animation:` shorthand outside the guard (keyframes may be declared anywhere).
    expect(before).not.toMatch(/\banimation:\s/);
  });
});
