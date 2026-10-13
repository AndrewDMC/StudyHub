/** Top-level sections of the desktop sidebar (AppShell). */
export const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', shortcut: 'G D' },
  { href: '/materie', label: 'Materie', shortcut: 'G M' },
  { href: '/calendario', label: 'Calendario', shortcut: 'G C' },
  { href: '/admin', label: 'Admin', shortcut: 'G A' },
] as const;

/**
 * The phone tab bar (MobileTabBar): Ripasso rapido exists only here and takes Admin's place,
 * which moves to the header's `⋯` menu (docs/09-ripasso-mobile.md §A2).
 */
export const MOBILE_NAV_ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/materie', label: 'Materie' },
  { href: '/ripasso', label: 'Ripasso' },
  { href: '/calendario', label: 'Calendario' },
] as const;

export type NavHref =
  (typeof NAV_ITEMS)[number]['href'] | (typeof MOBILE_NAV_ITEMS)[number]['href'];

/** `/` only matches itself; every other section also owns its sub-routes (`/materie/x/piano`). */
export function isActiveNav(href: NavHref, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
