import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DENSITY_STORAGE_KEY,
  NO_FLASH_SCRIPT,
  THEME_STORAGE_KEY,
  parseDensity,
  parseTheme,
  resolveTheme,
} from '../src/lib/appearance';

describe('parse / resolve', () => {
  it('falls back to system theme and comfortable density on anything unknown', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('neon')).toBe('system');
    expect(parseTheme(null)).toBe('system');
    expect(parseDensity('dense')).toBe('dense');
    expect(parseDensity('huge')).toBe('comfortable');
  });

  it('"system" follows the OS, an explicit choice ignores it', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });
});

/** Runs the real inline script against a fake window/document. */
function runNoFlash(stored: Record<string, string>, systemLight: boolean, storageThrows = false) {
  const attrs: Record<string, string> = {};
  const fakeWindow = {
    localStorage: {
      getItem: (k: string) => {
        if (storageThrows) throw new Error('blocked');
        return stored[k] ?? null;
      },
    },
    matchMedia: () => ({ matches: systemLight }),
  };
  const fakeDocument = {
    documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) },
  };
  new Function('window', 'document', NO_FLASH_SCRIPT)(fakeWindow, fakeDocument);
  return attrs;
}

describe('NO_FLASH_SCRIPT agrees with the typed helpers', () => {
  const themes = ['light', 'dark', 'system', 'garbage', undefined] as const;
  const densities = ['comfortable', 'compact', 'dense', 'garbage', undefined] as const;

  for (const t of themes) {
    for (const d of densities) {
      for (const systemLight of [true, false]) {
        it(`theme=${t} density=${d} systemLight=${systemLight}`, () => {
          const stored: Record<string, string> = {};
          if (t) stored[THEME_STORAGE_KEY] = t;
          if (d) stored[DENSITY_STORAGE_KEY] = d;
          const attrs = runNoFlash(stored, systemLight);
          expect(attrs['data-theme']).toBe(resolveTheme(parseTheme(t), systemLight));
          expect(attrs['data-density']).toBe(parseDensity(d));
        });
      }
    }
  }

  it('does not throw when storage is blocked (private mode)', () => {
    expect(() => runNoFlash({}, false, true)).not.toThrow();
  });
});

// ---------------------------------------------------------------- light theme contrast

const css = readFileSync(join(__dirname, '../src/app/globals.css'), 'utf-8');

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries(
    [...block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})[0-9a-fA-F]{0,2};/g)].map((m) => [
      m[1]!,
      m[2]!,
    ]),
  );
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('light theme (docs/05-design-system.md §6: text >= 4.5:1)', () => {
  const dark = tokens(':root {');
  const light = tokens(":root[data-theme='light']");

  it('redefines every color token the dark theme defines', () => {
    const colorTokens = Object.keys(dark).filter((k) => !k.startsWith('radius'));
    for (const k of colorTokens) expect(light[k], `--${k}`).toBeDefined();
  });

  const surfaces = ['bg-base', 'bg-surface', 'bg-raised', 'bg-inset'];
  const texts = [
    'fg-primary',
    'fg-secondary',
    'fg-muted',
    'accent',
    'ok',
    'warn',
    'danger',
    'info',
  ];
  for (const text of texts) {
    for (const surface of surfaces) {
      it(`--${text} on --${surface}`, () => {
        expect(contrast(light[text]!, light[surface]!)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('white text on the accent (primary buttons) stays readable', () => {
    expect(contrast('#ffffff', light.accent!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', light['accent-hover']!)).toBeGreaterThanOrEqual(4.5);
  });
});
