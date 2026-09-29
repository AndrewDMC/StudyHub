'use client';

import { useEffect, useState } from 'react';
import {
  DENSITIES,
  DENSITY_STORAGE_KEY,
  THEME_CHOICES,
  THEME_STORAGE_KEY,
  parseDensity,
  parseTheme,
  resolveTheme,
  type Density,
  type ThemeChoice,
} from '@/lib/appearance';

const THEME_LABELS: Record<ThemeChoice, string> = {
  system: 'Sistema',
  light: 'Chiaro',
  dark: 'Scuro',
};
const DENSITY_LABELS: Record<Density, string> = {
  comfortable: 'Comoda',
  compact: 'Compatta',
  dense: 'Densa',
};

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // storage blocked: the preference just doesn't persist
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* see read() */
  }
}

function applyTheme(choice: ThemeChoice) {
  const light = window.matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.setAttribute('data-theme', resolveTheme(choice, light));
}

/** Theme + density switches in the top bar. The no-flash script has already applied the stored values. */
export function AppearanceMenu() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>('system');
  const [density, setDensity] = useState<Density>('comfortable');

  useEffect(() => {
    setTheme(parseTheme(read(THEME_STORAGE_KEY)));
    setDensity(parseDensity(read(DENSITY_STORAGE_KEY)));
  }, []);

  // "Sistema" follows the OS live, not just at load.
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const chooseTheme = (next: ThemeChoice) => {
    setTheme(next);
    write(THEME_STORAGE_KEY, next);
    applyTheme(next);
  };
  const chooseDensity = (next: Density) => {
    setDensity(next);
    write(DENSITY_STORAGE_KEY, next);
    document.documentElement.setAttribute('data-density', next);
  };

  const seg = (active: boolean) =>
    `rounded-[var(--radius-control)] border px-2 py-1 text-xs ${
      active
        ? 'border-accent bg-accent-subtle text-fg-primary'
        : 'border-border text-fg-secondary hover:text-fg-primary'
    }`;

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-[var(--radius-control)] border border-border px-2.5 py-1 text-xs text-fg-secondary hover:text-fg-primary"
      >
        Aspetto
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Aspetto"
          className="absolute right-0 top-full z-50 mt-1 w-64 space-y-3 rounded-[var(--radius-card)] border border-border bg-bg-surface p-3 shadow-lg"
        >
          <fieldset>
            <legend className="mb-1 text-[11px] uppercase tracking-wide text-fg-muted">Tema</legend>
            <div className="flex gap-1.5">
              {THEME_CHOICES.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={theme === t}
                  onClick={() => chooseTheme(t)}
                  className={seg(theme === t)}
                >
                  {THEME_LABELS[t]}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-[11px] uppercase tracking-wide text-fg-muted">
              Densità
            </legend>
            <div className="flex gap-1.5">
              {DENSITIES.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={density === d}
                  onClick={() => chooseDensity(d)}
                  className={seg(density === d)}
                >
                  {DENSITY_LABELS[d]}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </div>
  );
}
