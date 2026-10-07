/** Top-level sections: the desktop sidebar (AppShell) and the mobile tab bar (MobileTabBar). */
export const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', shortcut: 'G D' },
  { href: '/materie', label: 'Materie', shortcut: 'G M' },
  { href: '/calendario', label: 'Calendario', shortcut: 'G C' },
  { href: '/admin', label: 'Admin', shortcut: 'G A' },
] as const;

export type NavHref = (typeof NAV_ITEMS)[number]['href'];

/** `/` only matches itself; every other section also owns its sub-routes (`/materie/x/piano`). */
export function isActiveNav(href: NavHref, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
