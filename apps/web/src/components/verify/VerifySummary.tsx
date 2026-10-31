'use client';

import Link from 'next/link';
import type { VerifySummaryDto } from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import { formatVerifyDate, masteryPercent } from '@/lib/verifyClient';
import { cn } from '@/lib/utils';

/** The final outcome: N su M, what is not stable yet, the next check and mastery before → after. */
export function VerifySummary({
  summary,
  subjectHref,
  topicName,
  canRetry,
  retrying,
  onRetry,
  retryError,
  closed,
  closing,
  closeError,
  onClose,
  onBack,
}: {
  summary: VerifySummaryDto;
  subjectHref: string;
  topicName: string | null;
  canRetry: boolean;
  retrying: boolean;
  onRetry: () => void;
  retryError: string | null;
  /** The session is already over: read-only, only the way back. */
  closed: boolean;
  closing: boolean;
  closeError: string | null;
  /** "Chiudi la verifica": ends the session. */
  onClose: () => void;
  /** "Torna alla materia" before closing: ends the session, then goes. */
  onBack: () => void;
}) {
  const { unstable, nextVerifyDate } = summary;
  const date = nextVerifyDate ? formatVerifyDate(nextVerifyDate) : null;
  const before = masteryPercent(summary.masteryBefore);
  const now = masteryPercent(summary.masteryNow);
  const topic = topicName ?? 'questo argomento';
  const delta = before !== null && now !== null ? now - before : 0;

  return (
    <section
      aria-labelledby="esito"
      className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-bg-surface p-6 max-md:p-4"
    >
      <span className="text-xs uppercase tracking-wider text-fg-secondary">Esito</span>
      <h2
        id="esito"
        data-verify-heading
        tabIndex={-1}
        className="text-[28px] font-semibold tracking-tight outline-none max-md:text-2xl"
      >
        {summary.correct} su {summary.total} senza aprire il materiale
      </h2>

      <div className="space-y-1 text-fg-secondary">
        {unstable.length === 1 && <p>{unstable[0]} non è ancora stabile.</p>}
        {unstable.length >= 2 && (
          <>
            <p>Non sono ancora stabili:</p>
            <ul className="list-disc pl-5">
              {unstable.map((title, i) => (
                <li key={i}>{title}</li>
              ))}
            </ul>
          </>
        )}
        {unstable.length > 0 && date && (
          <p>
            {unstable.length === 1 ? 'Lo rimetto' : 'Li rimetto'} nella verifica del {date}.
          </p>
        )}
        {unstable.length === 0 && (
          <p>
            Tutto stabile: niente da rivedere per ora.
            {date ? ` La prossima verifica è il ${date}.` : ''}
          </p>
        )}
      </div>

      {now !== null && (
        <p className="text-sm">
          Padronanza di {topic}:{' '}
          {before !== null ? (
            <span
              aria-label={`da ${before}% a ${now}%`}
              className={cn(
                'font-mono tabular-nums',
                delta > 0 ? 'text-ok' : delta < 0 ? 'text-fg-primary' : 'text-fg-secondary',
              )}
            >
              {before}% → {now}%
            </span>
          ) : (
            <span className="font-mono tabular-nums">{now}%</span>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-start gap-2.5 max-md:flex-col">
        {closed ? (
          <Button asChild size="lg">
            <Link href={subjectHref}>Torna alla materia</Link>
          </Button>
        ) : (
          <>
            <Button
              type="button"
              size="lg"
              disabled={closing}
              aria-busy={closing}
              onClick={onClose}
            >
              {closing ? 'Chiudo…' : 'Chiudi la verifica'}
            </Button>
            <Button type="button" size="lg" variant="secondary" disabled={closing} onClick={onBack}>
              Torna alla materia
            </Button>
          </>
        )}
        {canRetry && !closed && (
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              size="lg"
              variant="secondary"
              disabled={retrying}
              aria-busy={retrying}
              onClick={onRetry}
            >
              {retrying ? 'Preparo…' : 'Rifalla'}
            </Button>
            <p className="text-xs text-fg-muted">Rifai solo le domande che non erano giuste.</p>
          </div>
        )}
      </div>
      {closeError && (
        <p role="alert" className="text-xs text-danger">
          Non sono riuscito a chiudere la verifica: {closeError}
        </p>
      )}
      {retryError && (
        <p role="alert" className="text-xs text-danger">
          Non sono riuscito a rifare la verifica: {retryError}
        </p>
      )}
    </section>
  );
}
