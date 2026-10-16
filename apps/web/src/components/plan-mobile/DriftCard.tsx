'use client';

import { AlertTriangle } from 'lucide-react';
import type { DriftReportDto, PlanDto } from '@studyhub/contracts';
import { primaryButton, secondaryButton } from '../simulation-mobile/styles';

/** "Sei indietro di N task": reabsorb them, or recalculate when the drift report suggests it. */
export function DriftCard({
  count,
  drift,
  feasibility,
  onReabsorb,
  onRecalculate,
  onMoveDay,
  movePending,
  pending,
  error,
}: {
  count: number;
  drift: DriftReportDto;
  feasibility: PlanDto['feasibility'];
  onReabsorb: () => void;
  onRecalculate: (trigger: HTMLElement) => void;
  onMoveDay: () => void;
  movePending: boolean;
  pending: boolean;
  error: string | null;
}) {
  const subtitle =
    drift.shouldRecalculate && drift.reason
      ? `${drift.reason.replace(/[.\s]+$/, '')}. Conviene ricalcolare il piano.`
      : feasibility.feasible
        ? 'Il tempo a disposizione resta sufficiente.'
        : `Il tempo non basta più: mancano ~${feasibility.shortfallMinutes} min.`;
  const busy = pending || movePending;
  return (
    <div
      role="status"
      className="min-w-0 rounded-[var(--radius-card)] border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-bg-surface p-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">Sei indietro di {count} task</p>
          <p className="break-words text-[13px] text-fg-secondary">{subtitle}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onReabsorb}
          disabled={busy}
          className={`${primaryButton} min-h-12 text-sm`}
        >
          {pending ? 'Riassorbo…' : 'Riassorbi'}
        </button>
        <button
          type="button"
          onClick={onMoveDay}
          disabled={busy}
          data-testid="drift-move-day"
          aria-label={`Sposta di 1 giorno le ${count} task in ritardo`}
          className={`${secondaryButton} min-h-12 text-sm`}
        >
          {movePending ? 'Sposto…' : 'Sposta di 1 giorno'}
        </button>
        {drift.shouldRecalculate && (
          <button
            type="button"
            onClick={(e) => onRecalculate(e.currentTarget)}
            disabled={busy}
            className={`${secondaryButton} col-span-2 min-h-12`}
          >
            Ricalcola il piano
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
