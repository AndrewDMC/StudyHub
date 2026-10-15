'use client';

import type { PlanDiffDto } from '@studyhub/contracts';
import { primaryButton, secondaryButton } from '../simulation-mobile/styles';

/** Draft banner: confirm or discard it, plus what changed compared with the active plan. */
export function DraftCard({
  diff,
  onCommit,
  onDiscard,
  commitPending,
  discardPending,
  error,
}: {
  diff: PlanDiffDto | null | undefined;
  onCommit: () => void;
  onDiscard: () => void;
  commitPending: boolean;
  discardPending: boolean;
  error: string | null;
}) {
  return (
    <section
      aria-label="Bozza del piano"
      className="min-w-0 rounded-[var(--radius-card)] border border-warn bg-bg-surface p-4"
    >
      <p className="text-sm font-medium text-warn">Bozza — non ancora nel calendario</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onCommit}
          disabled={commitPending || discardPending}
          className={`${primaryButton} min-h-12 text-sm`}
        >
          {commitPending ? 'Confermo…' : 'Conferma piano'}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={commitPending || discardPending}
          className={`${secondaryButton} min-h-12`}
        >
          {discardPending ? 'Scarto…' : 'Scarta bozza'}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
      {diff && diff.rows.length > 0 && (
        <div className="mt-3 border-t border-border pt-3 text-xs">
          <p className="mb-1.5 font-medium text-info">Ricalcolo rispetto al piano attivo</p>
          <ul className="space-y-1">
            {diff.summary.map((line, i) => (
              <li key={i} className="break-words text-fg-secondary">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
