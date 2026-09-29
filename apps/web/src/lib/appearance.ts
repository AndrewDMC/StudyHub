/**
 * Theme and density preferences (docs/05-design-system.md §2, §5): three densities and a light
 * theme that is complete, not a fallback. Kept in `localStorage` — a per-browser display
 * preference, not data worth a DB row — and applied as `data-theme`/`data-density` on `<html>`.
 */
export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];
export type ResolvedTheme = 'light' | 'dark';

export const DENSITIES = ['comfortable', 'compact', 'dense'] as const;
export type Density = (typeof DENSITIES)[number];

export const THEME_STORAGE_KEY = 'studyhub-theme';
export const DENSITY_STORAGE_KEY = 'studyhub-density';

export function parseTheme(raw: unknown): ThemeChoice {
  return THEME_CHOICES.find((t) => t === raw) ?? 'system';
}

export function parseDensity(raw: unknown): Density {
  return DENSITIES.find((d) => d === raw) ?? 'comfortable';
}

export function resolveTheme(choice: ThemeChoice, systemPrefersLight: boolean): ResolvedTheme {
  if (choice === 'system') return systemPrefersLight ? 'light' : 'dark';
  return choice;
}

/**
 * Runs before first paint (inlined in `<head>`) so a light-theme user never sees a dark flash.
 * Self-contained on purpose — it cannot import anything — so it mirrors `parse*`/`resolveTheme`;
 * `appearance.test.ts` executes this exact string against them to keep the two from drifting.
 */
export const NO_FLASH_SCRIPT = `(function(){try{var d=document.documentElement,s=window.localStorage;var t=s.getItem('${THEME_STORAGE_KEY}'),n=s.getItem('${DENSITY_STORAGE_KEY}');if(t!=='light'&&t!=='dark')t='system';if(n!=='compact'&&n!=='dense')n='comfortable';var light=t==='light'||(t==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches);d.setAttribute('data-theme',light?'light':'dark');d.setAttribute('data-density',n);}catch(e){}})();`;
