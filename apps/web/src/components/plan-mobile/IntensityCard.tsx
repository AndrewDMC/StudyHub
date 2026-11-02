'use client';

import { useRef, type KeyboardEvent } from 'react';
import type { Intensity } from '@studyhub/contracts';
import { INTENSITY_INFO, INTENSITY_ORDER } from '../plan/planModel';
import { PhaseList } from '../plan/PhaseList';
import { cardClass } from '../simulation-mobile/styles';

/**
 * Intensity of the plan with the method it implies. Read-only for the current plan: another choice
 * opens the sheet with that intensity preselected (a new draft), the plan itself does not change.
 */
export function IntensityCard({
  intensity,
  locked,
  chosen,
  onChange,
}: {
  intensity: Intensity;
  /** A draft is waiting (or being generated): the group is read-only. */
  locked: boolean;
  /** The intensity the student tapped last, while the sheet is open or after it. */
  chosen: Intensity | null;
  onChange: (next: Intensity, trigger: HTMLElement) => void;
}) {
  const info = INTENSITY_INFO[intensity];
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = INTENSITY_ORDER.length - 1;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
  };

  return (
    <section
      aria-labelledby="mp-met"
      data-testid="plan-intensity"
      className={`${cardClass} flex min-w-0 flex-col gap-2.5 p-4`}
    >
      <h2 id="mp-met" className="text-xs font-medium uppercase tracking-[0.05em] text-fg-secondary">
        Intensità
      </h2>
      <div
        role="radiogroup"
        aria-label="Intensità"
        aria-disabled={locked || undefined}
        className="grid grid-cols-3 gap-0.5 rounded-lg border border-border bg-bg-inset p-[3px]"
      >
        {INTENSITY_ORDER.map((value, i) => {
          const active = value === intensity;
          return (
            <button
              key={value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              disabled={locked}
              onKeyDown={(e) => onKeyDown(e, i)}
              onClick={(e) => {
                if (!active) onChange(value, e.currentTarget);
              }}
              className={`h-11 rounded-[var(--radius-control)] text-sm font-medium disabled:opacity-60 ${
                active ? 'bg-bg-raised text-fg-primary' : 'text-fg-secondary'
              }`}
            >
              {INTENSITY_INFO[value].label}
            </button>
          );
        })}
      </div>
      <p className="text-[13px] text-fg-secondary">
        {info.capacity} {info.description}
      </p>
      <PhaseList method={info.sprint ? 'sprint' : 'standard'} label="Fasi di ogni lezione" />
      {locked ? (
        <p role="status" className="text-xs text-fg-muted">
          Conferma o scarta la bozza per cambiare intensità.
        </p>
      ) : (
        chosen !== null &&
        chosen !== intensity && (
          <p role="status" className="text-xs text-fg-muted">
            Per cambiare intensità si prepara una nuova bozza: scegli le date e conferma.
          </p>
        )
      )}
    </section>
  );
}
