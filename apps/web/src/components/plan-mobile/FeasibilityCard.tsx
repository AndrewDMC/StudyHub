'use client';

import type { PlanDto } from '@studyhub/contracts';

/** "Tempo insufficiente" with the strategies (informational only: no route applies them). */
export function FeasibilityCard({ plan }: { plan: PlanDto }) {
  if (plan.feasibility.feasible) return null;
  return (
    <div className="min-w-0 rounded-[var(--radius-card)] border border-warn bg-bg-surface p-4 text-sm">
      <p className="font-medium text-warn">
        Tempo insufficiente: mancano ~{plan.feasibility.shortfallMinutes} min su{' '}
        {plan.feasibility.requiredMinutes} richiesti.
      </p>
      <ul className="mt-2 space-y-1 text-xs text-fg-secondary">
        {plan.feasibility.strategies.map((s) => (
          <li key={s.id} className="break-words">
            <span className="font-medium text-fg-primary">{s.label}:</span> {s.description}
          </li>
        ))}
      </ul>
    </div>
  );
}
