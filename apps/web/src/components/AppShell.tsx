import Link from 'next/link';
import { CommandPalette } from './CommandPalette';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', shortcut: 'G D', enabled: true },
  { href: '/materie', label: 'Materie', shortcut: 'G M', enabled: true },
  { href: '/calendario', label: 'Calendario', shortcut: 'G C', enabled: true },
  { href: '/admin', label: 'Admin', shortcut: 'G A', enabled: true },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
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
          {NAV_ITEMS.map((item) =>
            item.enabled ? (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-sm text-fg-secondary transition-colors duration-120 hover:bg-bg-raised hover:text-fg-primary"
              >
                <span>{item.label}</span>
                <span className="font-mono text-[11px] text-fg-muted">{item.shortcut}</span>
              </Link>
            ) : (
              <span
                key={item.href}
                aria-disabled="true"
                title="Presto disponibile"
                className="flex items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-sm text-fg-muted"
              >
                <span>{item.label}</span>
                <span className="font-mono text-[11px]">{item.shortcut}</span>
              </span>
            ),
          )}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between border-b border-border bg-bg-surface px-4">
          <span className="text-sm text-fg-secondary">StudyHub</span>
          <CommandPalette />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto bg-technical-grid">{children}</main>
      </div>
    </div>
  );
}
