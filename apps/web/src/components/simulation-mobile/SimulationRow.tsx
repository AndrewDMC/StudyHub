'use client';

import { ChevronRight } from 'lucide-react';
import type { SimulationSummaryDto } from '@studyhub/contracts';
import { formatDocDate } from '@/lib/documentStatus';
import { formatPoints, ratioTone, scoreFromRatio, simulationStatus } from '@/lib/simulationMobile';
import { toneBg } from './styles';

/** "Pronta · 6 esercizi · 180 min" / "Corretta · ieri" / "In corso · …". */
export function simulationSubtitle(sim: SimulationSummaryDto): string {
  const { label } = simulationStatus(sim);
  const format = `${sim.itemCount} esercizi · ${sim.timeBudgetMin} min`;
  if (sim.openAttemptId || sim.attemptCount === 0 || sim.lastScoreRatio === null) {
    return `${label} · ${format}`;
  }
  if (sim.lastGradedAt) return `${label} · ${formatDocDate(sim.lastGradedAt)}`;
  return `${label} · creata ${formatDocDate(sim.createdAt)}`;
}

/** A row of "Le tue simulazioni": the whole row is the button (it opens the actions sheet). */
export function SimulationRow({
  sim,
  onOpen,
}: {
  sim: SimulationSummaryDto;
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  const status = simulationStatus(sim);
  const score = scoreFromRatio(sim);
  const subtitle = simulationSubtitle(sim);
  const accessible = [
    `${sim.title}, ${subtitle}`,
    score
      ? `punteggio dell'ultimo tentativo ${formatPoints(score.awarded)} su ${formatPoints(score.max)}`
      : null,
  ]
    .filter(Boolean)
    .join(', ');
  const pill = sim.openAttemptId ? 'Riprendi' : sim.attemptCount === 0 ? 'Inizia' : null;

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={accessible}
      data-testid="simulation-row"
      onClick={(e) => onOpen(e.currentTarget)}
      className="flex min-h-[68px] w-full min-w-0 items-center gap-3 px-3.5 py-3 text-left hover:bg-bg-raised"
    >
      <span
        aria-hidden="true"
        className={`size-2.5 shrink-0 rounded-full ${toneBg[status.tone]}`}
      />
      <span aria-hidden="true" className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{sim.title}</span>
        <span className="block truncate text-[13px] text-fg-secondary">{subtitle}</span>
      </span>
      {score && (
        <span
          aria-hidden="true"
          className={`shrink-0 font-mono text-base tabular-nums ${ratioTone(sim.lastScoreRatio!) === 'danger' ? 'text-danger' : 'text-fg-primary'}`}
        >
          {formatPoints(score.awarded)}
          <span className="text-fg-muted">/{formatPoints(score.max)}</span>
        </span>
      )}
      {pill && (
        <span
          aria-hidden="true"
          className="shrink-0 rounded-full border border-accent bg-accent-subtle px-2.5 py-1 text-xs font-semibold text-accent"
        >
          {pill}
        </span>
      )}
      <ChevronRight className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
    </button>
  );
}
