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
  pending,
  error,
}: {
  count: number;
  drift: DriftReportDto;
  feasibility: PlanDto['feasibility'];
  onReabsorb: () => void;
  onRecalculate: (trigger: HTMLElement) => void;
  pending: boolean;
  error: string | null;
}) {
  const subtitle =
    drift.shouldRecalculate && drift.reason
      ? `${drift.reason.replace(/[.\s]+$/, '')}. Conviene ricalcolare il piano.`
      : feasibility.feasible
        ? 'Il tempo a disposizione resta sufficiente.'
        : `Il tempo non basta più: mancano ~${feasibility.shortfallMinutes} min.`;
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
      <div className={`mt-3 grid gap-2 ${drift.shouldRecalculate ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <button
          type="button"
          onClick={onReabsorb}
          disabled={pending}
          className={`${primaryButton} min-h-12 text-sm`}
        >
          {pending ? 'Riassorbo…' : 'Riassorbi'}
        </button>
        {drift.shouldRecalculate && (
          <button
            type="button"
            onClick={(e) => onRecalculate(e.currentTarget)}
            disabled={pending}
            className={`${secondaryButton} min-h-12`}
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
