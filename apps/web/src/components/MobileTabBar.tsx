'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, CalendarDays, Layers, LayoutDashboard, type LucideIcon } from 'lucide-react';
import { MOBILE_NAV_ITEMS, isActiveNav } from '@/lib/nav';
import { REVIEW_OVERVIEW_KEY, fetchReviewOverview } from '@/lib/reviewOverview';

const ICONS: Record<(typeof MOBILE_NAV_ITEMS)[number]['href'], LucideIcon> = {
  '/': LayoutDashboard,
  '/materie': BookOpen,
  '/ripasso': Layers,
  '/calendario': CalendarDays,
};

/** Cards due today, for the badge on the Ripasso tab (same query as the Ripasso home). */
function useDueCount(): number {
  const { data } = useQuery({
    queryKey: REVIEW_OVERVIEW_KEY,
    queryFn: fetchReviewOverview,
    staleTime: 60_000,
  });
  return data?.totalDue ?? 0;
}

/**
 * Bottom navigation below `md` (docs/09-ripasso-mobile.md §A2), where the sidebar is hidden.
 * A flex child under `<main>`, not `position: fixed`: the page scroll stays inside `<main>` and
 * nothing needs bottom padding to clear it. Pads itself for the home indicator, and hides under
 * the full-screen review session (`html[data-fullscreen]`).
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const due = useDueCount();

  return (
    <nav
      aria-label="Navigazione principale"
      className="shrink-0 border-t border-border bg-bg-surface pb-[env(safe-area-inset-bottom)] md:hidden [html[data-fullscreen]_&]:hidden"
    >
      <ul className="grid grid-cols-4">
        {MOBILE_NAV_ITEMS.map((item) => {
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
                <span className="relative">
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                  {item.href === '/ripasso' && due > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-2.5 -top-1.5 min-w-[18px] rounded-full bg-accent px-1 text-center font-mono text-[10px] font-medium leading-[16px] text-bg-base"
                    >
                      {due > 99 ? '99+' : due}
                    </span>
                  )}
                </span>
                {item.label}
                {item.href === '/ripasso' && due > 0 && (
                  <span className="sr-only">, {due} card in scadenza</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
