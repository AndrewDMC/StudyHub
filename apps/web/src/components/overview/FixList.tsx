'use client';

import Link from 'next/link';
import { DailyTasksPanel } from '../DailyTasksPanel';
import { TabError, TabLoading } from '../subject-tabs/TabState';
import { BTN_SECONDARY, CARD_BOX, SECTION_TITLE } from '../subject-tabs/styles';
import type { FixRow, FixTone } from './model';

const TONE: Record<FixTone, { cls: string; glyph: string }> = {
  warn: { cls: 'bg-warn/10 text-warn', glyph: '!' },
  danger: { cls: 'bg-danger/10 text-danger', glyph: '×' },
  info: { cls: 'bg-info/10 text-info', glyph: 'i' },
};

/** "Da sistemare": what keeps lessons from happening, plus the overdue tasks ("Debito"). */
export function FixList({
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
  return (
    <section
      data-testid="overview-fix"
      aria-labelledby="sistemare"
      className={`${CARD_BOX} flex min-w-0 flex-col`}
    >
      <h2 id="sistemare" className={`${SECTION_TITLE} px-5 pt-4`}>
        Da sistemare
      </h2>
      {loading && (
        <div className="p-5">
          <TabLoading rows={2} />
        </div>
      )}
      {error && (
        <div className="p-5">
          <TabError message="Impossibile caricare gli avvisi." onRetry={onRetry} />
        </div>
      )}
      {!loading && !error && rows.length === 0 && !hasDebt && (
        <p className="px-5 py-4 text-[13px] text-fg-secondary">Niente da sistemare.</p>
      )}
      {!loading && !error && rows.length > 0 && (
        <ul className="mt-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border px-5 py-3.5 last:border-b-0"
            >
              <span
                aria-hidden="true"
                className={`flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-sm font-semibold ${TONE[row.tone].cls}`}
              >
                {TONE[row.tone].glyph}
              </span>
              <div className="flex min-w-0 flex-1 basis-80 flex-col gap-0.5">
                <p className="text-sm font-medium text-fg-primary">{row.title}</p>
                {row.detail && <p className="text-[13px] text-fg-secondary">{row.detail}</p>}
              </div>
              <Link href={row.action.href} className={`${BTN_SECONDARY} h-9`}>
                {row.action.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {hasDebt && (
        <div className={rows.length > 0 ? 'border-t border-border px-4 py-3' : 'px-4 py-3'}>
          <DailyTasksPanel subjectSlug={slug} only="debt" />
        </div>
      )}
    </section>
  );
}
