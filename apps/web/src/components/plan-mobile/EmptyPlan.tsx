'use client';

import { primaryButton } from '../simulation-mobile/styles';

/** No plan yet: explain and offer the generation sheet. */
export function EmptyPlan({ onGenerate }: { onGenerate: (trigger: HTMLElement) => void }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-5 text-center">
      <p className="text-base font-semibold">Non hai ancora un piano di studio.</p>
      <p className="mt-1 text-[13px] text-fg-secondary">
        Genera una bozza indicando la data dell’esame e il tempo che puoi dedicare: potrai rivederla
        prima di confermarla.
      </p>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={(e) => onGenerate(e.currentTarget)}
        className={`${primaryButton} mt-4 min-h-12 text-sm`}
      >
        Genera il piano
      </button>
    </div>
  );
}
