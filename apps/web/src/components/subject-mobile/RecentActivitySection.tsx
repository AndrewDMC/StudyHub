'use client';

import type { RecentActivityItemDto } from '@studyhub/contracts';
import { activityLabel, timeAgo, useOverview } from '../OverviewPanel';
import { MobileSection, SectionEmpty, SectionError, SkeletonRows } from './SectionState';

function dotClass(item: RecentActivityItemDto): string {
  if (item.kind === 'job') {
    if (item.status === 'succeeded') return 'bg-ok';
    if (item.status === 'failed' || item.status === 'cancelled') return 'bg-danger';
  }
  return 'bg-info';
}

/** "Attività recente": the latest five job/review/upload events of the last 7 days. */
export function RecentActivitySection({ slug }: { slug: string }) {
  const query = useOverview(slug);
  const items = (query.data?.recentActivity ?? []).slice(0, 5);

  return (
    <MobileSection title="Attività recente" busy={query.isLoading}>
      {query.isLoading ? (
        <SkeletonRows count={3} />
      ) : query.isError ? (
        <SectionError
          message={(query.error as Error).message}
          onRetry={() => void query.refetch()}
        />
      ) : items.length === 0 ? (
        <SectionEmpty>Nessuna attività negli ultimi 7 giorni.</SectionEmpty>
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-bg-surface">
          {items.map((item) => (
            <li
              key={`${item.kind}-${item.id}`}
              className="flex min-h-11 items-center gap-3 px-3 py-2"
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${dotClass(item)}`}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-fg-secondary">
                {activityLabel(item)}
              </span>
              <span className="shrink-0 font-mono text-xs text-fg-muted">
                {timeAgo(item.timestamp)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </MobileSection>
  );
}
