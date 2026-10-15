'use client';

import Link from 'next/link';
import type { RefObject } from 'react';
import type { SimulationSummaryDto } from '@studyhub/contracts';
import { BottomSheet } from '../subject-mobile/BottomSheet';
import { simulationSubtitle } from './SimulationRow';
import { primaryButton, secondaryButton } from './styles';

/**
 * Actions on a simulation. Opening the exam route creates an attempt when none is open, so the
 * row never navigates on its own: starting is an explicit tap here.
 */
export function SimulationSheet({
  slug,
  sim,
  open,
  onOpenChange,
  returnFocusRef,
}: {
  slug: string;
  sim: SimulationSummaryDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  if (!sim) return null;
  const resuming = sim.openAttemptId !== null;
  const label = resuming
    ? 'Riprendi la simulazione'
    : sim.attemptCount === 0
      ? 'Inizia la simulazione'
      : 'Rifai la simulazione';
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={sim.title}
      description={simulationSubtitle(sim)}
      returnFocusRef={returnFocusRef}
    >
      <div className="mt-4 flex flex-col gap-3">
        <Link
          href={`/materie/${slug}/simulations/${sim.id}`}
          className={`${primaryButton} min-h-12 text-[15px]`}
        >
          {label}
        </Link>
        <p className="text-[13px] text-fg-secondary">
          {resuming
            ? 'Riprendi da dove eri: il tempo residuo è quello del tentativo in corso.'
            : `Il timer di ${sim.timeBudgetMin} min parte subito.`}
        </p>
        {sim.lastAttemptId && (
          <Link
            href={`/materie/${slug}/attempts/${sim.lastAttemptId}/results`}
            className={`${secondaryButton} min-h-12 text-[15px]`}
          >
            Vedi la correzione
          </Link>
        )}
      </div>
    </BottomSheet>
  );
}
