'use client';

import type { LessonBlockDto } from '@studyhub/contracts';
import { cn } from '@/lib/utils';

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M4 7V5a4 4 0 1 1 8 0v2h1v7H3V7h1Zm2 0h4V5a2 2 0 1 0-4 0v2Z" />
    </svg>
  );
}

/** One row of an index: dot (done, number or lock), title and a short line under it. */
export function OutlineRow({
  number,
  title,
  subtitle,
  state,
  selectable,
  current,
  written,
  onSelect,
}: {
  number: number;
  title: string;
  subtitle: string;
  state: LessonBlockDto['state'];
  selectable: boolean;
  current: boolean;
  /** The block exists: its title is the real one, not a placeholder. */
  written: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={current ? 'step' : undefined}
      aria-disabled={selectable ? undefined : true}
      onClick={selectable ? onSelect : undefined}
      className={cn(
        'flex min-h-11 w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        current ? 'bg-bg-raised' : selectable ? 'hover:bg-bg-raised' : 'cursor-default',
      )}
    >
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
          state === 'done'
            ? 'bg-ok text-bg-base'
            : current
              ? 'bg-accent text-bg-base'
              : selectable
                ? 'bg-border-strong text-fg-primary'
                : 'bg-border text-fg-secondary',
        )}
        aria-hidden="true"
      >
        {state === 'done' ? '✓' : selectable ? number : <LockIcon />}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            'block truncate text-[13px]',
            written ? 'text-fg-primary' : 'text-fg-muted',
          )}
        >
          {title}
        </span>
        <span className="block text-[11px] text-fg-secondary">{subtitle}</span>
      </span>
    </button>
  );
}

/** Index of the lesson: one row per block, the ones not unlocked yet are shown but cannot be opened. */
export function LessonOutline({
  blocks,
  blockCount,
  currentIndex,
  onSelect,
  pendingIndex,
  vertical = false,
}: {
  blocks: LessonBlockDto[];
  blockCount: number | null;
  currentIndex: number;
  onSelect: (index: number) => void;
  /** The block being generated, if any. */
  pendingIndex?: number | null;
  /** One row under the other at any width (the index inside a sheet on a phone). */
  vertical?: boolean;
}) {
  const total = Math.max(blockCount ?? 0, blocks.length, 1);
  const byIndex = new Map(blocks.map((b) => [b.orderIndex, b]));
  const rows = Array.from({ length: total }, (_, i) => i);

  return (
    <nav aria-label="Indice della lezione" className="min-w-0">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-secondary">
        La lezione · {blockCount ?? '…'} blocchi
      </p>
      <ol
        className={cn(
          'flex gap-1',
          vertical ? 'flex-col' : 'overflow-x-auto lg:flex-col lg:overflow-visible',
        )}
      >
        {rows.map((i) => {
          const block = byIndex.get(i);
          const state = block?.state ?? 'locked';
          const selectable = !!block && state !== 'locked';
          const current = i === currentIndex;
          const generating = !block && (pendingIndex === i || i === 0);
          const subtitle =
            state === 'done'
              ? 'Fatto'
              : selectable
                ? 'Da fare'
                : generating
                  ? 'In preparazione…'
                  : `Si sblocca dopo il blocco ${i}`;
          return (
            <li key={i} className={vertical ? 'min-w-0' : 'min-w-[10rem] lg:min-w-0'}>
              <OutlineRow
                number={i + 1}
                title={block ? block.title : `Blocco ${i + 1}`}
                subtitle={subtitle}
                state={state}
                selectable={selectable}
                current={current}
                written={!!block}
                onSelect={() => onSelect(i)}
              />
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
