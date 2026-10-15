'use client';

import type { ReactNode } from 'react';

/** Section wrapper of the mobile overview: 12px uppercase label + optional trailing link/action. */
export function MobileSection({
  title,
  action,
  busy,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-busy={busy || undefined}>
      <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-[0.06em] text-fg-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SkeletonRows({ count }: { count: number }) {
  return (
    <div aria-hidden="true" className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-[var(--radius-card)] bg-bg-raised" />
      ))}
    </div>
  );
}

export function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-[var(--radius-card)] border border-danger bg-bg-surface p-3 text-sm"
    >
      <p className="text-danger">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-11 rounded-[var(--radius-control)] border border-border px-4 text-sm text-fg-primary"
      >
        Riprova
      </button>
    </div>
  );
}

export function SectionEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-4 text-center text-sm text-fg-muted">
      {children}
    </div>
  );
}
