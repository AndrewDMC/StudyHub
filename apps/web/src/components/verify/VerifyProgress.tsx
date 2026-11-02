'use client';

import type { VerifyItemDto } from '@studyhub/contracts';
import { OUTCOME_UI, outcomeOf, progressGridClass } from '@/lib/verifyClient';
import { cn } from '@/lib/utils';

/** One bar per question (coloured by outcome) and a text counter that says the same in words. */
export function VerifyProgress({
  items,
  viewIndex,
  done,
}: {
  items: Pick<VerifyItemDto, 'state' | 'feedback'>[];
  viewIndex: number;
  done: boolean;
}) {
  const total = items.length;
  const k = Math.min(viewIndex + 1, total);
  const label = done ? 'Verifica completata' : `Domanda ${k} di ${total}`;
  return (
    <div className="flex items-center gap-3">
      <div
        role="img"
        aria-label={label}
        className={cn('grid flex-1 gap-1.5', progressGridClass(total))}
      >
        {items.map((item, i) => {
          const outcome = outcomeOf(item);
          const color =
            outcome !== 'open'
              ? OUTCOME_UI[outcome].bar
              : i === viewIndex && !done
                ? 'bg-accent'
                : 'bg-border';
          return <span key={i} className={cn('h-1.5 rounded-[3px]', color)} />;
        })}
      </div>
      <span className="font-mono text-xs tabular-nums text-fg-secondary">
        {done ? total : k} / {total}
      </span>
    </div>
  );
}
