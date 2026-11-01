'use client';

import Link from 'next/link';
import { DailyTasksPanel } from '../DailyTasksPanel';
import type { FixRow, FixTone } from '../overview/model';
import { SectionError, SkeletonRows } from './SectionState';

const TONE: Record<FixTone, string> = {
  warn: 'border-warn/40 bg-warn/5',
  danger: 'border-danger/40 bg-danger/5',
  info: 'border-info/40 bg-info/5',
};

/** "Da sistemare": what keeps lessons from happening, plus the overdue tasks ("Debito"). */
export function MobileFixList({
  slug,
  rows,
  hasDebt,
  loading,
  error,
  onRetry,
}: {
  slug: string;
  rows: FixRow[];
  hasDebt: boolean;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  if (!loading && !error && rows.length === 0 && !hasDebt) return null;
  return (
    <section
      data-testid="overview-fix"
      aria-labelledby="m-fix"
      aria-busy={loading || undefined}
      className="flex min-w-0 flex-col gap-2"
    >
      <h2 id="m-fix" className="text-xs font-medium uppercase tracking-[0.05em] text-fg-secondary">
        Da sistemare
      </h2>
      {loading && <SkeletonRows count={1} />}
      {error && <SectionError message="Impossibile caricare gli avvisi." onRetry={onRetry} />}
      {!loading &&
        !error &&
        rows.map((row) => (
          <Link
            key={row.id}
            href={row.action.href}
            aria-label={`${row.title}. ${row.action.label}`}
            className={`flex min-h-[60px] items-center gap-3 rounded-[var(--radius-card)] border px-4 py-2.5 ${TONE[row.tone]}`}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium text-fg-primary">{row.title}</span>
              {row.detail && <span className="text-[13px] text-fg-secondary">{row.detail}</span>}
            </span>
            <span aria-hidden="true" className="text-fg-muted">
              ›
            </span>
          </Link>
        ))}
      {hasDebt && <DailyTasksPanel subjectSlug={slug} only="debt" />}
    </section>
  );
}
