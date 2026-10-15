'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS } from '@/lib/nav';
import { AppearanceMenu } from './AppearanceMenu';
import { CommandPalette } from './CommandPalette';
import { MobileMoreMenu } from './MobileMoreMenu';
import { MobileTabBar } from './MobileTabBar';

export function AppShell({ children }: { children: React.ReactNode }) {
  // Below md the subject page and the redesigned document routes (testo, originale, verifica)
  // bring their own header: the global one goes.
  const inSubject = /^\/materie\/[^/]+(\/documenti\/[^/]+(\/(originale|verifica))?)?\/?$/.test(
    usePathname() ?? '',
  );
  return (
    <div className="flex h-dvh w-full bg-bg-base text-fg-primary">
      <aside
        className="hidden w-60 shrink-0 flex-col border-r border-border bg-bg-surface md:flex"
        aria-label="Navigazione principale"
      >
        <div className="flex h-12 items-center border-b border-border px-4">
          <span className="text-sm font-semibold tracking-[-0.02em]">StudyHub</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-sm text-fg-secondary transition-colors duration-120 hover:bg-bg-raised hover:text-fg-primary"
            >
              <span>{item.label}</span>
              <span className="font-mono text-[11px] text-fg-muted">{item.shortcut}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Under a translucent iOS status bar (standalone PWA) the header starts below the notch. */}
        <header
          className={`shrink-0 border-b border-border bg-bg-surface pt-[env(safe-area-inset-top)]${
            inSubject ? ' max-md:hidden' : ''
          }`}
        >
          <div className="flex h-12 items-center justify-between px-4">
            <span className="text-sm font-semibold tracking-[-0.02em] text-fg-primary md:font-normal md:tracking-normal md:text-fg-secondary">
              StudyHub
            </span>
            <div className="flex items-center gap-2">
              <AppearanceMenu />
              {/* ⌘K needs a keyboard: on a phone the tab bar is the navigation. */}
              <div className="hidden md:block">
                <CommandPalette />
              </div>
              <div className="-mr-2 md:hidden">
                <MobileMoreMenu />
              </div>
            </div>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-technical-grid">
          {children}
        </main>
        <MobileTabBar />
      </div>
    </div>
  );
}
