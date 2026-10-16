'use client';

import { useState, type RefObject } from 'react';
import Link from 'next/link';
import type {
  SessionFocus,
  SessionItemCitationDto,
  SessionItemDto,
  StudySessionDto,
  UpdateSessionItemRequest,
} from '@studyhub/contracts';
import { MODEL_OPTIONS, ModelPicker } from '@/components/ModelPicker';
import { DIFFICULTY_LABELS, Markdown, useSessionBriefing } from '@/components/SessionBriefing';
import { formatPageRanges } from '@/lib/sessionMobile';
import { cardClass, primaryButton, secondaryButton } from '../simulation-mobile/styles';
import { SectionError, SkeletonRows } from '../subject-mobile/SectionState';
import type { SourceRef } from './SourceSheet';

type OpenSource = (source: SourceRef, trigger: HTMLElement) => void;

const labelClass = 'text-xs font-semibold uppercase tracking-[0.06em] text-fg-secondary';
const chipClass =
  'inline-flex min-h-11 items-center rounded-full px-3 text-[13px] font-medium break-words';
const DIFFICULTY_TONE: Record<number, string> = {
  1: 'border-[color-mix(in_srgb,var(--ok)_40%,transparent)] text-ok',
  2: 'border-[color-mix(in_srgb,var(--warn)_40%,transparent)] text-warn',
  3: 'border-[color-mix(in_srgb,var(--danger)_40%,transparent)] text-danger',
};

function CitationChips({
  citations,
  onSource,
}: {
  citations: SessionItemCitationDto[];
  onSource: OpenSource;
}) {
  return (
    <>
      {citations.map((c) => (
        <button
          key={`${c.docId}:${c.page}:${c.quote}`}
          type="button"
          aria-label={`Fonte: ${c.documentName}, pagina ${c.page}`}
          onClick={(e) => onSource(c, e.currentTarget)}
          className={`${chipClass} bg-accent-subtle text-accent`}
        >
          ↗ {c.documentName} · p. {c.page}
        </button>
      ))}
    </>
  );
}

function KeyPointRow({
  item,
  index,
  pending,
  onToggle,
  onSource,
  onAsk,
}: {
  item: SessionItemDto;
  index: number;
  pending: boolean;
  onToggle: (done: boolean) => void;
  onSource: OpenSource;
  onAsk: (focus: SessionFocus) => void;
}) {
  const [open, setOpen] = useState(false);
  const done = item.state === 'done';
  const first = item.citations[0];
  return (
    <li className="py-2">
      <div className="flex min-w-0 gap-2.5">
        <b aria-hidden="true" className="pt-[3px] font-mono text-xs font-medium text-fg-secondary">
          {String(index + 1).padStart(2, '0')}
        </b>
        <p
          className={`min-w-0 flex-1 break-words text-[15px] leading-normal ${
            done ? 'text-fg-secondary line-through' : ''
          }`}
        >
          {item.title}
        </p>
        <button
          type="button"
          aria-pressed={done}
          disabled={pending}
          onClick={() => onToggle(!done)}
          className={`min-h-11 shrink-0 rounded-[var(--radius-control)] border px-3 text-[13px] font-medium disabled:opacity-50 ${
            done ? 'border-ok text-ok' : 'border-border-strong text-fg-secondary'
          }`}
        >
          Capito
        </button>
      </div>
      <div className="pl-7">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`kp-body-${item.id}`}
          onClick={() => setOpen((v) => !v)}
          className="min-h-11 text-[13px] font-medium text-accent"
        >
          Spiegazione
        </button>
        {open && (
          <div id={`kp-body-${item.id}`} className="break-words text-fg-secondary">
            <Markdown source={item.body} />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <CitationChips citations={item.citations} onSource={onSource} />
          {first && (
            <button
              type="button"
              onClick={() => onAsk({ docId: first.docId, page: first.page, text: first.quote })}
              className={`${chipClass} border border-border bg-transparent text-fg-secondary`}
            >
              Spiegami meglio
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function ExerciseCard({
  item,
  index,
  total,
  grading,
  gradeError,
  onPatch,
  onGrade,
  onSource,
}: {
  item: SessionItemDto;
  index: number;
  total: number;
  grading: boolean;
  gradeError: string | null;
  onPatch: (patch: UpdateSessionItemRequest) => void;
  onGrade: (answer: string) => void;
  onSource: OpenSource;
}) {
  const [answer, setAnswer] = useState(item.answer ?? '');
  const [showSolution, setShowSolution] = useState(item.state !== 'open');
  const assess = (state: 'correct' | 'wrong') =>
    onPatch({ state: item.state === state ? 'open' : state });
  const titleId = `ex-title-${item.id}`;
  const outcome = item.state === 'correct' || item.state === 'wrong';

  return (
    <section aria-labelledby={titleId} className={`${cardClass} flex flex-col gap-3 p-4`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className={labelClass}>
          Esercizio {index + 1} di {total}
        </h2>
        {item.difficulty && (
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs ${DIFFICULTY_TONE[item.difficulty] ?? ''}`}
          >
            {DIFFICULTY_LABELS[item.difficulty]}
          </span>
        )}
      </div>
      <div className="break-words text-base font-medium [&_.katex-display]:overflow-x-auto">
        <Markdown source={item.title} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`ans-${item.id}`}
          className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-secondary"
        >
          La tua risposta
        </label>
        <textarea
          id={`ans-${item.id}`}
          value={answer}
          rows={3}
          onChange={(e) => setAnswer(e.target.value)}
          onBlur={() => {
            if (answer !== (item.answer ?? '')) onPatch({ answer });
          }}
          className="min-h-[88px] w-full resize-y rounded-[var(--radius-control)] border border-border bg-bg-inset px-3 py-2.5 text-base leading-normal text-fg-primary outline-none focus:border-accent"
        />
      </div>

      {!showSolution && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={grading || !answer.trim()}
            aria-busy={grading || undefined}
            onClick={() => onGrade(answer)}
            className={`${primaryButton} min-h-11 text-[13px]`}
          >
            {grading ? 'Correggo…' : 'Correggi con l’AI'}
          </button>
          <button
            type="button"
            onClick={() => setShowSolution(true)}
            className={`${secondaryButton} min-h-11 text-[13px]`}
          >
            Vedi soluzione
          </button>
          {!answer.trim() && (
            <p className="col-span-2 text-xs text-fg-secondary">Scrivi prima una risposta.</p>
          )}
        </div>
      )}
      {gradeError && (
        <p role="alert" className="text-xs text-danger">
          {gradeError}
        </p>
      )}

      {(outcome || item.feedback) && (
        <div
          role="status"
          className={`flex flex-col gap-1 rounded-[10px] border p-3 ${
            item.state === 'correct'
              ? 'border-ok bg-[color-mix(in_srgb,var(--ok)_8%,var(--bg-inset))]'
              : item.state === 'wrong'
                ? 'border-danger bg-[color-mix(in_srgb,var(--danger)_8%,var(--bg-inset))]'
                : 'border-border bg-bg-inset'
          }`}
        >
          {outcome && (
            <span
              className={`text-[11px] font-semibold uppercase ${
                item.state === 'correct' ? 'text-ok' : 'text-danger'
              }`}
            >
              {item.state === 'correct' ? 'Giusto' : 'Da rivedere'}
            </span>
          )}
          {item.feedback && (
            <>
              <span className="text-[11px] font-semibold uppercase text-fg-secondary">
                Correzione dell&apos;AI · {Math.round(item.feedback.score * 100)}%
              </span>
              <div className="break-words">
                <Markdown source={item.feedback.feedback} />
              </div>
              {item.feedback.missing.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-fg-secondary">
                  {item.feedback.missing.map((m) => (
                    <li key={m}>Manca: {m}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {(showSolution || item.feedback) && (
        <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-bg-inset p-3">
          <span className={labelClass}>Soluzione</span>
          <div className="break-words [&_.katex-display]:overflow-x-auto">
            <Markdown source={item.body} />
          </div>
          <div className="flex flex-wrap gap-2">
            <CitationChips citations={item.citations} onSource={onSource} />
          </div>
          <p className="text-xs text-fg-secondary">Com&apos;è andata?</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={item.state === 'correct'}
              onClick={() => assess('correct')}
              className={`min-h-11 rounded-[var(--radius-control)] border px-2 text-[13px] font-semibold ${
                item.state === 'correct'
                  ? 'border-ok text-ok'
                  : 'border-border-strong bg-bg-raised text-fg-primary'
              }`}
            >
              Ho risposto bene
            </button>
            <button
              type="button"
              aria-pressed={item.state === 'wrong'}
              onClick={() => assess('wrong')}
              className={`min-h-11 rounded-[var(--radius-control)] border px-2 text-[13px] font-semibold ${
                item.state === 'wrong'
                  ? 'border-danger text-danger'
                  : 'border-border-strong bg-bg-raised text-fg-primary'
              }`}
            >
              Ho sbagliato
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Key points and exercises of the session (tab "Punti chiave ed esercizi"). */
export function BriefingMobile({
  slug,
  sessionId,
  session,
  onSource,
  onAsk,
  onOpenTopics,
  topicsRef,
}: {
  slug: string;
  sessionId: string;
  session: StudySessionDto;
  onSource: OpenSource;
  onAsk: (focus: SessionFocus) => void;
  onOpenTopics: () => void;
  topicsRef: RefObject<HTMLButtonElement | null>;
}) {
  const hasDocuments = session.documents.length > 0;
  const b = useSessionBriefing({ slug, sessionId, active: true, hasDocuments });
  const { query, data, items, keyPoints, exercises, inFlight, failed, mode, model, patch, grade } =
    b;

  if (query.isLoading) {
    return (
      <div aria-busy="true">
        <SkeletonRows count={3} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <SectionError message={(query.error as Error).message} onRetry={() => void query.refetch()} />
    );
  }

  const generateControls = (
    <div className="flex flex-col gap-2">
      <div className="[&_select]:min-h-11 [&_select]:text-sm">
        <ModelPicker
          value={model}
          onChange={b.setModel}
          disabled={b.start.isPending || inFlight}
          defaultId={MODEL_OPTIONS[1].id}
        />
      </div>
      <button
        type="button"
        disabled={!hasDocuments || b.start.isPending || inFlight}
        aria-busy={b.start.isPending || undefined}
        onClick={() => b.start.mutate()}
        className={`${primaryButton} min-h-12`}
      >
        {mode === 'all'
          ? `Genera punti chiave ed esercizi${b.costLabel}`
          : `Altri esercizi${b.costLabel}`}
      </button>
      {b.estimate.isError && (
        <p className="text-xs text-fg-secondary">Stima costo non disponibile.</p>
      )}
      {b.start.isError && (
        <p role="alert" className="text-xs text-danger">
          {(b.start.error as Error).message}
        </p>
      )}
    </div>
  );

  const topicsButton = (
    <button
      ref={topicsRef}
      type="button"
      aria-haspopup="dialog"
      onClick={onOpenTopics}
      className="min-h-11 self-start rounded-full border border-border bg-bg-surface px-4 text-[13px] text-fg-secondary"
    >
      Argomenti ({session.topics.length})
    </button>
  );

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {topicsButton}
        {inFlight ? (
          <div role="status" aria-live="polite" className={`${cardClass} flex flex-col gap-3 p-4`}>
            <div className="space-y-2" aria-hidden="true">
              <div className="h-3 animate-pulse rounded bg-bg-raised" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-bg-raised" />
              <div className="h-3 w-3/5 animate-pulse rounded bg-bg-raised" />
            </div>
            <p className="text-sm text-fg-secondary">
              Sto preparando i punti chiave e gli esercizi dal materiale…
            </p>
          </div>
        ) : (
          <div className={`${cardClass} flex flex-col gap-3 p-4`}>
            <h2 className="text-base font-semibold">Punti chiave ed esercizi</h2>
            <p className="text-sm text-fg-secondary">
              Una checklist di ciò che devi aver capito e qualche esercizio, ricavati solo dal
              materiale di questa sessione, ognuno con la citazione da cui nasce.
            </p>
            {failed && (
              <p role="alert" className="text-sm text-danger">
                Generazione non riuscita: {failed.error ?? 'errore sconosciuto'}. Puoi riprovare.
              </p>
            )}
            {!hasDocuments && (
              <p className="text-sm text-fg-secondary">
                Nessun documento in questa sessione: scegli un argomento con il pulsante
                «Argomenti».
              </p>
            )}
            {generateControls}
          </div>
        )}
      </div>
    );
  }

  const done = keyPoints.filter((k) => k.state === 'done').length;
  const sourceDocs = session.documents.some((d) => d.highlighted)
    ? session.documents.filter((d) => d.highlighted)
    : session.documents;

  return (
    <div className="flex flex-col gap-4">
      {topicsButton}
      {(patch.isError || failed) && (
        <p role="alert" className="text-sm text-danger">
          {patch.isError
            ? (patch.error as Error).message
            : `Generazione non riuscita: ${failed?.error ?? 'errore sconosciuto'}. Puoi riprovare.`}
        </p>
      )}

      {keyPoints.length > 0 && (
        <section aria-labelledby="kp-title" className={`${cardClass} flex flex-col gap-3 p-4`}>
          <div className="flex items-center justify-between gap-2">
            <h2 id="kp-title" className={labelClass}>
              Punti chiave
            </h2>
            <span className="font-mono text-xs text-fg-secondary">
              {done}/{keyPoints.length} capiti
            </span>
          </div>
          <ol className="flex flex-col divide-y divide-border">
            {keyPoints.map((item, i) => (
              <KeyPointRow
                key={item.id}
                item={item}
                index={i}
                pending={patch.isPending}
                onToggle={(d) => patch.mutate({ id: item.id, state: d ? 'done' : 'open' })}
                onSource={onSource}
                onAsk={onAsk}
              />
            ))}
          </ol>
          {sourceDocs.length > 0 && (
            <div className="flex flex-col">
              {sourceDocs.map((doc) => {
                const ranges = formatPageRanges(doc);
                return (
                  <Link
                    key={doc.id}
                    href={`/materie/${slug}/documenti/${doc.id}`}
                    className="inline-flex min-h-11 items-center break-words text-[13px] font-medium text-accent"
                  >
                    Da: {doc.name}
                    {ranges ? `, ${ranges}` : ''}
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}

      {exercises.map((item, i) => (
        <ExerciseCard
          key={item.id}
          item={item}
          index={i}
          total={exercises.length}
          grading={grade.isPending && grade.variables?.id === item.id}
          gradeError={
            grade.isError && grade.variables?.id === item.id ? (grade.error as Error).message : null
          }
          onPatch={(body) => patch.mutate({ id: item.id, ...body })}
          onGrade={(answer) => grade.mutate({ id: item.id, answer })}
          onSource={onSource}
        />
      ))}

      {inFlight ? (
        <p role="status" className="text-sm text-fg-secondary">
          Sto preparando altri esercizi…
        </p>
      ) : (
        generateControls
      )}

      {data && data.costEur > 0 && (
        <p className="text-xs text-fg-secondary">Costo AI: €{data.costEur.toFixed(4)}</p>
      )}
    </div>
  );
}
