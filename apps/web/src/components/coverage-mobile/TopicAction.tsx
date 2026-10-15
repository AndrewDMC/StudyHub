'use client';

import Link from 'next/link';
import type { CoverageTopicDto } from '@studyhub/contracts';
import { ACTION_LABELS, type TopicActionKind } from '@/lib/coverageMobile';
import { reviewHref } from '@/lib/quickReview';
import { materialHref } from '@/lib/subjectTabs';
import { primaryButton, secondaryButton } from '../simulation-mobile/styles';

export type SheetKind = 'drill' | 'flashcards';

/**
 * One action of a topic: a link (upload, review) or a button that opens a sheet (flashcards, drill).
 * The opener element is handed back so the sheet can return focus to it.
 */
export function TopicAction({
  slug,
  topic,
  kind,
  variant,
  className = '',
  onOpenSheet,
}: {
  slug: string;
  topic: CoverageTopicDto;
  kind: TopicActionKind;
  variant: 'primary' | 'secondary';
  className?: string;
  onOpenSheet: (kind: SheetKind, topicId: string, trigger: HTMLElement) => void;
}) {
  const cls = `${variant === 'primary' ? `${primaryButton} text-sm` : secondaryButton} min-h-11 ${className}`;
  const label = ACTION_LABELS[kind];
  if (kind === 'upload' || kind === 'review') {
    const href = kind === 'upload' ? materialHref(slug, 'tutti') : reviewHref(slug, topic.topicId);
    return (
      <Link href={href} className={cls}>
        {label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={(e) => onOpenSheet(kind, topic.topicId, e.currentTarget)}
      className={cls}
    >
      {label}
    </button>
  );
}
