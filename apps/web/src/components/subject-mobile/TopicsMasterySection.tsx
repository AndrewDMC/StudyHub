'use client';

import Link from 'next/link';
import type { FlashcardStatsDto } from '@studyhub/contracts';
import { GOOD_MASTERY_THRESHOLD, LOW_MASTERY_THRESHOLD } from '@/lib/mastery';
import { MobileSection } from './SectionState';

const MAX_VISIBLE = 5;

function masteryColor(mastery: number): string {
  if (mastery >= GOOD_MASTERY_THRESHOLD) return 'var(--ok)';
  if (mastery >= LOW_MASTERY_THRESHOLD) return 'var(--warn)';
  return 'var(--danger)';
}

/** "Argomenti": mastery bars. Omitted when no topic has a mastery value yet. */
export function TopicsMasterySection({
  slug,
  stats,
  topicCount,
}: {
  slug: string;
  stats: FlashcardStatsDto | undefined;
  topicCount: number;
}) {
  const rated = (stats?.topicMastery ?? []).filter((t) => t.mastery !== null);
  if (rated.length === 0) return null;
  const visible = rated.slice(0, MAX_VISIBLE);

  return (
    <MobileSection
      title="Argomenti"
      action={
        <Link
          href={`/materie/${slug}?tab=lacune`}
          className="flex min-h-11 items-center text-[13px] text-fg-secondary underline-offset-2 hover:underline"
        >
          {topicCount > MAX_VISIBLE ? `Tutti e ${topicCount}` : 'Tutti'}
        </Link>
      }
    >
      <ul className="space-y-3 rounded-[var(--radius-card)] border border-border bg-bg-surface p-4">
        {visible.map((topic) => {
          const mastery = topic.mastery as number;
          const pct = Math.round(mastery * 100);
          return (
            <li key={topic.topicId}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[15px] text-fg-primary">{topic.name}</span>
                <span className="font-mono text-[13px] text-fg-secondary">{pct}%</span>
              </div>
              <div
                role="progressbar"
                aria-label={topic.name}
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 overflow-hidden rounded-full bg-bg-raised"
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: masteryColor(mastery) }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </MobileSection>
  );
}
