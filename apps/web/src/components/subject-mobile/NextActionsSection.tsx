'use client';

import Link from 'next/link';
import { AlertTriangle, CalendarDays, ChevronRight, Layers, Tag, Target } from 'lucide-react';
import type { SuggestedActionDto } from '@studyhub/contracts';
import { toMobileReviewHref } from '@/lib/quickReview';
import { useOverview } from '../OverviewPanel';
import { MobileSection, SectionEmpty, SectionError, SkeletonRows } from './SectionState';

const ACTION_ICON: Record<
  SuggestedActionDto['kind'],
  { Icon: typeof Layers; iconClass: string; bgStyle: string }
> = {
  review: { Icon: Layers, iconClass: 'text-accent', bgStyle: 'var(--accent-subtle)' },
  drill: {
    Icon: Target,
    iconClass: 'text-warn',
    bgStyle: 'color-mix(in srgb, var(--warn) 14%, transparent)',
  },
  verify: {
    Icon: AlertTriangle,
    iconClass: 'text-warn',
    bgStyle: 'color-mix(in srgb, var(--warn) 14%, transparent)',
  },
  generate_plan: {
    Icon: CalendarDays,
    iconClass: 'text-info',
    bgStyle: 'color-mix(in srgb, var(--info) 14%, transparent)',
  },
  tag: { Icon: Tag, iconClass: 'text-fg-secondary', bgStyle: 'var(--bg-raised)' },
};

/** "Da fare adesso": the backend's suggested actions, one tappable row each. */
export function NextActionsSection({ slug }: { slug: string }) {
  const query = useOverview(slug);
  const actions = query.data?.suggestedActions ?? [];

  return (
    <MobileSection title="Da fare adesso" busy={query.isLoading}>
      {query.isLoading ? (
        <SkeletonRows count={3} />
      ) : query.isError ? (
        <SectionError
          message={(query.error as Error).message}
          onRetry={() => void query.refetch()}
        />
      ) : actions.length === 0 ? (
        <SectionEmpty>Nessuna azione consigliata al momento — tutto in ordine.</SectionEmpty>
      ) : (
        <ul className="space-y-2">
          {actions.map((action) => {
            const { Icon, iconClass, bgStyle } = ACTION_ICON[action.kind];
            return (
              <li key={action.kind}>
                <Link
                  href={toMobileReviewHref(action.href)}
                  className="flex min-h-14 items-center gap-3 rounded-[var(--radius-card)] border border-border bg-bg-surface p-3"
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] ${iconClass}`}
                    style={{ background: bgStyle }}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium text-fg-primary">
                      {action.label}
                    </span>
                    <span className="block text-[13px] text-fg-secondary">
                      {action.description}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </MobileSection>
  );
}
