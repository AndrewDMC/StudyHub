'use client';

import type { StudySessionDto } from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import { SessionClosing, minutes, useSessionClosing } from '@/components/SessionClosing';

/** The line under the title: only the pieces that are not zero. */
export function recallSummary(totals: {
  activeMs: number;
  keyPoints: number;
  right: number;
  answered: number;
}): string {
  const parts: string[] = [];
  const min = minutes(totals.activeMs);
  if (min > 0) parts.push(`${min} min di studio reale`);
  if (totals.keyPoints > 0) parts.push(`${totals.keyPoints} punti chiave`);
  if (totals.answered > 0) parts.push(`${totals.right} esercizi su ${totals.answered} corretti`);
  return parts.length > 0 ? parts.join(' · ') : 'Appena chiudi, qui trovi il riepilogo.';
}

/** "Ricorda": closes the lesson (active) or shows the closing with flashcards and drill (ended). */
export function RecallStep({
  slug,
  sessionId,
  session,
  sessionKey,
  active,
  activeMs,
  ending,
  endError,
  onEnd,
  onGoApply,
  variant = 'standard',
  summary,
}: {
  slug: string;
  sessionId: string;
  session: StudySessionDto;
  sessionKey: readonly unknown[];
  active: boolean;
  /** The live stopwatch while the session is open. */
  activeMs: number;
  ending: boolean;
  endError: string | null;
  onEnd: () => void;
  /** Standard lesson only: where the key points are made. */
  onGoApply?: (() => void) | undefined;
  /** A sprint lesson has no key points and no "Applica": the text and the closing differ. */
  variant?: 'standard' | 'sprint';
  /** Sprint: the line under the title (the standard one is computed from the key points). */
  summary?: string | undefined;
}) {
  const sprint = variant === 'sprint';
  const closing = useSessionClosing(slug, sessionId, session, sessionKey);

  return (
    <section
      aria-labelledby="recall-title"
      className="space-y-4 rounded-[var(--radius-card)] border border-border bg-bg-surface p-5 md:p-6"
    >
      <div className="space-y-1">
        <h2
          id="recall-title"
          data-phase-heading
          tabIndex={-1}
          className="text-xl font-semibold text-fg-primary outline-none"
        >
          Fissalo nel tempo
        </h2>
        {active && (
          <p className="text-sm text-fg-secondary">
            {sprint
              ? (summary ?? recallSummary({ activeMs, keyPoints: 0, right: 0, answered: 0 }))
              : recallSummary({
                  activeMs,
                  keyPoints: closing.keyPoints,
                  right: closing.right,
                  answered: closing.answered.length,
                })}
          </p>
        )}
      </div>

      {active ? (
        <>
          <div className="space-y-2 rounded-[var(--radius-control)] border border-border bg-bg-inset p-4 text-sm text-fg-secondary">
            <p>
              {sprint
                ? 'Quando chiudi la lezione potrai creare un drill con gli esercizi sbagliati. Resta in bozza finché non lo approvi.'
                : 'Quando chiudi la lezione potrai creare le flashcard dai punti chiave e un drill con gli esercizi sbagliati. Sono gratis e restano in bozza finché non li approvi.'}
            </p>
            {session.taskId && (
              <p>Le verifiche di questo argomento sono nel piano a +3 e +7 giorni.</p>
            )}
            {!sprint && onGoApply && !closing.briefing.isLoading && closing.keyPoints === 0 && (
              <p className="text-xs text-fg-muted">
                Per le flashcard servono i punti chiave: li prepara «Genera punti chiave ed
                esercizi» in Applica.{' '}
                <button
                  type="button"
                  onClick={onGoApply}
                  className="min-h-11 text-accent underline-offset-2 hover:underline md:min-h-0"
                >
                  Vai a Applica
                </button>
              </p>
            )}
          </div>
          <Button
            type="button"
            size="lg"
            disabled={ending}
            onClick={onEnd}
            className="max-md:w-full"
          >
            {ending ? 'Chiudo…' : 'Chiudi la lezione'}
          </Button>
          {endError && (
            <p role="alert" className="text-sm text-danger">
              {endError}
            </p>
          )}
        </>
      ) : (
        <>
          <SessionClosing
            slug={slug}
            sessionId={sessionId}
            session={session}
            sessionKey={sessionKey}
            hideFlashcards={sprint}
          />
          {session.taskId && (
            <p className="text-sm text-fg-secondary">
              Le verifiche di questo argomento sono nel piano a +3 e +7 giorni.
            </p>
          )}
        </>
      )}
    </section>
  );
}
