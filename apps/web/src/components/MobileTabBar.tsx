'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, CalendarDays, LayoutDashboard, Wrench, type LucideIcon } from 'lucide-react';
import { NAV_ITEMS, isActiveNav, type NavHref } from '@/lib/nav';

const ICONS: Record<NavHref, LucideIcon> = {
  '/': LayoutDashboard,
  '/materie': BookOpen,
  '/calendario': CalendarDays,
  '/admin': Wrench,
};

/**
 * Bottom navigation below `md` (docs/09-ripasso-mobile.md §A2), where the sidebar is hidden.
 * A flex child under `<main>`, not `position: fixed`: the page scroll stays inside `<main>` and
 * nothing needs bottom padding to clear it. Pads itself for the home indicator.
 */
export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigazione principale"
      className="shrink-0 border-t border-border bg-bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-4">
        {NAV_ITEMS.map((item) => {
          const Icon = ICONS[item.href];
          const active = isActiveNav(item.href, pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-120 ${
                  active ? 'text-accent' : 'text-fg-secondary'
                }`}
              >
                <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
