'use client';

import { useId } from 'react';
import { ChevronRight } from 'lucide-react';
import type { AttemptItemResultDto } from '@studyhub/contracts';
import { formatPoints, photoTranscriptNote, ratioTone } from '@/lib/simulationMobile';
import { PhotoImage } from './PhotoImage';
import { cardClass, toneBg } from './styles';

const textBlock = 'whitespace-pre-wrap text-sm [overflow-wrap:anywhere]';
const blockLabel = 'mb-1 text-xs font-medium uppercase tracking-[0.06em] text-fg-muted';

type Criteria = AttemptItemResultDto['criteria'];

function CriteriaList({ criteria, missing }: { criteria: Criteria; missing: string[] }) {
  return (
    <>
      <ul className="space-y-1.5">
        {criteria.map((c) => (
          <li key={c.criterion} className="flex justify-between gap-3 text-sm">
            <span className="min-w-0 text-fg-secondary [overflow-wrap:anywhere]">
              {c.criterion} — <span className="text-fg-muted">{c.feedback}</span>
            </span>
            <span className="shrink-0 font-mono tabular-nums text-fg-muted">
              {formatPoints(c.awarded)}/{formatPoints(c.max)}
            </span>
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <p className="mt-1.5 text-sm text-warn [overflow-wrap:anywhere]">
          Manca: {missing.join('; ')}
        </p>
      )}
    </>
  );
}

/** One exercise of the correction: score row that expands into answer, feedback, solution, source. */
export function ResultItem({
  slug,
  result: r,
  open,
  onToggle,
  opinionPending,
  opinionRequesting,
  opinionError,
  onAskOpinion,
}: {
  slug: string;
  result: AttemptItemResultDto;
  open: boolean;
  onToggle: () => void;
  /** A second opinion was requested and has not landed yet. */
  opinionPending: boolean;
  opinionRequesting: boolean;
  opinionError: string | null;
  onAskOpinion: () => void;
}) {
  const panelId = useId();
  const note = photoTranscriptNote(r.photos);
  const ratio = r.max > 0 ? r.awarded / r.max : 0;
  const tone = ratioTone(ratio);
  const score = `${formatPoints(r.awarded)}/${formatPoints(r.max)}`;
  const waiting = opinionPending || opinionRequesting;

  return (
    <article className={`${cardClass} overflow-hidden`} data-testid="result-item">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex min-h-16 w-full min-w-0 items-center gap-3 px-3.5 py-3 text-left"
      >
        <span className="w-6 shrink-0 font-mono text-[13px] tabular-nums text-fg-muted">
          {r.ord + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[15px] font-medium [overflow-wrap:anywhere]">
            {r.prompt}
          </span>
          <span aria-hidden="true" className="mt-1.5 block h-1 rounded-full bg-bg-raised">
            <span
              className={`block h-full rounded-full ${toneBg[tone]}`}
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </span>
        </span>
        <span
          aria-label={`Punteggio ${formatPoints(r.awarded)} su ${formatPoints(r.max)}`}
          className={`shrink-0 font-mono text-sm tabular-nums ${ratio < 0.5 ? 'text-danger' : 'text-fg-primary'}`}
        >
          {score}
        </span>
        <ChevronRight
          className={`size-[18px] shrink-0 text-fg-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
      </button>

      <div
        id={panelId}
        role="region"
        aria-label={`Dettaglio esercizio ${r.ord + 1}`}
        hidden={!open}
        className="min-w-0 space-y-3 border-t border-border px-3.5 py-3"
      >
        {open && (
          <>
            <div>
              <p className={blockLabel}>La tua risposta</p>
              <p
                className={`${textBlock} rounded-[var(--radius-control)] bg-bg-inset px-3 py-2 text-fg-secondary`}
              >
                {r.answer || (
                  <span className="italic text-fg-muted">
                    {r.photos.length > 0 ? 'Risposta nella foto' : 'Nessuna risposta'}
                  </span>
                )}
              </p>
              {r.photos.length > 0 && (
                <>
                  <p className={`${blockLabel} mt-2`}>Foto allegate ({r.photos.length})</p>
                  <ul className="grid grid-cols-3 gap-2" data-testid="result-photos">
                    {r.photos.map((p, i) => (
                      <li key={p.id}>
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener"
                          aria-label={`Apri la foto ${i + 1} a dimensione intera`}
                          className="block aspect-square min-h-11 overflow-hidden rounded-[var(--radius-control)] border border-border bg-bg-inset"
                        >
                          <PhotoImage
                            src={p.url}
                            alt={`Foto ${i + 1} della tua risposta, esercizio ${r.ord + 1}`}
                          />
                        </a>
                      </li>
                    ))}
                  </ul>
                  {note && (
                    <p
                      role={note.kind === 'unreadable' ? 'status' : undefined}
                      data-testid="photo-transcript-note"
                      className={`mt-1 text-xs ${note.kind === 'unreadable' ? 'text-warn' : 'text-fg-muted'}`}
                    >
                      {note.text}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--warn)_30%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,var(--bg-inset))] px-3 py-2">
              <p className={blockLabel}>Correzione</p>
              <CriteriaList criteria={r.criteria} missing={r.missing} />
            </div>

            <div>
              <p className={blockLabel}>Soluzione di riferimento</p>
              <p className={`${textBlock} text-fg-secondary`}>{r.solution}</p>
            </div>

            <div className="text-sm text-fg-secondary">
              <p className="[overflow-wrap:anywhere]">
                Dove ripassare: pag. {r.sourceRef.page} —{' '}
                <span className="font-mono text-xs text-fg-muted">
                  &quot;{r.sourceRef.quote}&quot;
                </span>
              </p>
              <a
                href={`/api/subjects/${slug}/documents/${r.sourceRef.docId}/file#page=${r.sourceRef.page}`}
                target="_blank"
                rel="noopener"
                className="flex min-h-11 items-center text-accent underline"
              >
                Apri la fonte
              </a>
            </div>

            {r.secondOpinion ? (
              <div className="rounded-[var(--radius-control)] border border-accent px-3 py-2">
                <p className="mb-1.5 text-sm font-medium text-accent">
                  Seconda opinione ({r.secondOpinion.model}):{' '}
                  {formatPoints(r.secondOpinion.awarded)}/{formatPoints(r.max)}
                </p>
                <CriteriaList
                  criteria={r.secondOpinion.criteria}
                  missing={r.secondOpinion.missing}
                />
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onAskOpinion}
                  disabled={waiting}
                  className="min-h-11 w-full rounded-[var(--radius-control)] border border-border-strong px-3 text-sm font-medium text-fg-primary disabled:opacity-60"
                >
                  {waiting ? 'Seconda opinione in corso…' : 'Chiedi una seconda opinione'}
                </button>
                {waiting && (
                  <p role="status" className="sr-only">
                    Seconda opinione in corso
                  </p>
                )}
              </>
            )}
            {opinionError && (
              <p role="alert" className="text-sm text-danger">
                {opinionError}
              </p>
            )}
          </>
        )}
      </div>
    </article>
  );
}
