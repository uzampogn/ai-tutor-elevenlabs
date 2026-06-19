import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const cssPath = resolve(process.cwd(), 'src/app/globals.css');
const baselinePath = resolve(process.cwd(), 'src/app/globals.desktop-baseline.css');

/**
 * Remove every brace-balanced `@media (...max-width...) { ... }` block.
 * Keeps all other CSS, including the global `@media (prefers-reduced-motion:
 * no-preference)` block (desktop-relevant) — only mobile-scoped media queries
 * are stripped. Mobile reduced-motion transitions therefore MUST use the
 * combined `@media (max-width: 880px) and (prefers-reduced-motion: …)` query.
 */
export function stripMaxWidthMedia(css: string): string {
  let out = '';
  for (let i = 0; i < css.length; ) {
    if (css.startsWith('@media', i)) {
      const open = css.indexOf('{', i);
      const cond = open === -1 ? '' : css.slice(i, open);
      if (open !== -1 && cond.includes('max-width')) {
        let depth = 0;
        let j = open;
        for (; j < css.length; j++) {
          if (css[j] === '{') depth++;
          else if (css[j] === '}' && --depth === 0) { j++; break; }
        }
        i = j;
        continue;
      }
    }
    out += css[i++];
  }
  return out;
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('stripMaxWidthMedia', () => {
  it('removes max-width blocks but keeps reduced-motion blocks', () => {
    const css = `
      .a { color: red; }
      @media (max-width: 880px) { .a { color: blue; } }
      @media (prefers-reduced-motion: no-preference) { .a { transition: 1s; } }
    `;
    const out = stripMaxWidthMedia(css);
    expect(out).toContain('.a { color: red; }');
    expect(out).toContain('prefers-reduced-motion');
    expect(out).not.toContain('color: blue');
  });

  it('strips a combined max-width + reduced-motion query', () => {
    const css = `@media (max-width: 880px) and (prefers-reduced-motion: no-preference) { .x { transition: 1s; } }`;
    expect(stripMaxWidthMedia(css)).not.toContain('.x');
  });
});

describe('Desktop CSS is byte-stable (no edits outside max-width media queries)', () => {
  const desktopScope = stripMaxWidthMedia(readFileSync(cssPath, 'utf8'));

  // First run (or explicit refresh) freezes the current desktop-scope CSS.
  if (process.env.UPDATE_DESKTOP_BASELINE || !existsSync(baselinePath)) {
    writeFileSync(baselinePath, desktopScope, 'utf8');
  }

  it('matches the committed desktop baseline', () => {
    const baseline = readFileSync(baselinePath, 'utf8');
    expect(normalize(desktopScope)).toBe(normalize(baseline));
  });
});
