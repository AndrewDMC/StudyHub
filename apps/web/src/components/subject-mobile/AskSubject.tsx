'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import type { SessionCitationDto } from '@studyhub/contracts';
import { AskError, streamAsk, type AskScope } from '@/lib/askStream';
import { AnswerMarkdown } from '../SessionChat';
import { fieldClass } from '../simulation-mobile/styles';

type Phase = 'idle' | 'sending' | 'streaming' | 'done' | 'error';

/**
 * "Chiedi" in the Assistente sheet: one question, one streamed answer with citations, no history.
 * The answer lives only in this component's state (reset when the sheet closes).
 */
export function AskSubject({
  open,
  slug,
  scope,
  scopeEmpty,
  onOpenSource,
}: {
  open: boolean;
  slug: string;
  /** Already resolved: `{docIds}` | `{topicIds}` | `{}` (whole subject). */
  scope: AskScope;
  scopeEmpty: boolean;
  /** Called when the user opens a cited document: the sheet closes. */
  onOpenSource: () => void;
}) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [asked, setAsked] = useState('');
  const [streamed, setStreamed] = useState('');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<SessionCitationDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const busy = phase === 'sending' || phase === 'streaming';

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setInput('');
    setPhase('idle');
    setAsked('');
    setStreamed('');
    setAnswer('');
    setCitations([]);
    setError(null);
    setRetryable(false);
  }, []);

  // No history: closing the sheet drops the answer (and stops a stream still running).
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const resize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  };

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!question || busy || scopeEmpty) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setAsked(question);
    setStreamed('');
    setAnswer('');
    setCitations([]);
    setError(null);
    setRetryable(false);
    setPhase('sending');
    let failed = false;
    let completed = false;
    try {
      await streamAsk(
        slug,
        question,
        scopeRef.current,
        (event) => {
          if (event.type === 'delta') {
            setPhase('streaming');
            setStreamed((s) => s + event.text);
          } else if (event.type === 'done') {
            setAnswer(event.answer);
            setCitations(event.citations);
            completed = true;
            setPhase('done');
          } else {
            failed = true;
            setError(event.message);
            setRetryable(true);
            setPhase('error');
          }
        },
        controller.signal,
      );
      if (!failed && !completed) {
        setInput(question);
        setError('La risposta si è interrotta. Riprova.');
        setRetryable(true);
        setPhase('error');
      } else if (!failed) {
        setInput('');
        if (inputRef.current) inputRef.current.style.height = 'auto';
      } else {
        setInput(question);
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setInput(question);
      setError(e instanceof Error ? e.message : 'Invio della domanda non riuscito');
      // Budget / validation errors do not get better by retrying right away.
      setRetryable(!(e instanceof AskError && (e.status === 429 || e.status === 400)));
      setPhase('error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      // The disabled field lost the focus: give it back unless the user moved elsewhere.
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) inputRef.current?.focus();
      });
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const hasBlock = phase !== 'idle';
  useEffect(() => {
    if (hasBlock) answerRef.current?.scrollIntoView({ block: 'nearest' });
  }, [hasBlock]);

  const openDocument = (c: SessionCitationDto) => {
    router.push(`/materie/${slug}/documenti/${c.docId}`);
    onOpenSource();
  };

  return (
    <section aria-labelledby="ask-label" data-testid="ask-subject" className="mt-5">
      <label
        id="ask-label"
        htmlFor="ask-input"
        className="mb-2 block text-xs font-medium uppercase tracking-[0.06em] text-fg-muted"
      >
        Chiedi
      </label>
      <form data-testid="ask-form" onSubmit={onSubmit} className="flex items-end gap-2">
        <textarea
          id="ask-input"
          ref={inputRef}
          data-testid="ask-input"
          rows={1}
          maxLength={2000}
          enterKeyHint="send"
          value={input}
          disabled={busy || scopeEmpty}
          aria-describedby={scopeEmpty ? 'ask-hint' : undefined}
          onChange={(e) => setInput(e.target.value)}
          onInput={(e) => resize(e.currentTarget)}
          onKeyDown={onKeyDown}
          onFocus={(e) => {
            const el = e.currentTarget;
            setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
          }}
          placeholder="Perché la derivata di |x| non esiste in 0?"
          className={`${fieldClass} max-h-32 min-w-0 flex-1 resize-none py-2.5 leading-normal disabled:opacity-60`}
        />
        <button
          type="submit"
          data-testid="ask-submit"
          aria-label={busy ? 'Invio in corso' : 'Invia la domanda'}
          disabled={busy || scopeEmpty || !input.trim()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border-strong bg-bg-raised text-fg-primary disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
          ) : (
            <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
          )}
        </button>
      </form>
      {scopeEmpty ? (
        <p id="ask-hint" className="mt-1 text-xs text-fg-muted">
          Nessun documento con testo estratto. Carica un PDF e attendi lo stato &quot;Pronto&quot;.
        </p>
      ) : (
        !hasBlock && (
          <p className="mt-1 text-xs text-fg-muted">
            Risponde solo dai documenti dello scope e cita le pagine.
          </p>
        )
      )}

      <div
        ref={answerRef}
        data-testid="ask-answer"
        role="region"
        aria-label="Risposta"
        aria-live="polite"
        aria-busy={busy}
        className={
          hasBlock
            ? 'mt-3 break-words rounded-[var(--radius-card)] border border-border bg-bg-inset px-3 py-2.5 [&_.katex-display]:overflow-x-auto'
            : undefined
        }
      >
        {hasBlock && (
          <>
            <p data-testid="ask-question" className="mb-1.5 line-clamp-2 text-xs text-fg-muted">
              {asked}
            </p>
            {phase === 'sending' && (
              <p className="text-sm text-fg-secondary">Sto cercando nel materiale…</p>
            )}
            {(phase === 'streaming' || (phase === 'error' && streamed)) && (
              <AnswerMarkdown content={streamed} citations={[]} onOpenCitation={openDocument} />
            )}
            {phase === 'done' && (
              <>
                <AnswerMarkdown
                  content={answer}
                  citations={citations}
                  onOpenCitation={openDocument}
                />
                {citations.length > 0 ? (
                  <ul data-testid="ask-citations" className="mt-2 flex flex-wrap gap-1.5">
                    {citations.map((c) => (
                      <li key={c.ref}>
                        <Link
                          href={`/materie/${slug}/documenti/${c.docId}`}
                          data-testid="ask-citation"
                          onClick={onOpenSource}
                          className="inline-flex min-h-11 items-center rounded-full border border-border px-3 text-[13px] text-fg-secondary"
                        >
                          [{c.ref}] {c.documentName} · p. {c.page}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-warn">
                    Nessuna fonte citata: la risposta non è ancorata al materiale, verificala.
                  </p>
                )}
              </>
            )}
            {phase === 'error' && (
              <div className="mt-2">
                <p role="alert" data-testid="ask-error" className="text-sm text-danger">
                  {error}
                </p>
                {retryable && (
                  <button
                    type="button"
                    data-testid="ask-retry"
                    onClick={() => void send(asked)}
                    className="mt-2 min-h-11 rounded-[var(--radius-control)] border border-border-strong px-4 text-sm text-fg-primary"
                  >
                    Riprova
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
