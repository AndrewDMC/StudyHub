'use client';

import { useRef, type KeyboardEvent } from 'react';
import type { ExplanationDto, SessionItemCitationDto } from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import { FeedbackPoints } from '@/components/lesson/FeedbackPoints';
import {
  MIN_EXPLANATION_CHARS,
  canSubmitExplanation,
  explanationUiState,
  useExplanation,
  type ExplanationUiState,
} from '@/lib/lessonClient';

const LABEL = 'text-xs font-medium uppercase tracking-wide text-fg-secondary';

/** Presentation of "Rielabora": the explanation box and, once the job is done, the comparison. */
export function ExplainStepView({
  slug,
  ui,
  latest,
  text,
  onTextChange,
  canSubmit,
  submitting,
  errorMessage,
  onSubmit,
  onRetry,
  onOpenCitation,
}: {
  slug: string;
  ui: ExplanationUiState;
  latest: ExplanationDto | null;
  text: string;
  onTextChange: (text: string) => void;
  canSubmit: boolean;
  /** The POST is on its way. */
  submitting: boolean;
  /** Why the comparison failed (job error or the server's answer to the POST). */
  errorMessage: string | null;
  onSubmit: () => void;
  /** Same text, new comparison. */
  onRetry: () => void;
  onOpenCitation: (citation: SessionItemCitationDto) => void;
}) {
  const modes = useRef<(HTMLElement | null)[]>([]);
  const busy = ui === 'pending' || submitting;
  const count = text.trim().length;
  const unchanged = !!latest && text.trim() === latest.text.trim();
  const hasFeedback = !!latest?.feedback;

  function onModeKey(e: KeyboardEvent, index: number) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    modes.current[index === 0 ? 1 : 0]?.focus();
  }

  return (
    <section
      aria-labelledby="explain-title"
      className="space-y-4 rounded-[var(--radius-card)] border border-border bg-bg-surface p-5 md:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 max-md:flex-col">
        <div className="min-w-0 space-y-1">
          <h2
            id="explain-title"
            data-phase-heading
            tabIndex={-1}
            className="text-xl font-semibold text-fg-primary outline-none"
          >
            Rendilo tuo
          </h2>
          <p className="text-sm text-fg-secondary">
            Spiega l&apos;argomento come a un compagno, oppure fai lo schema. A libro chiuso, se ce
            la fai.
          </p>
        </div>
        <div role="radiogroup" aria-label="Modo" className="flex shrink-0 gap-1 max-md:w-full">
          <button
            ref={(el) => {
              modes.current[0] = el;
            }}
            type="button"
            role="radio"
            aria-checked="true"
            onKeyDown={(e) => onModeKey(e, 0)}
            className="h-9 flex-1 rounded-[var(--radius-control)] border border-accent bg-bg-raised px-3 text-sm text-fg-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent max-md:h-11"
          >
            Spiegalo
          </button>
          <a
            ref={(el) => {
              modes.current[1] = el;
            }}
            role="radio"
            aria-checked="false"
            href={`/materie/${slug}?tab=schemi`}
            target="_blank"
            rel="noopener"
            onKeyDown={(e) => onModeKey(e, 1)}
            className="flex h-9 flex-1 items-center justify-center rounded-[var(--radius-control)] border border-border px-3 text-sm text-fg-secondary outline-none hover:text-fg-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent max-md:h-11"
          >
            Schema
            <span className="sr-only"> (si apre in una nuova scheda)</span>
          </a>
        </div>
      </div>

      {ui === 'ended' && !latest ? (
        <p className="rounded-[var(--radius-control)] border border-dashed border-border p-4 text-sm text-fg-secondary">
          Non hai scritto una spiegazione in questa lezione.
        </p>
      ) : (
        <div className="space-y-2">
          <label htmlFor="explain-text" className={LABEL}>
            La tua spiegazione
          </label>
          <textarea
            id="explain-text"
            value={ui === 'ended' ? (latest?.text ?? '') : text}
            onChange={(e) => onTextChange(e.target.value)}
            readOnly={busy || ui === 'ended'}
            aria-busy={ui === 'pending' || undefined}
            aria-describedby="explain-count"
            rows={6}
            maxLength={8000}
            placeholder="Spiega con parole tue, come a un compagno…"
            className="w-full resize-y rounded-[var(--radius-control)] border border-border bg-bg-inset px-3 py-2 text-[15px] leading-relaxed text-fg-primary outline-none focus:border-accent read-only:opacity-70 max-md:min-h-40"
          />
          <p
            id="explain-count"
            className={`text-xs ${count > 0 && count < MIN_EXPLANATION_CHARS ? 'text-danger' : 'text-fg-muted'}`}
          >
            {count} caratteri · almeno {MIN_EXPLANATION_CHARS}
          </p>
        </div>
      )}

      {ui !== 'ended' && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="lg"
            disabled={!canSubmit || busy}
            aria-busy={busy || undefined}
            onClick={onSubmit}
            className="max-md:w-full"
          >
            {busy ? 'Invio…' : hasFeedback ? 'Correggi e riprova' : 'Confronta con il materiale'}
          </Button>
          {ui === 'done' && unchanged ? (
            <span className="text-xs text-fg-muted">Modifica la spiegazione per riprovare.</span>
          ) : (
            <span className="text-xs text-fg-muted">La correzione usa l&apos;AI.</span>
          )}
        </div>
      )}

      {ui === 'pending' && (
        <div role="status" aria-live="polite" className="space-y-2">
          <div className="space-y-2 motion-reduce:hidden" aria-hidden="true">
            <div className="h-3 w-4/5 animate-pulse rounded bg-bg-raised" />
            <div className="h-3 w-full animate-pulse rounded bg-bg-raised" />
            <div className="h-3 w-3/5 animate-pulse rounded bg-bg-raised" />
          </div>
          <p className="text-sm text-fg-secondary">
            Sto confrontando la tua spiegazione con il materiale…
          </p>
        </div>
      )}

      {ui === 'budget' && (
        <div
          role="alert"
          className="rounded-[var(--radius-card)] border border-danger/40 bg-danger/5 p-4 text-sm text-fg-primary"
        >
          Hai raggiunto il budget AI di oggi. Puoi passare agli esercizi e riprovare domani, oppure
          alza il limite nelle impostazioni.
        </div>
      )}

      {ui === 'failed' && (
        <div
          role="alert"
          className="space-y-3 rounded-[var(--radius-card)] border border-danger/40 bg-danger/5 p-4"
        >
          <p className="text-sm text-fg-primary">
            Non sono riuscito a confrontare la spiegazione: {errorMessage ?? 'errore sconosciuto'}.
            Puoi riprovare.
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={submitting || count < MIN_EXPLANATION_CHARS}
            onClick={onRetry}
          >
            {submitting ? 'Riprovo…' : 'Riprova'}
          </Button>
        </div>
      )}

      {ui === 'nofeedback' && (
        <div
          role="status"
          className="space-y-3 rounded-[var(--radius-card)] border border-border bg-bg-inset p-4"
        >
          <p className="text-sm text-fg-primary">Il confronto non è disponibile.</p>
          <Button
            type="button"
            variant="secondary"
            disabled={submitting || count < MIN_EXPLANATION_CHARS}
            onClick={onRetry}
          >
            {submitting ? 'Riprovo…' : 'Riprova'}
          </Button>
        </div>
      )}

      {latest?.feedback && (ui === 'done' || ui === 'ended') && (
        <div className="space-y-2" role="status">
          <p className={LABEL}>Confronto con il materiale</p>
          <FeedbackPoints feedback={latest.feedback} onOpenCitation={onOpenCitation} />
          {latest.feedback.model && (
            <p className="text-xs text-fg-muted">Modello: {latest.feedback.model}</p>
          )}
        </div>
      )}
    </section>
  );
}

/** "Rielabora": the student explains in their own words and the AI compares it with the material. */
export function ExplainStep({
  slug,
  sessionId,
  active,
  draft,
  onDraftChange,
  onOpenCitation,
}: {
  slug: string;
  sessionId: string;
  active: boolean;
  /** `null` until the student types: the last saved explanation is shown meanwhile. */
  draft: string | null;
  onDraftChange: (text: string) => void;
  onOpenCitation: (citation: SessionItemCitationDto) => void;
}) {
  const explanation = useExplanation({ slug, sessionId, active });
  const { latest, submit } = explanation;
  const text = draft ?? latest?.text ?? '';
  const submitError = submit.isError ? (submit.error as Error).message : null;
  const ui = explanationUiState(explanation.query.data, { active, submitError });
  const errorMessage = submitError ?? explanation.job?.error ?? null;

  if (explanation.query.isLoading) {
    return (
      <p role="status" className="text-sm text-fg-secondary">
        Caricamento…
      </p>
    );
  }
  if (explanation.query.isError && !explanation.query.data) {
    return (
      <p role="alert" className="text-sm text-danger">
        {(explanation.query.error as Error).message}
      </p>
    );
  }

  return (
    <ExplainStepView
      slug={slug}
      ui={ui}
      latest={latest}
      text={text}
      onTextChange={onDraftChange}
      canSubmit={canSubmitExplanation(text, latest, { busy: submit.isPending, active })}
      submitting={submit.isPending}
      errorMessage={errorMessage}
      onSubmit={() => submit.mutate({ text: text.trim() })}
      onRetry={() => submit.mutate({ text: text.trim() })}
      onOpenCitation={onOpenCitation}
    />
  );
}
