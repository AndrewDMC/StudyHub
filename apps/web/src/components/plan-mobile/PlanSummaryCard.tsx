'use client';

import type { PlanDto } from '@studyhub/contracts';
import { INTENSITY_LABELS, averageMinutes, formatUntil, planProgress } from '@/lib/planMobile';
import { cardClass, secondaryButton } from '../simulation-mobile/styles';

const PILL_OK = 'border-[color-mix(in_srgb,var(--ok)_40%,transparent)] text-ok';
const PILL_WARN = 'border-[color-mix(in_srgb,var(--warn)_40%,transparent)] text-warn';

/** "Piano di studio": status, deadline, progress and the read-only pace tiles. */
export function PlanSummaryCard({
  plan,
  onEditPace,
  editDisabled,
}: {
  plan: PlanDto;
  onEditPace?: (trigger: HTMLElement) => void;
  editDisabled?: boolean;
}) {
  const draft = plan.status === 'draft';
  const { total, done } = planProgress(plan.tasks);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const minutes = averageMinutes(plan.availability.perWeekday);
  return (
    <section aria-labelledby="plan-summary-title" className={`${cardClass} min-w-0 p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="plan-summary-title" className="text-base font-semibold">
            Piano di studio
          </h2>
          <p className="text-[13px] text-fg-secondary">{formatUntil(plan.targetDate)}</p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${draft ? PILL_WARN : PILL_OK}`}
        >
          {draft ? 'Bozza' : 'Attivo'}
        </span>
      </div>
      {draft && <p className="mt-1 text-xs text-fg-muted">Non ancora nel calendario</p>}

      <div className="mt-3 flex items-baseline justify-between gap-3">
        {draft ? (
          <p className="font-mono text-[15px] font-semibold tabular-nums">{total} task proposte</p>
        ) : (
          <p
            className="font-mono text-[15px] font-semibold tabular-nums"
            aria-label={`${done} task completate su ${total}`}
          >
            {done} / {total} task
          </p>
        )}
        {!draft && total > 0 && (
          <p aria-hidden="true" className="font-mono text-xs tabular-nums text-fg-muted">
            {pct}%
          </p>
        )}
      </div>
      {!draft && total > 0 && (
        <div
          role="progressbar"
          aria-label="Avanzamento del piano"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-raised"
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <div className="flex min-w-0 flex-col-reverse rounded-[var(--radius-control)] bg-bg-raised p-3">
          <dt className="text-xs text-fg-muted">Ritmo</dt>
          <dd className="truncate font-mono text-[15px] font-semibold">
            {INTENSITY_LABELS[plan.prefs.intensity]}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col-reverse rounded-[var(--radius-control)] bg-bg-raised p-3">
          <dt className="text-xs text-fg-muted">Minuti al giorno</dt>
          <dd className="truncate font-mono text-[15px] font-semibold">
            {minutes > 0 ? `~${minutes}` : '—'}
          </dd>
        </div>
      </dl>
      {!draft && onEditPace && (
        <button
          type="button"
          aria-haspopup="dialog"
          data-testid="plan-edit-pace"
          disabled={editDisabled}
          onClick={(e) => onEditPace(e.currentTarget)}
          className={`${secondaryButton} mt-3 min-h-11 w-full text-sm`}
        >
          Modifica ritmo
        </button>
      )}
    </section>
  );
}
