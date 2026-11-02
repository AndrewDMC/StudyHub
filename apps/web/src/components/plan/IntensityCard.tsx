'use client';

import type { Intensity } from '@studyhub/contracts';
import { CARD_BOX, FOCUS, SECTION_TITLE } from '@/components/subject-tabs/styles';
import { INTENSITY_INFO, INTENSITY_ORDER } from './planModel';
import { PhaseList } from './PhaseList';

/**
 * Intensity of the plan with the method it implies. Read-only for the current plan: another choice
 * opens the wizard with that intensity preselected (a new draft), the plan itself does not change.
 */
export function IntensityCard({
  intensity,
  hasPlannerSprint,
  onChange,
}: {
  intensity: Intensity;
  /** Some lessons went to sprint although the plan is not a sprint one. */
  hasPlannerSprint: boolean;
  onChange: (next: Intensity) => void;
}) {
  const info = INTENSITY_INFO[intensity];
  return (
    <section
      aria-labelledby="metodo"
      data-testid="plan-intensity"
      className={`${CARD_BOX} flex flex-wrap gap-x-8 gap-y-5 p-6`}
    >
      <div className="flex flex-1 basis-[340px] flex-col gap-3">
        <h2 id="metodo" className={SECTION_TITLE}>
          Intensità e metodo
        </h2>
        <div
          role="group"
          aria-label="Intensità"
          className="grid grid-cols-3 gap-0.5 rounded-lg border border-border bg-bg-inset p-[3px]"
        >
          {INTENSITY_ORDER.map((i) => (
            <button
              key={i}
              type="button"
              aria-current={i === intensity ? 'true' : undefined}
              aria-describedby={i === intensity ? undefined : 'intensita-nota'}
              onClick={() => {
                if (i !== intensity) onChange(i);
              }}
              className={`h-10 rounded-[var(--radius-control)] text-[13px] font-medium transition-colors duration-120 ${FOCUS} ${
                i === intensity
                  ? 'bg-bg-raised text-fg-primary'
                  : 'text-fg-secondary hover:text-fg-primary'
              }`}
            >
              {INTENSITY_INFO[i].label}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-fg-secondary">{info.capacity}</p>
        <p id="intensita-nota" className="text-xs text-fg-muted">
          Un&apos;altra intensità prepara una nuova bozza: il piano attuale non cambia.
        </p>
      </div>
      <div className="flex flex-[2] basis-[420px] flex-col gap-2.5">
        <p className="font-medium text-fg-primary">{info.title}</p>
        <PhaseList method={info.sprint ? 'sprint' : 'standard'} label="Fasi di ogni lezione" />
        <p className="text-[13px] text-fg-secondary">{info.description}</p>
        {!info.sprint && hasPlannerSprint && (
          <p className="text-xs text-fg-muted">
            Le lezioni passate a sprint seguono le fasi dello sprint.
          </p>
        )}
      </div>
    </section>
  );
}
