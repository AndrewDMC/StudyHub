'use client';

import { useQuery } from '@tanstack/react-query';
import type { CalibrationDto } from '@studyhub/contracts';

async function fetchCalibration(slug: string): Promise<CalibrationDto> {
  const res = await fetch(`/api/subjects/${slug}/stats/calibration`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare la calibrazione');
  return body.calibration as CalibrationDto;
}

const LEVEL_LABELS = { 1: 'Non lo so', 2: 'Forse', 3: 'Lo so' } as const;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** One plain sentence per verdict. Never a judgment from too few answers. */
function headline(c: CalibrationDto): string {
  switch (c.verdict) {
    case 'overconfident':
      return `Tendi a sopravvalutarti: sei più sicuro di quanto i risultati giustifichino (scarto ${Math.round((c.bias ?? 0) * 100)} punti).`;
    case 'underconfident':
      return `Tendi a sottovalutarti: sai più di quanto pensi (scarto ${Math.round(Math.abs(c.bias ?? 0) * 100)} punti).`;
    case 'calibrated':
      return 'Sei ben calibrato: la fiducia che dichiari segue i tuoi risultati.';
    default:
      return `Servono più risposte con la fiducia dichiarata (almeno ${c.minSamplesPerLevel} per livello) prima di dire qualcosa.`;
  }
}

/**
 * Confidence vs. correctness (docs/06-miglioramenti.md #4): where the user is *illuso di sapere*.
 * Accuracy per level is shown as a number and a bar — the bar is never the only carrier.
 */
export function CalibrationPanel({ subjectSlug }: { subjectSlug: string }) {
  const query = useQuery({
    queryKey: ['calibration', subjectSlug],
    queryFn: () => fetchCalibration(subjectSlug),
  });

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3">
      <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
        Calibrazione della fiducia
      </h2>
      {query.isLoading && <p className="px-1 text-xs text-fg-muted">Caricamento…</p>}
      {query.isError && (
        <p role="alert" className="px-1 text-xs text-danger">
          {(query.error as Error).message}
        </p>
      )}
      {query.isSuccess && query.data.total === 0 && (
        <p className="px-1 text-xs text-fg-muted">
          Nessun dato. Durante il ripasso, prima di girare la carta premi <kbd>1</kbd> (non lo so),{' '}
          <kbd>2</kbd> (forse) o <kbd>3</kbd> (lo so): il sistema confronta la tua fiducia con il
          risultato.
        </p>
      )}
      {query.isSuccess && query.data.total > 0 && (
        <div className="space-y-3 px-1 text-xs" data-testid="calibration">
          <p className="text-fg-secondary">{headline(query.data)}</p>

          <ul className="space-y-1.5">
            {query.data.levels.map((l) => (
              <li key={l.confidence} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-fg-secondary">
                  {LEVEL_LABELS[l.confidence]}
                </span>
                <span
                  role="img"
                  aria-label={
                    l.accuracy === null ? 'nessuna risposta' : `${pct(l.accuracy)} corrette`
                  }
                  className="relative h-1.5 flex-1 rounded-full bg-bg-inset"
                >
                  {l.accuracy !== null && (
                    <span
                      className={`absolute inset-y-0 left-0 rounded-full ${l.reliable ? 'bg-accent' : 'bg-border-strong'}`}
                      style={{ width: `${l.accuracy * 100}%` }}
                    />
                  )}
                </span>
                <span className="w-24 shrink-0 text-right font-mono tabular-nums text-fg-secondary">
                  {l.accuracy === null ? '—' : pct(l.accuracy)} · {l.total}
                  {!l.reliable && l.total > 0 ? ' *' : ''}
                </span>
              </li>
            ))}
          </ul>
          {query.data.levels.some((l) => !l.reliable && l.total > 0) && (
            <p className="text-[11px] text-fg-muted">
              * meno di {query.data.minSamplesPerLevel} risposte: numero indicativo, non una
              conclusione.
            </p>
          )}

          {query.data.illusionRate !== null && query.data.illusionRate > 0 && (
            <p className="text-fg-secondary">
              Quando eri sicuro hai sbagliato il{' '}
              <span className="font-medium text-warn">{pct(query.data.illusionRate)}</span> delle
              volte.
            </p>
          )}
          {query.data.hiddenKnowledgeRate !== null && query.data.hiddenKnowledgeRate > 0 && (
            <p className="text-fg-secondary">
              Quando pensavi di non saperlo, hai risposto giusto il{' '}
              <span className="font-medium text-info">{pct(query.data.hiddenKnowledgeRate)}</span>{' '}
              delle volte.
            </p>
          )}

          {query.data.illusionByTopic.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-fg-primary">Dove ti illudi di più</p>
              <ul className="space-y-0.5 text-fg-secondary">
                {query.data.illusionByTopic.slice(0, 5).map((t) => (
                  <li key={t.topicId}>
                    {t.name} — sicuro {t.sure} volte, sbagliato {t.sureButWrong} (
                    {pct(t.illusionRate)})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
