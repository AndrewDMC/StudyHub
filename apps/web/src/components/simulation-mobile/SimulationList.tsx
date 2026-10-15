'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import type { SimulationSummaryDto } from '@studyhub/contracts';
import {
  MobileSection,
  SectionEmpty,
  SectionError,
  SkeletonRows,
} from '../subject-mobile/SectionState';
import { SimulationRow } from './SimulationRow';
import { cardClass } from './styles';

export type GeneratingRow = { key: string; label: string };

/** "Le tue simulazioni", with the local "in generazione" rows on top. */
export function SimulationList({
  query,
  generating,
  hasProfile,
  onOpen,
}: {
  query: UseQueryResult<SimulationSummaryDto[]>;
  generating: GeneratingRow[];
  hasProfile: boolean;
  onOpen: (sim: SimulationSummaryDto, trigger: HTMLButtonElement) => void;
}) {
  const sims = query.data ?? [];
  let body;
  if (query.isLoading) {
    body = <SkeletonRows count={3} />;
  } else if (query.isError) {
    body = (
      <SectionError message={(query.error as Error).message} onRetry={() => void query.refetch()} />
    );
  } else if (sims.length === 0 && generating.length === 0) {
    body = (
      <SectionEmpty>
        Nessuna simulazione ancora.
        {hasProfile && ' Creane una con i pulsanti qui sopra.'}
      </SectionEmpty>
    );
  } else {
    body = (
      <ul className={`${cardClass} overflow-hidden`}>
        {generating.map((g, i) => (
          <li
            key={g.key}
            data-testid="simulation-generating"
            className={`flex min-h-[68px] items-center gap-3 px-3.5 py-3 ${i > 0 ? 'border-t border-border' : ''}`}
          >
            <span
              aria-hidden="true"
              className="size-4 shrink-0 animate-spin rounded-full border-2 border-info border-t-transparent motion-reduce:animate-none"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{g.label}</span>
              <span className="block truncate text-[13px] text-fg-secondary">
                In generazione · la lista si aggiorna a breve
              </span>
            </span>
          </li>
        ))}
        {sims.map((sim, i) => (
          <li key={sim.id} className={generating.length + i > 0 ? 'border-t border-border' : ''}>
            <SimulationRow sim={sim} onOpen={(trigger) => onOpen(sim, trigger)} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <MobileSection title="Le tue simulazioni" busy={query.isLoading}>
      {body}
    </MobileSection>
  );
}
