'use client';

import Link from 'next/link';
import type { Ref } from 'react';
import { formatPoints } from '@/lib/simulationMobile';
import { cardClass, primaryButton } from './styles';

/** Total score, the "under half" count and the drill call to action. */
export function ScoreCard({
  slug,
  awarded,
  max,
  belowHalf,
  weakCount,
  onDrill,
  drillRef,
  drillPending,
  drillDone,
  drillError,
}: {
  slug: string;
  awarded: number | null;
  max: number | null;
  /** null until the per-exercise results are loaded. */
  belowHalf: number | null;
  weakCount: number;
  onDrill: () => void;
  drillRef: Ref<HTMLButtonElement>;
  drillPending: boolean;
  drillDone: boolean;
  drillError: string | null;
}) {
  const hasScore = awarded !== null && max !== null;
  return (
    <section
      aria-label="Punteggio"
      className={`${cardClass} flex flex-col items-center gap-2 px-4 py-5 text-center`}
    >
      <p
        aria-label={
          hasScore ? `Punteggio ${formatPoints(awarded)} su ${formatPoints(max)}` : undefined
        }
        className="font-mono text-5xl font-semibold tabular-nums"
        data-testid="attempt-score"
      >
        {hasScore ? (
          <>
            {formatPoints(awarded)}
            <span className="text-2xl text-fg-muted">/{formatPoints(max)}</span>
          </>
        ) : (
          '—'
        )}
      </p>
      {belowHalf !== null && (
        <p className="text-[15px] text-fg-secondary">
          {belowHalf === 0
            ? 'Nessun esercizio sotto la metà'
            : belowHalf === 1
              ? '1 esercizio sotto la metà'
              : `${belowHalf} esercizi sotto la metà`}
        </p>
      )}
      {weakCount > 0 && (
        <p className="text-[13px] text-fg-secondary">
          Argomenti deboli: la mastery è stata aggiornata e il piano li considererà.
        </p>
      )}
      {weakCount > 0 && (
        <button
          type="button"
          ref={drillRef}
          aria-haspopup={weakCount > 1 ? 'dialog' : undefined}
          disabled={drillPending}
          onClick={onDrill}
          className={`${primaryButton} mt-2 min-h-12 text-[15px]`}
        >
          {drillPending ? 'Avvio…' : 'Drill sugli errori'}
        </button>
      )}
      {drillDone && (
        <div role="status" className="flex flex-col items-center text-[13px] text-ok">
          <p>Drill in generazione — lo trovi nella tab Simulazioni.</p>
          <Link
            href={`/materie/${slug}?tab=simulazioni`}
            className="flex min-h-11 items-center text-accent underline"
          >
            Vai alle simulazioni
          </Link>
        </div>
      )}
      {drillError && (
        <p role="alert" className="text-[13px] text-danger">
          {drillError}
        </p>
      )}
    </section>
  );
}
