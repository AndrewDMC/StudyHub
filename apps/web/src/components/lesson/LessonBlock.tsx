'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  CheckLessonBlockResponse,
  LessonBlockDto,
  SessionItemCitationDto,
} from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/SessionBriefing';
import {
  formulaSource,
  INTERRUPTIONS,
  toDisplayMath,
  toInlineMath,
  type LessonInterruption,
} from '@/lib/lessonClient';
import { cn } from '@/lib/utils';

const VERDICTS = {
  ok: { label: 'Ci sei.', icon: '✓', tone: 'text-ok' },
  partial: { label: 'Quasi.', icon: '~', tone: 'text-warn' },
  wrong: { label: 'Da rivedere.', icon: '!', tone: 'text-danger' },
} as const;

/** The explanation sits in a bigger type than the compact `Markdown` default. */
function Prose({ source }: { source: string }) {
  return (
    <div className="text-fg-primary leading-7 [&_.md-obsidian]:text-base [&_.md-obsidian]:leading-7">
      <Markdown source={source} />
    </div>
  );
}

/**
 * One block of the guided lesson: explanation, formula with a link to its page, a worked example
 * revealed step by step, the typical exam mistake, the interruptions that open the tutor and
 * "Prima di andare avanti" (a one-sentence check). Any verdict opens the next block.
 */
export function LessonBlock({
  block,
  total,
  readOnly,
  checkResult,
  checking,
  checkError,
  regenerating,
  isLast,
  focusNonce = 0,
  onOpenCitation,
  onInterrupt,
  onCheck,
  onNext,
  onRegenerate,
}: {
  block: LessonBlockDto;
  total: number | null;
  /** The session is over: nothing can be written. */
  readOnly: boolean;
  checkResult: CheckLessonBlockResponse | null;
  checking: boolean;
  checkError: string | null;
  regenerating: boolean;
  isLast: boolean;
  /** Changes when the student moves to another block: the title takes the focus. */
  focusNonce?: number;
  onOpenCitation: (citation: SessionItemCitationDto) => void;
  onInterrupt: (kind: LessonInterruption) => void;
  onCheck: (answer: string) => void;
  onNext: () => void;
  onRegenerate: () => void;
}) {
  const done = block.state === 'done';
  const stepCount = block.exampleSteps.length;
  const [shown, setShown] = useState(done ? stepCount : Math.min(1, stepCount));
  const [answer, setAnswer] = useState('');
  const titleRef = useRef<HTMLHeadingElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);

  // A rewritten block starts its example over.
  useEffect(() => {
    setShown(block.state === 'done' ? stepCount : Math.min(1, stepCount));
  }, [block.body, block.title]);

  useEffect(() => {
    if (focusNonce === 0) return;
    articleRef.current?.scrollIntoView({ block: 'start' });
    titleRef.current?.focus();
  }, [focusNonce]);

  const source = formulaSource(block);
  const verdict = checkResult ? VERDICTS[checkResult.verdict] : null;
  const answered = done || !!checkResult;
  const expected = checkResult?.block.checkAnswer ?? block.checkAnswer;
  const feedback = checkResult?.feedback ?? null;
  const busy = checking || regenerating;

  function revealStep() {
    const next = shown + 1;
    setShown(next);
    if (next >= stepCount) {
      // The button disappears: keep the focus on the step that just came in.
      window.setTimeout(() => stepRefs.current[next - 1]?.focus(), 0);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = answer.trim();
    if (!text || busy || readOnly || answered) return;
    onCheck(text);
  }

  return (
    <article
      ref={articleRef}
      aria-labelledby="blk-title"
      aria-busy={busy}
      className="space-y-4 rounded-[var(--radius-card)] border border-border bg-bg-surface p-4 md:p-7"
    >
      {regenerating && (
        <p
          role="status"
          className="rounded-[var(--radius-control)] bg-bg-raised px-3 py-2 text-sm text-fg-secondary"
        >
          Sto riscrivendo questo blocco…
        </p>
      )}

      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-accent">
          Blocco {block.orderIndex + 1} di {total ?? '…'}
        </p>
        <h2
          id="blk-title"
          ref={titleRef}
          tabIndex={-1}
          className="text-xl font-semibold text-fg-primary outline-none md:text-2xl"
        >
          {block.title}
        </h2>
      </header>

      <Prose source={block.body} />

      {block.formula !== null && (
        <figure className="rounded-[var(--radius-control)] border border-border bg-bg-inset p-4">
          <div className="overflow-x-auto text-center">
            <Markdown source={toDisplayMath(block.formula)} />
          </div>
          {source && (
            <figcaption className="mt-2 text-right">
              <button
                type="button"
                onClick={() => onOpenCitation(source)}
                className="min-h-11 text-xs text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent md:min-h-9"
              >
                {source.documentName} · p. {source.page} →
              </button>
            </figcaption>
          )}
        </figure>
      )}

      {stepCount > 0 && (
        <section aria-labelledby="blk-ex" className="space-y-2">
          <h3 id="blk-ex" className="text-sm font-semibold text-fg-primary">
            Esempio svolto
          </h3>
          <ol
            aria-live="polite"
            aria-relevant="additions"
            className="list-decimal space-y-2 pl-5 text-sm text-fg-primary marker:text-fg-secondary"
          >
            {block.exampleSteps.slice(0, shown).map((step, i) => (
              <li
                key={i}
                ref={(el) => {
                  stepRefs.current[i] = el;
                }}
                tabIndex={-1}
                className="outline-none"
              >
                <Markdown source={step.text} />
                {step.formula && (
                  <div className="overflow-x-auto text-fg-secondary">
                    <Markdown source={toInlineMath(step.formula)} />
                  </div>
                )}
              </li>
            ))}
          </ol>
          {shown < stepCount && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" disabled={busy} onClick={revealStep}>
                Passaggio successivo
              </Button>
              <span className="text-xs text-fg-secondary">
                Prova a indovinarlo prima di aprirlo.
              </span>
            </div>
          )}
        </section>
      )}

      {block.trap !== null && (
        <p className="flex gap-2 rounded-[var(--radius-control)] border border-warn/30 bg-warn/5 p-3 text-sm text-fg-primary">
          <span aria-hidden="true" className="text-warn">
            ⚠
          </span>
          <span>
            <strong className="font-semibold text-warn">Errore tipico all&apos;esame · </strong>
            {block.trap}
          </span>
        </p>
      )}

      {!readOnly && (
        <div role="group" aria-label="Interrompi il tutor" className="flex flex-wrap gap-2">
          {INTERRUPTIONS.map((it) => (
            <button
              key={it.kind}
              type="button"
              onClick={() => onInterrupt(it.kind)}
              className="min-h-11 rounded-full border border-border-strong px-3 text-[13px] text-fg-secondary outline-none hover:text-fg-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent md:min-h-9"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}

      {block.checkQuestion !== null && (
        <section
          aria-labelledby="blk-check"
          className="space-y-3 rounded-[var(--radius-control)] border border-accent/30 bg-bg-inset p-4"
        >
          <h3 id="blk-check" className="text-sm font-semibold text-accent">
            Prima di andare avanti
          </h3>
          <form onSubmit={submit} className="space-y-3">
            <label htmlFor={`chk-${block.id}`} className="block text-sm text-fg-primary">
              {block.checkQuestion}
            </label>
            <input
              id={`chk-${block.id}`}
              type="text"
              maxLength={4000}
              placeholder="Una frase, con parole tue"
              value={answered ? (block.studentAnswer ?? answer) : answer}
              readOnly={answered}
              disabled={readOnly && !answered}
              onChange={(e) => setAnswer(e.target.value)}
              className="h-11 w-full rounded-[var(--radius-control)] border border-border bg-bg-surface px-3 text-sm text-fg-primary outline-none focus:border-accent"
            />
            {!answered && !readOnly && (
              <Button
                type="submit"
                size="lg"
                aria-busy={checking}
                disabled={!answer.trim() || busy}
                className="max-md:w-full"
              >
                {checking ? 'Controllo…' : 'Controlla'}
              </Button>
            )}
          </form>
          {checkError && (
            <p role="alert" className="text-xs text-danger">
              {checkError}
            </p>
          )}

          {verdict && (
            <div role="status" className="text-sm text-fg-primary">
              <span aria-hidden="true" className={cn('mr-1', verdict.tone)}>
                {verdict.icon}
              </span>
              <strong className={cn('font-semibold', verdict.tone)}>{verdict.label} </strong>
              {feedback}
            </div>
          )}
          {answered && expected && (
            <details open={!checkResult || checkResult.verdict !== 'ok'} className="text-sm">
              <summary className="cursor-pointer text-fg-secondary">Risposta attesa</summary>
              <p className="mt-1 text-fg-secondary">{expected}</p>
            </details>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {answered && !isLast && (
          <Button type="button" size="lg" onClick={onNext} className="max-md:w-full">
            Blocco successivo →
          </Button>
        )}
        {!readOnly && !answered && (
          <Button type="button" variant="ghost" disabled={busy} onClick={onRegenerate}>
            Rispiegamelo in un altro modo
          </Button>
        )}
      </div>
    </article>
  );
}
