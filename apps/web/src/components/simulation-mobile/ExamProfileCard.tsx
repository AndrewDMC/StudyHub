'use client';

import { useId, type RefObject } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ExamProfileDto } from '@studyhub/contracts';
import { formatPoints } from '@/lib/simulationMobile';
import { SectionEmpty, SectionError, SkeletonRows } from '../subject-mobile/SectionState';
import { cardClass } from './styles';

const MAX_TOPIC_PILLS = 8;

const smallButton =
  'min-h-11 rounded-[var(--radius-control)] border border-border-strong px-3 text-[13px] font-semibold text-fg-primary disabled:opacity-50';

/** "Profilo dell'esame": the four numbers the simulations copy, recurring topics, edit / re-extract. */
export function ExamProfileCard({
  query,
  notice,
  onEdit,
  onReextract,
  editRef,
  reextractRef,
}: {
  query: UseQueryResult<ExamProfileDto | null>;
  /** Confirmation of a started extraction. */
  notice: string | null;
  onEdit: () => void;
  onReextract: () => void;
  editRef: RefObject<HTMLButtonElement | null>;
  reextractRef: RefObject<HTMLButtonElement | null>;
}) {
  const headingId = useId();
  const profile = query.data;

  let body;
  if (query.isLoading) {
    body = <SkeletonRows count={1} />;
  } else if (query.isError) {
    body = (
      <SectionError message={(query.error as Error).message} onRetry={() => void query.refetch()} />
    );
  } else if (!profile) {
    body = (
      <>
        <SectionEmpty>
          Nessun profilo d&apos;esame. Carica gli esami passati come tipo &quot;Esami&quot;, poi
          estrai il profilo.
        </SectionEmpty>
        <button
          type="button"
          ref={reextractRef}
          aria-haspopup="dialog"
          onClick={onReextract}
          className={smallButton}
        >
          Estrai profilo
        </button>
      </>
    );
  } else {
    const p = profile.profile;
    const sources = profile.sourceDocIds.length;
    const kv: [string, string][] = [
      ['Durata (min)', formatPoints(p.durationMin)],
      ['Esercizi', formatPoints(p.itemCount)],
      ['Punti totali', formatPoints(p.totalPoints)],
      ['Min per esercizio', formatPoints(p.avgMinutesPerItem)],
    ];
    const shown = p.recurringTopics.slice(0, MAX_TOPIC_PILLS);
    const extra = p.recurringTopics.length - shown.length;
    body = (
      <>
        <p className="text-[13px] text-fg-secondary">
          {sources > 0 &&
            `Estratto da ${sources} ${sources === 1 ? 'esame passato' : 'esami passati'}. `}
          Le simulazioni ne copiano formato e peso degli argomenti.
        </p>
        <dl className="grid grid-cols-2 gap-2">
          {kv.map(([label, value]) => (
            <div
              key={label}
              className="flex min-w-0 flex-col-reverse rounded-[var(--radius-control)] bg-bg-raised p-3"
            >
              <dt className="text-xs text-fg-secondary">{label}</dt>
              <dd className="font-mono text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {shown.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs text-fg-muted">Argomenti ricorrenti</p>
            <ul className="flex flex-wrap gap-1.5">
              {shown.map((t) => (
                <li
                  key={t}
                  className="max-w-full truncate rounded-full border border-border bg-bg-raised px-2.5 py-1 text-xs text-fg-secondary"
                >
                  {t}
                </li>
              ))}
              {extra > 0 && (
                <li className="rounded-full border border-border bg-bg-raised px-2.5 py-1 text-xs text-fg-muted">
                  +{extra}
                </li>
              )}
            </ul>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            ref={editRef}
            aria-haspopup="dialog"
            onClick={onEdit}
            className={smallButton}
          >
            Modifica
          </button>
          <button
            type="button"
            ref={reextractRef}
            aria-haspopup="dialog"
            onClick={onReextract}
            className={smallButton}
          >
            Ri-estrai profilo
          </button>
        </div>
      </>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={query.isLoading || undefined}
      className={`${cardClass} flex min-w-0 flex-col gap-3 p-4`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-[17px] font-semibold">
          Profilo dell&apos;esame
        </h2>
        {profile?.edited && (
          <span className="shrink-0 rounded-full border border-info px-2 py-0.5 text-xs text-info">
            Modificato a mano
          </span>
        )}
      </div>
      {body}
      {notice && (
        <p role="status" className="text-[13px] text-ok">
          {notice}
        </p>
      )}
    </section>
  );
}
