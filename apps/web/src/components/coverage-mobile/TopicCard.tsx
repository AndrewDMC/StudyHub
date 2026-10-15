'use client';

import { useId } from 'react';
import type { CoverageTopicDto } from '@studyhub/contracts';
import {
  examsLabel,
  FLAG_LABELS,
  FLAG_TONES,
  formatMastery,
  masteryTone,
  topicAction,
} from '@/lib/coverageMobile';
import { toneText } from '../simulation-mobile/styles';
import { TopicAction, type SheetKind } from './TopicAction';

const pillBorder = {
  danger: 'border-[color-mix(in_srgb,var(--danger)_40%,transparent)] text-danger',
  warn: 'border-[color-mix(in_srgb,var(--warn)_40%,transparent)] text-warn',
  info: 'border-[color-mix(in_srgb,var(--info)_40%,transparent)] text-info',
  ok: 'border-[color-mix(in_srgb,var(--ok)_40%,transparent)] text-ok',
} as const;

const pill = 'rounded-full border px-2.5 py-1 text-xs font-medium';

/** One topic: name, status pills, the four metrics, the backend message and one action. */
export function TopicCard({
  slug,
  topic,
  onOpenSheet,
}: {
  slug: string;
  topic: CoverageTopicDto;
  onOpenSheet: (kind: SheetKind, topicId: string, trigger: HTMLElement) => void;
}) {
  const titleId = useId();
  const action = topicAction(topic);
  const tone = masteryTone(topic.mastery);
  const metrics: { label: string; value: string; title?: string; cls?: string }[] = [
    {
      label: 'materiale',
      value: String(topic.materialDocs),
      title: `${topic.materialPages} pagine`,
    },
    { label: 'card', value: String(topic.cards) },
    {
      label: 'mastery',
      value: formatMastery(topic.mastery),
      cls: tone ? toneText[tone] : 'text-fg-muted',
    },
    { label: 'negli esami', value: examsLabel(topic) },
  ];

  return (
    <article
      aria-labelledby={titleId}
      className="min-w-0 rounded-[var(--radius-card)] border border-border bg-bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id={titleId} className="min-w-0 break-words text-base font-semibold text-fg-primary">
          {topic.name}
        </h3>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {topic.flags.length === 0 ? (
            <span className={`${pill} ${pillBorder.ok}`}>In regola</span>
          ) : (
            topic.flags.map((f) => (
              <span key={f} className={`${pill} ${pillBorder[FLAG_TONES[f]]}`}>
                {FLAG_LABELS[f]}
              </span>
            ))
          )}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-4 gap-2">
        {metrics.map((m) => (
          <div key={m.label} className="flex min-w-0 flex-col-reverse" title={m.title}>
            <dt className="truncate text-[11px] text-fg-muted">{m.label}</dt>
            <dd
              className={`truncate font-mono text-[15px] font-semibold tabular-nums ${m.cls ?? 'text-fg-primary'}`}
            >
              {m.value}
              {m.title && <span className="sr-only"> ({m.title})</span>}
            </dd>
          </div>
        ))}
      </dl>
      {topic.message && (
        <p className="mt-3 break-words text-[13px] text-fg-secondary">{topic.message}</p>
      )}
      {action && (
        <div className="mt-3">
          <TopicAction
            slug={slug}
            topic={topic}
            kind={action}
            variant="secondary"
            onOpenSheet={onOpenSheet}
          />
        </div>
      )}
    </article>
  );
}
