'use client';

import type { Ref } from 'react';
import type { VerifyItemDto } from '@studyhub/contracts';
import { Markdown } from '@/components/SessionBriefing';
import { OUTCOME_UI, UNKNOWN_FALLBACK, outcomeOf } from '@/lib/verifyClient';
import { cn } from '@/lib/utils';

/** Giusto / Quasi / Sbagliato / Non te lo ricordavi: label and sign, never colour alone. */
export function VerifyOutcome({
  item,
  focusRef,
}: {
  item: Pick<VerifyItemDto, 'state' | 'feedback'>;
  focusRef?: Ref<HTMLDivElement>;
}) {
  const outcome = outcomeOf(item);
  if (outcome === 'open') return null;
  const ui = OUTCOME_UI[outcome];
  const text = item.feedback?.text?.trim() || (outcome === 'unknown' ? UNKNOWN_FALLBACK : '');
  return (
    <div
      ref={focusRef}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col gap-2 rounded-[var(--radius-control)] border p-3.5 outline-none focus-visible:outline-2 focus-visible:outline-accent',
        ui.tone,
      )}
    >
      <strong className={cn('font-semibold', ui.text)}>
        <span aria-hidden="true">{ui.sign} </span>
        {ui.label}
      </strong>
      {text && (
        <div className="text-fg-secondary">
          <Markdown source={text} />
        </div>
      )}
    </div>
  );
}
