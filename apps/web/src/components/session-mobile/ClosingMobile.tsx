'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Check, ChevronDown, X } from 'lucide-react';
import type { StudySessionDto } from '@studyhub/contracts';
import { ObsidianMarkdown } from '@/components/ObsidianMarkdown';
import { Markdown } from '@/components/SessionBriefing';
import { fetchTranscript } from '@/components/SessionChat';
import { useSessionClosing } from '@/components/SessionClosing';
import { StartTaskButton } from '@/components/StartTaskButton';
import {
  drillItems as pickDrillItems,
  formatStudyTime,
  pickNextTask,
  sessionTitle,
} from '@/lib/sessionMobile';
import { iconButton } from '../document-mobile/DocHeader';
import { cardClass, primaryButton, secondaryButton } from '../simulation-mobile/styles';
import { useTodayTasks } from '../subject-mobile/queries';
import { SectionError, SkeletonRows } from '../subject-mobile/SectionState';

/** Saved chat transcript, closed by default; omitted when the session had no questions. */
function TranscriptDisclosure({ slug, sessionId }: { slug: string; sessionId: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const transcript = useQuery({
    queryKey: ['sessionTranscript', slug, sessionId],
    queryFn: () => fetchTranscript(slug, sessionId),
  });
  if (transcript.isError) {
    return (
      <div role="alert" className="flex flex-col gap-2 text-sm text-danger">
        Impossibile caricare la trascrizione
        <button
          type="button"
          onClick={() => void transcript.refetch()}
          className={`${secondaryButton} min-h-11`}
        >
          Riprova
        </button>
      </div>
    );
  }
  if (!transcript.data) return null;
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-bg-surface px-4 text-left text-sm font-medium text-fg-primary"
      >
        Trascrizione della chat
        <ChevronDown
          className={`size-4 shrink-0 text-fg-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      <div id={panelId} hidden={!open} className="mt-3 min-w-0">
        {open && (
          <>
            <p className="mb-2 text-xs text-fg-muted">
              Sessione terminata: questa è la trascrizione salvata, non più interattiva.
            </p>
            <div className="min-w-0 break-words text-sm leading-relaxed [&_.katex-display]:overflow-x-auto [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto">
              <ObsidianMarkdown source={transcript.data} subjectSlug={slug} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

const labelClass = 'text-xs font-semibold uppercase tracking-[0.06em] text-fg-secondary';

/** What follows "Termina" (also shown for an already ended session): study time, results, deck and drill. */
export function ClosingMobile({
  slug,
  sessionId,
  session,
  sessionKey,
}: {
  slug: string;
  sessionId: string;
  session: StudySessionDto;
  sessionKey: readonly unknown[];
}) {
  const c = useSessionClosing(slug, sessionId, session, sessionKey);
  const tasks = useTodayTasks(slug);
  const h1Ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    h1Ref.current?.focus();
  }, []);

  const { briefing, keyPoints, keyPointItems, wrongItems, right, deck, drill, deckId, drillId } = c;
  const wrong = wrongItems.length;
  const drillItems = pickDrillItems(c.items);
  const drillCount = drillItems.length;
  const next = pickNextTask(tasks.data ?? [], session.taskId);
  const loading = briefing.isLoading;

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-base">
      <div className="sticky top-0 z-10 shrink-0 border-b border-border bg-bg-surface pt-[env(safe-area-inset-top)]">
        <div className="flex h-[52px] items-center pl-1">
          <Link href={`/materie/${slug}`} aria-label="Chiudi" className={iconButton}>
            <X className="h-5 w-5" aria-hidden="true" />
          </Link>
          <h1
            ref={h1Ref}
            tabIndex={-1}
            className="flex-1 pl-1 text-[15px] font-semibold outline-none"
          >
            Sessione terminata
          </h1>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-y-contain p-4">
        <section aria-label="Riepilogo della sessione" className="flex flex-col gap-3">
          <p className="break-words text-xl font-semibold tracking-[-0.01em]">
            {sessionTitle(session)}
          </p>
          <p className="text-xs text-fg-secondary">
            Terminata · {session.pomodoros} {session.pomodoros === 1 ? 'pomodoro' : 'pomodori'}
            {session.taskId ? ' · task completata' : ''}
          </p>
          <dl className="grid grid-cols-3 gap-2">
            <div className="flex flex-col-reverse gap-0.5 rounded-[10px] bg-bg-raised p-3">
              <dt className="text-xs text-fg-secondary">studio</dt>
              <dd className="font-mono text-xl font-semibold">
                {formatStudyTime(session.activeMs)}
              </dd>
            </div>
            <div className="flex flex-col-reverse gap-0.5 rounded-[10px] bg-bg-raised p-3">
              <dt className="text-xs text-fg-secondary">giusti</dt>
              <dd className="font-mono text-xl font-semibold text-ok">{loading ? '—' : right}</dd>
            </div>
            <div className="flex flex-col-reverse gap-0.5 rounded-[10px] bg-bg-raised p-3">
              <dt className="text-xs text-fg-secondary">da rivedere</dt>
              <dd className="font-mono text-xl font-semibold text-warn">{loading ? '—' : wrong}</dd>
            </div>
          </dl>
          {session.taskMinutes ? (
            <p className="text-xs text-fg-secondary">su {session.taskMinutes} min previsti</p>
          ) : null}
        </section>

        {briefing.isError ? (
          <SectionError
            message={(briefing.error as Error).message}
            onRetry={() => void briefing.refetch()}
          />
        ) : (
          <>
            <section
              aria-labelledby="closing-deck"
              aria-busy={loading || undefined}
              className={`${cardClass} flex flex-col gap-2 p-4`}
            >
              <h2 id="closing-deck" className={labelClass}>
                Flashcard dai punti chiave
              </h2>
              {loading ? (
                <SkeletonRows count={2} />
              ) : deckId ? (
                <>
                  <p className="text-sm text-ok">
                    Mazzo creato{deck.data ? ` · ${deck.data.cardCount} carte` : ''}.
                  </p>
                  <Link
                    href={`/materie/${slug}/artifacts/${deckId}`}
                    className={`${secondaryButton} min-h-11`}
                  >
                    Apri il mazzo →
                  </Link>
                  <p className="text-xs text-fg-secondary">
                    Il mazzo resta in bozza finché non lo approvi.
                  </p>
                </>
              ) : keyPoints === 0 ? (
                <p className="text-sm text-fg-secondary">
                  Non hai generato punti chiave in questa sessione.
                </p>
              ) : (
                <>
                  <ul>
                    {keyPointItems.map((item) => (
                      <li
                        key={item.id}
                        className="flex gap-2 border-t border-border py-2 text-[15px] first:border-t-0"
                      >
                        <Check
                          className="mt-1 h-4 w-4 shrink-0 text-fg-secondary"
                          aria-hidden="true"
                        />
                        <span className="line-clamp-3 min-w-0 break-words">{item.title}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-fg-secondary">
                    {keyPoints} {keyPoints === 1 ? 'carta' : 'carte'}, ciascuna con la sua fonte.
                    Gratis. Il mazzo resta in bozza finché non lo approvi.
                  </p>
                  <button
                    type="button"
                    disabled={deck.isPending}
                    onClick={() => deck.mutate()}
                    className={`${primaryButton} mt-1 min-h-12`}
                  >
                    {deck.isPending ? 'Creo il mazzo…' : `Crea ${keyPoints} flashcard`}
                  </button>
                </>
              )}
              {deck.isError && (
                <p role="alert" className="text-xs text-danger">
                  {(deck.error as Error).message}
                </p>
              )}
            </section>

            <section
              aria-labelledby="closing-drill"
              aria-busy={loading || undefined}
              className={`${cardClass} flex flex-col gap-2 p-4`}
            >
              <h2 id="closing-drill" className={labelClass}>
                Esercizi sbagliati nei drill
              </h2>
              {loading ? (
                <SkeletonRows count={2} />
              ) : drillId ? (
                <>
                  <p className="text-sm text-ok">
                    Drill creato{drill.data ? ` · ${drill.data.itemCount} esercizi` : ''}.
                  </p>
                  <Link
                    href={`/materie/${slug}/simulations/${drillId}`}
                    className={`${secondaryButton} min-h-11`}
                  >
                    Apri il drill →
                  </Link>
                </>
              ) : wrong === 0 ? (
                <p className="text-sm text-fg-secondary">
                  Nessun esercizio segnato come sbagliato.
                </p>
              ) : drillCount === 0 ? (
                <p className="text-sm text-fg-secondary">
                  Gli esercizi sbagliati non hanno una fonte: niente drill.
                </p>
              ) : (
                <>
                  <ul>
                    {drillItems.slice(0, 3).map((item) => (
                      <li
                        key={item.id}
                        className="flex items-start gap-2 border-t border-border py-2 text-[15px] first:border-t-0"
                      >
                        <div className="line-clamp-2 min-w-0 flex-1 break-words">
                          <Markdown source={item.title} />
                        </div>
                        <span className="shrink-0 text-xs text-warn">da rivedere</span>
                      </li>
                    ))}
                  </ul>
                  {drillCount > 3 && (
                    <p className="text-xs text-fg-secondary">e altri {drillCount - 3}</p>
                  )}
                  <p className="text-[13px] text-fg-secondary">
                    {drillCount} {drillCount === 1 ? 'esercizio' : 'esercizi'} da rifare in un
                    drill. Gratis da creare; la correzione del tentativo è quella degli esami.
                  </p>
                  <button
                    type="button"
                    disabled={drill.isPending}
                    onClick={() => drill.mutate()}
                    className={`${primaryButton} mt-1 min-h-12`}
                  >
                    {drill.isPending ? 'Creo il drill…' : 'Crea il drill'}
                  </button>
                </>
              )}
              {drill.isError && (
                <p role="alert" className="text-xs text-danger">
                  {(drill.error as Error).message}
                </p>
              )}
            </section>
          </>
        )}
        <TranscriptDisclosure slug={slug} sessionId={sessionId} />
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-border bg-bg-surface px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3">
        {next && (
          <p className="col-span-2 truncate text-xs text-fg-secondary">
            Prossima: {next.title} · {next.minutes} min
          </p>
        )}
        <Link
          href={`/materie/${slug}`}
          className={`${secondaryButton} min-h-12 ${next ? '' : 'col-span-2'}`}
        >
          Alla materia
        </Link>
        {next && (
          <div className="[&>span]:flex [&>span]:w-full">
            <StartTaskButton
              subjectSlug={slug}
              taskId={next.id}
              kind={next.kind}
              label="Prossima task"
              className={`${primaryButton} min-h-12`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
