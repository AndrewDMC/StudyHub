'use client';

import type { PlanDto } from '@studyhub/contracts';
import { BTN_SECONDARY, FOCUS } from '@/components/subject-tabs/styles';
import { fitModel } from './planModel';

const TONE = {
  ok: { box: 'border-ok bg-ok/5', icon: 'text-ok', mark: '✓' },
  warn: { box: 'border-warn bg-warn/5', icon: 'text-warn', mark: '!' },
  danger: { box: 'border-danger bg-danger/5', icon: 'text-danger', mark: '!' },
} as const;

/** "Cosa entra": what fits in standard, what the planner moved to sprint, what stays out (by name). */
export function FitCard({
  plan,
  nameOf,
  onAddAvailability,
  onExcludeMore,
}: {
  plan: PlanDto;
  nameOf: (key: string) => string;
  onAddAvailability: () => void;
  /** Only on a draft. */
  onExcludeMore?: (() => void) | undefined;
}) {
  const model = fitModel(plan, nameOf);
  const tone = TONE[model.tone];
  const f = plan.feasibility;
  return (
    <section
      aria-labelledby="fattib"
      data-testid="plan-fit"
      className={`flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[var(--radius-card)] border p-4 ${tone.box}`}
    >
      <span
        aria-hidden="true"
        className={`flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-bg-base/60 text-sm font-semibold ${tone.icon}`}
      >
        {tone.mark}
      </span>
      <div className="min-w-0 flex-1 basis-80">
        <h2 id="fattib" className="text-sm font-semibold text-fg-primary">
          {model.title}
        </h2>
        <p className="text-[13px] text-fg-secondary">{model.text}</p>
      </div>
      {model.hasProblem && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onAddAvailability} className={`${BTN_SECONDARY} h-9`}>
            Aggiungi disponibilità
          </button>
          {onExcludeMore && (
            <button type="button" onClick={onExcludeMore} className={`${BTN_SECONDARY} h-9`}>
              Escludi qualcos&apos;altro
            </button>
          )}
        </div>
      )}
      {!f.feasible && (
        <details className="basis-full">
          <summary className={`cursor-pointer text-xs text-fg-secondary ${FOCUS}`}>
            Come recuperare tempo
          </summary>
          <p className="mt-2 text-sm font-medium text-warn">
            Tempo insufficiente: mancano ~{f.shortfallMinutes} min su {f.requiredMinutes} richiesti.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-fg-secondary">
            {f.strategies.map((s) => (
              <li key={s.id}>
                <span className="font-medium text-fg-primary">{s.label}:</span> {s.description}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
