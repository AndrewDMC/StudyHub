'use client';

import Link from 'next/link';
import { Check } from 'lucide-react';
import type { TaskDto } from '@studyhub/contracts';
import { KIND_LABELS } from '@/lib/planMobile';
import { reviewHref } from '@/lib/quickReview';
import { StartTaskButton } from '../StartTaskButton';
import { kindBar } from './kindStyle';

const primaryStart =
  'flex min-h-11 items-center rounded-[var(--radius-control)] bg-accent px-4 text-sm font-semibold text-bg-base disabled:opacity-60';
const secondaryStart =
  'flex min-h-11 items-center rounded-[var(--radius-control)] border border-border-strong px-4 text-sm font-medium text-fg-primary disabled:opacity-60';

export function taskMeta(task: TaskDto): string {
  if (task.kind === 'rest') return 'giorno libero';
  const suffix =
    task.status === 'done'
      ? ' · fatto'
      : task.status === 'skipped'
        ? ' · saltata'
        : task.status === 'doing'
          ? ' · in corso'
          : '';
  return `${task.minutes} min${suffix}${task.pinned ? ' · fissata' : ''}`;
}

/** One task of the selected day: colour bar, tick-off (active plan), text that opens the sheet, start/pin. */
export function TaskRow({
  slug,
  task,
  isDraft,
  today,
  primary,
  subjectHex,
  busy,
  onOpen,
  onDone,
  onPin,
}: {
  slug: string;
  task: TaskDto;
  isDraft: boolean;
  today: string;
  /** First open task of today: gets the primary "Inizia". */
  primary: boolean;
  subjectHex: string | undefined;
  busy: boolean;
  onOpen: (trigger: HTMLButtonElement) => void;
  onDone: () => void;
  onPin: () => void;
}) {
  const bar = kindBar(task.kind, subjectHex);
  const done = task.status === 'done';
  const open = task.status === 'todo' || task.status === 'doing';
  const showCheck = !isDraft && task.kind !== 'rest' && (open || done);
  const startable = !isDraft && open && task.date <= today && task.kind !== 'rest';
  const cta = primary ? primaryStart : secondaryStart;
  const meta = taskMeta(task);

  return (
    <li className="flex min-h-16 items-center gap-2 border-t border-border px-3.5 py-2.5 first:border-t-0">
      <span
        aria-hidden="true"
        className={`w-1 shrink-0 self-stretch rounded-full ${bar.className}`}
        style={bar.style}
      />
      {showCheck && (
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={`Segna come fatta: ${task.title}`}
          disabled={done || busy}
          onClick={onDone}
          className="-mx-1.5 flex h-11 w-11 shrink-0 items-center justify-center"
        >
          <span
            aria-hidden="true"
            className={`flex h-[22px] w-[22px] items-center justify-center rounded-[6px] border-[1.5px] ${
              done ? 'border-ok bg-ok text-bg-base' : 'border-border-strong'
            }`}
          >
            {done && <Check className="h-3.5 w-3.5" />}
          </span>
        </button>
      )}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${KIND_LABELS[task.kind]}, ${task.title}, ${meta}`}
        onClick={(e) => onOpen(e.currentTarget)}
        className="min-h-11 min-w-0 flex-1 text-left"
      >
        <span className="block text-xs font-semibold uppercase tracking-[0.04em] text-fg-muted">
          {KIND_LABELS[task.kind]}
        </span>
        <span
          className={`line-clamp-2 break-words text-[15px] ${
            done ? 'text-fg-muted line-through' : 'text-fg-primary'
          }`}
        >
          {task.title}
        </span>
        <span className="block font-mono text-xs text-fg-muted">{meta}</span>
      </button>
      {isDraft && task.kind !== 'rest' && (
        <button
          type="button"
          disabled={busy}
          onClick={onPin}
          className={`${secondaryStart} shrink-0`}
        >
          {task.pinned ? 'Sblocca' : 'Fissa'}
        </button>
      )}
      {startable && (
        <div className="shrink-0">
          {task.kind === 'read' || task.kind === 'schema' || task.kind === 'drill' ? (
            <StartTaskButton subjectSlug={slug} taskId={task.id} kind={task.kind} className={cta} />
          ) : task.kind === 'simulation' ? (
            <Link href={`/materie/${slug}?tab=simulazioni`} className={cta}>
              Inizia
            </Link>
          ) : (
            <Link href={reviewHref(slug, task.topicId ?? undefined)} className={cta}>
              Inizia
            </Link>
          )}
        </div>
      )}
    </li>
  );
}
