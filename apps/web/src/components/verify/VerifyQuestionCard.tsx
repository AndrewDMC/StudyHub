'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { VerifyCitation } from '@/lib/verifyClient';
import type { VerifyItemDto } from '@studyhub/contracts';
import { Markdown } from '@/components/SessionBriefing';
import { Button } from '@/components/ui/button';
import { KeyPointDisclosure } from '@/components/verify/KeyPointDisclosure';
import { VerifyOutcome } from '@/components/verify/VerifyOutcome';
import { draftKey, questionTypeLabel } from '@/lib/verifyClient';
import { isBudgetMessage } from '@/lib/lessonClient';

function readDraft(sessionId: string, itemId: string): string {
  try {
    return window.sessionStorage.getItem(draftKey(sessionId, itemId)) ?? '';
  } catch {
    return '';
  }
}
function writeDraft(sessionId: string, itemId: string, value: string) {
  try {
    if (value) window.sessionStorage.setItem(draftKey(sessionId, itemId), value);
    else window.sessionStorage.removeItem(draftKey(sessionId, itemId));
  } catch {
    /* no storage: the draft just lives in the page */
  }
}

/** One question: the text, the answer box, "Correggi" / "Non me lo ricordo", then outcome and key point. */
export function VerifyQuestionCard({
  sessionId,
  item,
  n,
  total,
  ended,
  busy,
  grading,
  error,
  nextLabel,
  onGrade,
  onUnknown,
  onNext,
  onOpenCitation,
  barSlot,
}: {
  sessionId: string;
  item: VerifyItemDto;
  n: number;
  total: number;
  ended: boolean;
  /** A correction or "Non me lo ricordo" is on its way. */
  busy: boolean;
  /** The AI correction specifically (for "Correggo…"). */
  grading: boolean;
  error: string | null;
  /** "Avanti →" / "Vedi l'esito →"; `null` hides the button (read-only review has its own nav). */
  nextLabel: string | null;
  onGrade: (answer: string) => void;
  onUnknown: () => void;
  onNext: () => void;
  onOpenCitation: (citation: VerifyCitation) => void;
  /**
   * Phone: the fixed bar of the page. When given (even while still `null`), the buttons are drawn
   * in it instead of under the answer; the desktop leaves it out.
   */
  barSlot?: HTMLElement | null | undefined;
}) {
  const inBar = barSlot !== undefined;
  const [draft, setDraft] = useState('');
  const answered = item.state !== 'open';
  const outcomeRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previous = useRef(item.state);

  // The draft survives a reload (per item); a reopened question starts empty.
  useEffect(() => {
    setDraft(item.state === 'open' ? readDraft(sessionId, item.id) : '');
  }, [sessionId, item.id]);
  useEffect(() => {
    const before = previous.current;
    previous.current = item.state;
    if (before === 'open' && item.state !== 'open') {
      writeDraft(sessionId, item.id, '');
      outcomeRef.current?.focus({ preventScroll: false });
    } else if (before !== 'open' && item.state === 'open') {
      setDraft('');
    }
  }, [item.state, item.id, sessionId]);

  // A new question takes the focus on its (screen reader) title, never the textarea.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [item.id]);

  const trimmed = draft.trim();
  const canGrade = !ended && !answered && !busy && trimmed.length > 0;
  const readOnly = answered || ended || busy;
  const shown = answered || ended ? (item.studentAnswer ?? '') : draft;

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canGrade) {
      e.preventDefault();
      onGrade(trimmed);
    }
  }
  function onChange(value: string) {
    setDraft(value);
    writeDraft(sessionId, item.id, value);
  }

  const budget = isBudgetMessage(error);
  const unanswered = ended && !answered;

  return (
    <section
      aria-labelledby={`vq-${item.id}`}
      aria-busy={busy}
      className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-bg-surface p-6 max-md:border-0 max-md:bg-transparent max-md:p-0"
    >
      <span className="text-xs uppercase tracking-wider text-fg-secondary">
        {questionTypeLabel(item.kind)}
        {item.originLessonTitle && (
          <span className="normal-case tracking-normal text-fg-muted">
            {' '}
            · dalla lezione {item.originLessonTitle}
          </span>
        )}
      </span>
      <h2
        id={`vq-${item.id}`}
        ref={headingRef}
        data-verify-heading
        tabIndex={-1}
        className="sr-only outline-none"
      >
        Domanda {n} di {total}
      </h2>
      <div id={`vqt-${item.id}`} className="min-w-0 break-words text-lg font-semibold leading-snug">
        <Markdown source={item.question} />
      </div>

      {unanswered ? (
        <p className="text-sm text-fg-muted">Non hai risposto a questa domanda.</p>
      ) : item.state === 'unknown' && !item.studentAnswer ? (
        <p className="text-sm text-fg-muted">Non te lo ricordavi.</p>
      ) : (
        <div>
          <label htmlFor={`va-${item.id}`} className="sr-only">
            La tua risposta
          </label>
          <textarea
            id={`va-${item.id}`}
            rows={5}
            value={shown}
            readOnly={readOnly}
            aria-readonly={readOnly}
            aria-describedby={`vqt-${item.id}${!canGrade && !readOnly ? ` va-hint-${item.id}` : ''}`}
            placeholder="Rispondi a memoria, poi correggi."
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full resize-y break-words rounded-[var(--radius-control)] border border-border-strong bg-bg-inset px-3.5 py-3 text-[15px] text-fg-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          />
        </div>
      )}

      {grading && (
        <p role="status" className="text-xs text-fg-secondary">
          Correggo la tua risposta…
        </p>
      )}

      {answered && <VerifyOutcome item={item} focusRef={outcomeRef} />}
      {answered && item.keyPoint && (
        <KeyPointDisclosure
          itemId={item.id}
          keyPoint={item.keyPoint}
          onOpenCitation={onOpenCitation}
        />
      )}

      {inBar &&
        barSlot &&
        !ended &&
        createPortal(
          answered ? (
            nextLabel ? (
              <Button
                type="button"
                onClick={onNext}
                className="h-[52px] w-full text-base font-semibold"
              >
                {nextLabel}
              </Button>
            ) : null
          ) : (
            <>
              <Button
                type="button"
                disabled={!canGrade}
                aria-busy={grading}
                aria-describedby={!canGrade && !busy ? `va-hint-${item.id}` : undefined}
                onClick={() => onGrade(trimmed)}
                className="h-[52px] min-w-0 flex-1 text-base font-semibold"
              >
                {grading ? 'Correggo…' : 'Correggi'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={onUnknown}
                className="h-[52px] flex-none px-4"
              >
                Non me lo ricordo
              </Button>
            </>
          ),
          barSlot,
        )}

      {!ended && !answered && (
        <div className="flex flex-col gap-2">
          {!inBar && (
            <div className="flex flex-wrap gap-2.5 max-md:flex-col">
              <Button
                type="button"
                size="lg"
                disabled={!canGrade}
                aria-busy={grading}
                aria-describedby={!canGrade && !busy ? `va-hint-${item.id}` : undefined}
                onClick={() => onGrade(trimmed)}
              >
                {grading ? 'Correggo…' : 'Correggi'}
              </Button>
              <Button type="button" size="lg" variant="ghost" disabled={busy} onClick={onUnknown}>
                Non me lo ricordo
              </Button>
            </div>
          )}
          {!canGrade && !busy && (
            <p id={`va-hint-${item.id}`} className="text-xs text-fg-muted">
              Scrivi prima una risposta, oppure scegli «Non me lo ricordo».
            </p>
          )}
        </div>
      )}

      {answered && nextLabel && !inBar && (
        <div className="flex flex-wrap gap-2.5 max-md:flex-col">
          <Button type="button" size="lg" onClick={onNext}>
            {nextLabel}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-danger">
          {budget
            ? 'Hai raggiunto il budget AI di oggi. Puoi riprovare domani, oppure alza il limite nelle impostazioni.'
            : `Non sono riuscito a correggere: ${error}. La tua risposta è ancora qui, puoi riprovare.`}
        </p>
      )}
    </section>
  );
}
