'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CheckLessonBlockResponse,
  SessionDocumentDto,
  SessionFocus,
  SessionItemCitationDto,
} from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import { formatClock, usePomodoro } from '@/components/PomodoroTimer';
import { SessionChat } from '@/components/SessionChat';
import { SessionClosing } from '@/components/SessionClosing';
import { LessonBlock } from '@/components/lesson/LessonBlock';
import { LessonOutline } from '@/components/lesson/LessonOutline';
import { LessonError, LessonSkeleton } from '@/components/lesson/LessonStatus';
import { SidePanel, type SidePanelTab } from '@/components/lesson/SidePanel';
import {
  initialBlockIndex,
  interruptionText,
  useLesson,
  type LessonInterruption,
} from '@/lib/lessonClient';
import { fetchSession, patchSession, postEnd } from '@/lib/sessionApi';

type CitationLike = Pick<SessionItemCitationDto, 'docId' | 'page'>;

/**
 * Phase "Studia" of a guided lesson (docs/10-planner-lezioni.md §3.2): the lesson block by block with
 * its index on the left and Material | Tutor on the right. Mounted by `SessionClient` for sessions
 * with `kind === 'lesson'` and `phase === 'understand'`; every other session keeps today's layout.
 */
export function LessonStudy({
  slug,
  sessionId,
  renderDocument,
  phaseBar,
}: {
  slug: string;
  sessionId: string;
  /** The document viewer of the session page (injected: it lives in SessionClient). */
  renderDocument: (props: {
    doc: SessionDocumentDto;
    canAsk: boolean;
    onAsk: (focus: SessionFocus) => void;
    target: { page: number; nonce: number } | null;
  }) => ReactNode;
  /** Slot for the bar of the five phases (later slice). */
  phaseBar?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const sessionKey = ['studySession', slug, sessionId];
  const sessionQuery = useQuery({
    queryKey: sessionKey,
    queryFn: () => fetchSession(slug, sessionId),
  });
  const session = sessionQuery.data;
  const active = session?.status === 'active';
  const lesson = useLesson({ slug, sessionId, active: !!active });
  const blocks = lesson.data?.blocks ?? [];
  const blockCount = lesson.data?.blockCount ?? null;

  const [selected, setSelected] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, CheckLessonBlockResponse>>({});
  const [focusNonce, setFocusNonce] = useState(0);
  const [tab, setTab] = useState<SidePanelTab>('material');
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const [focus, setFocus] = useState<SessionFocus | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [target, setTarget] = useState<{ docId: string; page: number; nonce: number } | null>(null);
  const persistTimer = useRef<number | undefined>(undefined);

  const current =
    selected ??
    (lesson.data && blocks.length > 0 ? initialBlockIndex(blocks, session?.blockIndex ?? 0) : 0);
  const block = blocks.find((b) => b.orderIndex === current) ?? null;

  const heartbeat = useCallback(
    (activeMs: number, pomodoros: number) => {
      patchSession(slug, sessionId, { activeMs, pomodoros }).catch(() => {
        /* a missed beat is recovered by the next one or by "Termina" */
      });
    },
    [slug, sessionId],
  );
  const timer = usePomodoro({
    savedActiveMs: session?.activeMs,
    savedPomodoros: session?.pomodoros,
    enabled: active,
    onBeat: heartbeat,
  });
  const endMutation = useMutation({
    mutationFn: () =>
      postEnd(slug, sessionId, {
        activeMs: timer.studyMsRef.current,
        pomodoros: timer.completedRef.current,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(sessionKey, next);
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['plans', slug] });
    },
  });

  useEffect(() => () => window.clearTimeout(persistTimer.current), []);

  function selectBlock(index: number, moveFocus: boolean) {
    setSelected(index);
    if (moveFocus) setFocusNonce((n) => n + 1);
    // Reviewing a finished block moves the saved position too; not worth waiting for.
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      patchSession(slug, sessionId, { blockIndex: index }).catch(() => {
        /* the server already moves it on every check */
      });
    }, 600);
  }

  const docs = session?.documents ?? [];
  const doc =
    docs.find((d) => d.id === docId) ?? docs.find((d) => d.highlighted) ?? docs[0] ?? null;
  const documentNames = new Map(docs.map((d) => [d.id, d.name]));

  function openCitation(citation: CitationLike) {
    setDocId(citation.docId);
    setTarget({ docId: citation.docId, page: citation.page, nonce: Date.now() });
    setTab('material');
  }
  function onAsk(next: SessionFocus) {
    setFocus(next);
    setTab('tutor');
  }
  function interrupt(kind: LessonInterruption) {
    if (!block) return;
    setPrefill({ text: interruptionText(kind, block), nonce: Date.now() });
    setTab('tutor');
  }
  function check(answer: string) {
    if (!block) return;
    const index = block.orderIndex;
    lesson.check.mutate(
      { index, answer },
      { onSuccess: (res) => setResults((r) => ({ ...r, [index]: res })) },
    );
  }
  function retry(index: number) {
    if (index === 0 && blocks.length === 0) lesson.start.mutate({});
    else lesson.regenerate.mutate({ index });
  }

  const job = lesson.job;
  const failedHere = job?.status === 'failed' && job.blockIndex === current ? job : null;
  const regenerating =
    !!block &&
    block.state !== 'locked' &&
    ((lesson.inFlight && job?.blockIndex === block.orderIndex) ||
      (lesson.regenerate.isPending && lesson.regenerate.variables?.index === block.orderIndex));
  const pendingIndex = lesson.inFlight ? (job?.blockIndex ?? null) : null;
  const allDone =
    blockCount !== null && blocks.length >= blockCount && blocks.every((b) => b.state === 'done');
  const shownMs = active ? timer.studyMs : (session?.activeMs ?? 0);

  let main: ReactNode;
  if (lesson.query.isLoading || !lesson.data) {
    main = lesson.query.isError ? (
      <p role="alert" className="text-sm text-danger">
        {(lesson.query.error as Error).message}
      </p>
    ) : (
      <p role="status" className="text-sm text-fg-secondary">
        Caricamento…
      </p>
    );
  } else if (blocks.length === 0) {
    const startFailed = lesson.start.isError ? (lesson.start.error as Error).message : null;
    if (job?.status === 'failed' || startFailed) {
      main = (
        <LessonError
          what="la lezione"
          error={startFailed ?? job?.error ?? null}
          retrying={lesson.start.isPending}
          onRetry={() => lesson.start.mutate({})}
        />
      );
    } else if (!active && !lesson.inFlight) {
      main = (
        <p className="rounded-[var(--radius-card)] border border-dashed border-border p-6 text-sm text-fg-secondary">
          Questa lezione non è stata generata.
        </p>
      );
    } else {
      main = <LessonSkeleton label="Sto preparando la lezione dal materiale…" />;
    }
  } else if (!block || block.state === 'locked') {
    main =
      failedHere || (job?.status === 'failed' && lesson.regenerate.isError) ? (
        <LessonError
          what={`il blocco ${current + 1}`}
          error={failedHere?.error ?? null}
          retrying={lesson.regenerate.isPending}
          onRetry={() => retry(current)}
        />
      ) : (
        <LessonSkeleton label="Preparo il blocco successivo…" />
      );
  } else {
    main = (
      <>
        {failedHere && (
          <LessonError
            what={`il blocco ${current + 1}`}
            error={failedHere.error}
            retrying={lesson.regenerate.isPending}
            onRetry={() => retry(current)}
          />
        )}
        <LessonBlock
          key={block.id}
          block={block}
          total={blockCount}
          readOnly={!active}
          checkResult={results[block.orderIndex] ?? null}
          checking={lesson.check.isPending && lesson.check.variables?.index === block.orderIndex}
          checkError={
            lesson.check.isError && lesson.check.variables?.index === block.orderIndex
              ? (lesson.check.error as Error).message
              : null
          }
          regenerating={regenerating}
          isLast={blockCount !== null && block.orderIndex >= blockCount - 1}
          focusNonce={focusNonce}
          onOpenCitation={openCitation}
          onInterrupt={interrupt}
          onCheck={check}
          onNext={() => selectBlock(block.orderIndex + 1, true)}
          onRegenerate={() => lesson.regenerate.mutate({ index: block.orderIndex })}
        />
        {lesson.regenerate.isError && (
          <p role="alert" className="text-xs text-danger">
            {(lesson.regenerate.error as Error).message}
          </p>
        )}
      </>
    );
  }

  const material = doc ? (
    <div className="space-y-2">
      {renderDocument({
        doc,
        canAsk: !!active,
        onAsk,
        target: target?.docId === doc.id ? target : null,
      })}
      {target && (
        <div className="space-y-1 text-xs text-fg-secondary">
          <p>
            Il passaggio evidenziato è quello da cui viene la spiegazione. Seleziona una riga per
            chiedere al tutor.
          </p>
          <button
            type="button"
            onClick={() => setTarget(null)}
            className="min-h-11 text-accent underline-offset-2 hover:underline md:min-h-9"
          >
            Apri il documento intero
          </button>
        </div>
      )}
    </div>
  ) : (
    <p className="rounded-[var(--radius-card)] border border-dashed border-border p-4 text-sm text-fg-secondary">
      Nessun documento collegato a questa lezione.
    </p>
  );

  if (!session) {
    return sessionQuery.isError ? (
      <p role="alert" className="p-4 text-sm text-danger">
        {(sessionQuery.error as Error).message}
      </p>
    ) : (
      <p role="status" className="p-4 text-sm text-fg-secondary">
        Caricamento…
      </p>
    );
  }

  return (
    <div className="mx-auto flex max-w-[100rem] flex-col gap-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-6">
      <Link
        href={`/materie/${slug}`}
        className="text-xs text-fg-muted underline-offset-2 hover:text-fg-primary hover:underline"
      >
        ← Torna alla materia
      </Link>

      <header className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-border bg-bg-surface p-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-fg-muted">
            <span>
              Lezione
              {session.taskMinutes ? ` · ${session.taskMinutes} min previsti` : ''}
            </span>
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] normal-case tracking-normal text-accent">
              {session.method === 'sprint' ? 'Sprint' : 'Standard'}
            </span>
          </p>
          <h1 className="line-clamp-2 text-lg font-semibold text-fg-primary md:truncate">
            {session.taskTitle ?? (session.topics.map((t) => t.name).join(', ') || 'Lezione')}
          </h1>
        </div>
        <span aria-label="Tempo di studio totale" className="text-right text-xs text-fg-muted">
          Studio
          {blockCount ? ` · blocco ${Math.min(current + 1, blockCount)} di ${blockCount}` : ''}
          <span className="block font-mono text-xl tabular-nums text-fg-primary">
            {formatClock(shownMs)}
          </span>
        </span>
        {active ? (
          <Button
            type="button"
            disabled={endMutation.isPending}
            onClick={() => endMutation.mutate()}
          >
            Termina
          </Button>
        ) : (
          <span className="rounded-full bg-ok/15 px-3 py-1 text-xs text-ok">
            Terminata · {session.pomodoros} {session.pomodoros === 1 ? 'pomodoro' : 'pomodori'}
            {session.taskId ? ' · task completata' : ''}
          </span>
        )}
      </header>
      {!active && (
        <SessionClosing
          slug={slug}
          sessionId={sessionId}
          session={session}
          sessionKey={sessionKey}
        />
      )}
      {endMutation.isError && (
        <p role="alert" className="text-sm text-danger">
          {(endMutation.error as Error).message}
        </p>
      )}
      {phaseBar}

      <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)_24rem]">
        <LessonOutline
          blocks={blocks}
          blockCount={blockCount}
          currentIndex={current}
          pendingIndex={pendingIndex}
          onSelect={(i) => selectBlock(i, true)}
        />

        <section aria-label="Lezione" className="min-w-0 space-y-3">
          {main}
          {allDone && (
            <section
              aria-labelledby="lesson-finished"
              className="space-y-2 rounded-[var(--radius-card)] border border-ok/40 bg-ok/5 p-4"
            >
              <h2 id="lesson-finished" className="text-base font-semibold text-fg-primary">
                Hai finito la parte Studia
              </h2>
              <ul className="space-y-1 text-sm text-fg-secondary">
                {blocks.map((b) => (
                  <li key={b.id}>
                    <span aria-hidden="true" className="mr-1 text-ok">
                      ✓
                    </span>
                    {b.title}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(lesson.data?.costEur ?? 0) > 0 && (
            <p className="text-xs text-fg-muted">Costo AI: €{lesson.data!.costEur.toFixed(4)}</p>
          )}
        </section>

        <SidePanel
          tab={tab}
          onTabChange={setTab}
          className="h-[75dvh] lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]"
          material={material}
          tutor={
            <SessionChat
              slug={slug}
              sessionId={sessionId}
              active={!!active}
              documentNames={documentNames}
              focus={focus}
              onClearFocus={() => setFocus(null)}
              onOpenCitation={openCitation}
              prefill={prefill}
            />
          }
        />
      </div>
    </div>
  );
}
