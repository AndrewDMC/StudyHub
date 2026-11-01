'use client';

import type { PlanDto } from '@studyhub/contracts';
import { fitModel } from '../plan/planModel';
import { secondaryButton } from '../simulation-mobile/styles';

const TONE = {
  ok: 'border-ok/50 bg-ok/5',
  warn: 'border-warn/50 bg-warn/5',
  danger: 'border-danger/50 bg-danger/5',
} as const;

/** "Cosa entra": what fits in standard, what went sprint, what stays out (by name), how to recover time. */
export function FitCard({
  plan,
  nameOf,
  onAddAvailability,
}: {
  plan: PlanDto;
  nameOf: (key: string) => string;
  onAddAvailability: (trigger: HTMLElement) => void;
}) {
  const model = fitModel(plan, nameOf);
  const f = plan.feasibility;
  return (
    <section
      aria-labelledby="mp-fit"
      data-testid="plan-fit"
      role="status"
      className={`flex min-w-0 flex-col gap-1 rounded-[var(--radius-card)] border p-4 ${TONE[model.tone]}`}
    >
      <h2 id="mp-fit" className="text-sm font-semibold text-fg-primary">
        {model.title}
      </h2>
      <p className="text-[13px] text-fg-secondary">{model.text}</p>
      {model.excludedNames.length > 0 && (
        <>
          <h3 className="mt-2 text-xs uppercase text-fg-secondary">Fuori dal piano</h3>
          <ul>
            {model.excludedNames.map((name, i) => (
              <li key={`${name}-${i}`} className="flex min-h-11 items-center text-sm">
                {name}
              </li>
            ))}
          </ul>
        </>
      )}
      {!f.feasible && (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-xs text-fg-secondary">
            Come recuperare tempo
          </summary>
          <p className="text-sm font-medium text-warn">
            Tempo insufficiente: mancano ~{f.shortfallMinutes} min su {f.requiredMinutes} richiesti.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-fg-secondary">
            {f.strategies.map((s) => (
              <li key={s.id} className="break-words">
                <span className="font-medium text-fg-primary">{s.label}:</span> {s.description}
              </li>
            ))}
          </ul>
        </details>
      )}
      {model.hasProblem && (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={(e) => onAddAvailability(e.currentTarget)}
          className={`${secondaryButton} mt-2 min-h-11`}
        >
          Aggiungi disponibilità
        </button>
      )}
    </section>
  );
}
