'use client';

import { Button } from '@/components/ui/button';
import { isBudgetMessage } from '@/lib/lessonClient';

/** Skeleton while a block is being written. */
export function LessonSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-3 rounded-[var(--radius-card)] border border-border bg-bg-surface p-5 md:p-7"
    >
      <div className="space-y-2 motion-reduce:hidden" aria-hidden="true">
        <div className="h-5 w-2/3 animate-pulse rounded bg-bg-raised" />
        <div className="h-4 w-full animate-pulse rounded bg-bg-raised" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-bg-raised" />
      </div>
      <p className="text-sm text-fg-secondary">{label}</p>
    </div>
  );
}

/** A failed generation: the reason and "Riprova"; with the daily budget used up, only the explanation. */
export function LessonError({
  what,
  error,
  retrying,
  onRetry,
}: {
  /** "il blocco 2", "la lezione" */
  what: string;
  error: string | null;
  retrying: boolean;
  onRetry: () => void;
}) {
  if (isBudgetMessage(error)) {
    return (
      <div
        role="alert"
        className="rounded-[var(--radius-card)] border border-danger/40 bg-danger/5 p-4 text-sm text-fg-primary"
      >
        Hai raggiunto il budget AI di oggi. La lezione riprende da qui domani, oppure alza il limite
        nelle impostazioni.
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="space-y-3 rounded-[var(--radius-card)] border border-danger/40 bg-danger/5 p-4"
    >
      <p className="text-sm text-fg-primary">
        Non sono riuscito a preparare {what}: {error ?? 'errore sconosciuto'}. Puoi riprovare.
      </p>
      <Button type="button" variant="secondary" disabled={retrying} onClick={onRetry}>
        {retrying ? 'Riprovo…' : 'Riprova'}
      </Button>
    </div>
  );
}
