'use client';

import { useId } from 'react';
import type { CoverageTopicDto } from '@studyhub/contracts';
import {
  formatMastery,
  masteryTone,
  mentionsLabel,
  topicAction,
  type TopicActionKind,
} from '@/lib/coverageMobile';
import { toneBg } from '../simulation-mobile/styles';
import { TopicAction, type SheetKind } from './TopicAction';

/** "Da colmare per primo": the top-priority gap with its message, mastery and the next step. */
export function PriorityCard({
  slug,
  topic,
  due,
  onOpenSheet,
}: {
  slug: string;
  topic: CoverageTopicDto;
  /** Cards due today in this topic; `undefined`/`null` while unknown. */
  due?: number | null | undefined;
  onOpenSheet: (kind: SheetKind, topicId: string, trigger: HTMLElement) => void;
}) {
  const titleId = useId();
  const tone = masteryTone(topic.mastery);
  const mentions = mentionsLabel(topic);
  // The drill is the design's primary step whenever there is material to drill on.
  const basePrimary: TopicActionKind | null =
    topic.materialDocs > 0 && !topic.flags.includes('no_material') ? 'drill' : topicAction(topic);
  // Nothing due today: the review step is dropped (no "Ripassa 0 card").
  const primary = basePrimary === 'review' && due === 0 ? null : basePrimary;
  const showReview = topic.cards > 0 && primary !== 'review' && due !== 0;
  const single = primary === null || !showReview;

  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 rounded-[var(--radius-card)] border border-border bg-bg-surface p-4"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-danger">
        Da colmare per primo
      </p>
      <h2 id={titleId} className="mt-1 break-words text-xl font-semibold text-fg-primary">
        {topic.name}
      </h2>
      {mentions && (
        <p className="mt-2">
          <span
            title={`su ${topic.examTotal} esami`}
            className="inline-block rounded-full border border-border-strong px-2.5 py-1 text-xs text-fg-secondary"
          >
            {mentions}
            <span className="sr-only"> su {topic.examTotal} esami</span>
          </span>
        </p>
      )}
      {topic.message && (
        <p className="mt-3 break-words text-sm text-fg-secondary">{topic.message}</p>
      )}
      <div className="mt-3 flex items-center gap-3">
        {topic.mastery !== null && (
          <div
            aria-hidden="true"
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-inset"
          >
            <div
              className={`h-full rounded-full ${tone ? toneBg[tone] : 'bg-accent'}`}
              style={{ width: `${Math.round(topic.mastery * 100)}%` }}
            />
          </div>
        )}
        <span className="shrink-0 font-mono text-xs tabular-nums text-fg-secondary">
          {topic.mastery === null
            ? 'Mastery non ancora calcolata'
            : `Mastery ${formatMastery(topic.mastery)}`}
        </span>
      </div>
      {(primary || showReview) && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {primary && (
            <TopicAction
              slug={slug}
              topic={topic}
              kind={primary}
              variant="primary"
              due={due}
              className={single ? 'col-span-2' : ''}
              onOpenSheet={onOpenSheet}
            />
          )}
          {showReview && (
            <TopicAction
              slug={slug}
              topic={topic}
              kind="review"
              variant="secondary"
              due={due}
              className={single ? 'col-span-2' : ''}
              onOpenSheet={onOpenSheet}
            />
          )}
        </div>
      )}
    </section>
  );
}
