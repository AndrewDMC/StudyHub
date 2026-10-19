'use client';

import { CALIBRATION_LEVEL_LABELS, headline, pct, verdictTail } from '@/lib/calibrationText';
import { useCalibration } from '../api';
import { BlockError, SkeletonBlock } from '../shared/Skeletons';
import { CARD_BOX } from '../shared/styles';

const NOTE = 'In ripasso indica la tua sicurezza con i tasti 1, 2, 3 prima di girare la card.';

/** "Sai quello che credi di sapere?": accuracy per declared confidence, in text and bars. */
export function CalibrationCard({ slug }: { slug: string }) {
  const query = useCalibration(slug);
  const c = query.data;
  const tail = c ? verdictTail(c) : null;
  return (
    <section aria-labelledby="fc-calib" className={`${CARD_BOX} flex flex-col gap-3 p-5`}>
      <h2 id="fc-calib" className="text-[15px] font-semibold">
        Sai quello che credi di sapere?
      </h2>
      {query.isError ? (
        <BlockError
          message="Impossibile caricare la calibrazione."
          onRetry={() => void query.refetch()}
        />
      ) : !c ? (
        <SkeletonBlock className="h-24" />
      ) : c.total === 0 ? (
        <>
          <p className="text-sm text-fg-secondary">Ancora nessuna risposta con fiducia.</p>
          <p className="text-xs text-fg-secondary">{NOTE}</p>
        </>
      ) : (
        <div data-testid="calibration" className="flex flex-col gap-3">
          <p className="text-sm">
            {c.illusionRate !== null && c.illusionRate > 0 && tail ? (
              <>
                Quando eri sicuro, hai sbagliato il{' '}
                <strong className="font-semibold text-warn">{pct(c.illusionRate)}</strong> delle
                volte: {tail}
              </>
            ) : (
              headline(c)
            )}
          </p>
          <ul className="flex flex-col gap-2">
            {c.levels.map((l) => (
              <li
                key={l.confidence}
                className="grid grid-cols-[90px_minmax(0,1fr)_96px] items-center gap-3 text-[13px]"
              >
                <span>{CALIBRATION_LEVEL_LABELS[l.confidence]}</span>
                <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-bg-inset">
                  {l.accuracy !== null && (
                    <span
                      className={`block h-full rounded-full ${l.confidence === 3 && l.accuracy < 0.8 ? 'bg-warn' : 'bg-fg-secondary'}`}
                      style={{ width: `${l.accuracy * 100}%` }}
                    />
                  )}
                </span>
                <span className="text-right font-mono text-xs" title={`su ${l.total} risposte`}>
                  {l.accuracy === null ? '—' : `${pct(l.accuracy)} giuste`}
                  {!l.reliable && l.total > 0 ? ' *' : ''}
                  <span className="sr-only"> su {l.total} risposte</span>
                </span>
              </li>
            ))}
          </ul>
          {c.levels.some((l) => !l.reliable && l.total > 0) && (
            <p className="text-xs text-fg-secondary">
              * meno di {c.minSamplesPerLevel} risposte: numero indicativo, non una conclusione.
            </p>
          )}
          <p className="text-xs text-fg-secondary">{NOTE}</p>
        </div>
      )}
    </section>
  );
}
