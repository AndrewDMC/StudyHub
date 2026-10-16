'use client';

import { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import type { ExamItemDto } from '@studyhub/contracts';

/** The row of exercise numbers: current, answered (check icon, not only colour) or empty. */
export function ExerciseStrip({
  items,
  answers,
  photoCounts = {},
  index,
  onSelect,
}: {
  items: ExamItemDto[];
  answers: Record<string, string>;
  /** Ready photos per item: an exercise with only photos counts as answered. */
  photoCounts?: Record<string, number>;
  index: number;
  onSelect: (index: number) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [index]);

  return (
    <div
      role="group"
      aria-label="Esercizi"
      className="flex shrink-0 gap-2 overflow-x-auto border-b border-border bg-bg-surface px-4 py-2"
    >
      {items.map((item, i) => {
        const answered =
          (answers[item.id] ?? '').trim().length > 0 || (photoCounts[item.id] ?? 0) > 0;
        const current = i === index;
        const label = `Esercizio ${item.ord + 1}, ${answered ? 'con risposta' : 'senza risposta'}${current ? ', corrente' : ''}`;
        return (
          <button
            key={item.id}
            ref={current ? activeRef : undefined}
            type="button"
            aria-label={label}
            aria-current={current ? 'true' : undefined}
            onClick={() => onSelect(i)}
            className={`relative flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border font-mono text-sm font-semibold tabular-nums ${
              current
                ? 'border-accent bg-accent-subtle text-fg-primary'
                : answered
                  ? 'border-ok text-fg-primary'
                  : 'border-border bg-bg-raised text-fg-secondary'
            }`}
          >
            {item.ord + 1}
            {answered && (
              <Check
                className="absolute right-0.5 top-0.5 size-3 text-ok"
                strokeWidth={3}
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
