'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionDocumentDto, SessionFocus, SessionItemCitationDto } from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import { formatClock, usePomodoro } from '@/components/PomodoroTimer';
import { SessionChat } from '@/components/SessionChat';
import { fetchBriefing } from '@/components/SessionBriefing';
import { ApplyStep } from '@/components/lesson/ApplyStep';
import { ExplainStep } from '@/components/lesson/ExplainStep';
import { ExploreStep } from '@/components/lesson/ExploreStep';
import { LessonStudy } from '@/components/lesson/LessonStudy';
import { PhaseNav } from '@/components/lesson/PhaseNav';
import { PhaseStepper } from '@/components/lesson/PhaseStepper';
import { RecallStep } from '@/components/lesson/RecallStep';
import { SessionClosing } from '@/components/SessionClosing';
import { SidePanel, type SidePanelTab } from '@/components/lesson/SidePanel';
import {
  LESSON_PHASES,
  initialBlockIndex,
  initialViewPhase,
  phaseIndex,
  readFurthest,
  useExplanation,
  useLesson,
  useLessonPhase,
  writeFurthest,
  type PhaseProgress,
  type StandardPhase,
} from '@/lib/lessonClient';
import { fetchSession, patchSession, postEnd } from '@/lib/sessionApi';

type CitationLike = Pick<SessionItemCitationDto, 'docId' | 'page'>;

/** Below `lg` the side panel sits under the step: bring it into view when something opens it. */
function revealSidePanel() {
  if (!window.matchMedia?.('(max-width: 1023.98px)').matches) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document
    .getElementById('lesson-side-panel')
    ?.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
}

/**
 * A standard lesson with its five phases (docs/10-planner-lezioni.md §3.2, §4): header, stepper, the
 * current phase and Material | Tutor on the right. Mounted by `SessionClient` for sessions with
 * `kind === 'lesson'` and a standard `phase`. The phase shown is saved on the server, so opening the
 * session again resumes from it.
 */
export function LessonFlow({
  slug,
  sessionId,
  renderDocument,
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
  const explanation = useExplanation({ slug, sessionId, active: !!active });
  const briefing = useQuery({
    queryKey: ['sessionBriefing', slug, sessionId],
    queryFn: () => fetchBriefing(slug, sessionId),
  });
  const savePhase = useLessonPhase({ slug, sessionId });
  const blocks = lesson.data?.blocks ?? [];
  const blockCount = lesson.data?.blockCount ?? null;

  const [viewPhase, setViewPhase] = useState<StandardPhase | null>(null);
  const [furthestState, setFurthestState] = useState<number | null>(null);
  const [phaseNonce, setPhaseNonce] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [tab, setTab] = useState<SidePanelTab>('material');
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const [focus, setFocus] = useState<SessionFocus | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [target, setTarget] = useState<{ docId: string; page: number; nonce: number } | null>(null);
  const persistTimer = useRef<number | undefined>(undefined);
  const mainRef = useRef<HTMLDivElement>(null);

  // A sprint lesson only has "Studia" for now: no stepper, no way on to the other phases.
  const staged = session?.method !== 'sprint';
  const phase: StandardPhase = !staged
    ? 'understand'
    : (viewPhase ?? (session ? initialViewPhase(session) : 'explore'));
  const furthest = session ? (furthestState ?? readFurthest(sessionId, session.phase)) : 0;

  const current =
    selected ??
    (lesson.data && blocks.length > 0 ? initialBlockIndex(blocks, session?.blockIndex ?? 0) : 0);

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

  // After a change of phase the new title takes the focus (never when the page opens).
  useEffect(() => {
    if (phaseNonce === 0) return;
    const main = mainRef.current;
    if (!main) return;
    const heading = main.querySelector<HTMLElement>('[data-phase-heading]');
    (heading ?? main).focus({ preventScroll: true });
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    main.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [phaseNonce]);

  function goTo(next: StandardPhase) {
    if (!staged) return;
    const index = phaseIndex(next);
    setViewPhase(next);
    if (index > furthest) {
      setFurthestState(index);
      writeFurthest(sessionId, index);
    } else {
      setFurthestState(furthest);
    }
    setAnnounce(`Fase ${index + 1} di ${LESSON_PHASES.length}: ${LESSON_PHASES[index]!.label}`);
    setPhaseNonce((n) => n + 1);
    if (active) savePhase.mutate(next);
  }

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
    revealSidePanel();
  }
  function openDocument(id: string, page?: number) {
    setDocId(id);
    setTarget(page ? { docId: id, page, nonce: Date.now() } : null);
    setTab('material');
    revealSidePanel();
  }
  function onAsk(next: SessionFocus) {
    setFocus(next);
    setTab('tutor');
    revealSidePanel();
  }
  function prefillTutor(text: string) {
    setPrefill({ text, nonce: Date.now() });
    setTab('tutor');
    revealSidePanel();
  }

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

  const shownMs = active ? timer.studyMs : session.activeMs;
  const items = briefing.data?.items ?? [];
  const progress: PhaseProgress = {
    furthest,
    blocks,
    blockCount,
    explanationGraded: !!explanation.latest?.feedback,
    exercisesAnswered: items.filter((i) => i.kind === 'exercise' && i.state !== 'open').length,
    ended: !active,
  };
  const phaseLabel = LESSON_PHASES[phaseIndex(phase)]!.label;

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

  let step: ReactNode;
  switch (phase) {
    case 'explore':
      step = (
        <ExploreStep
          slug={slug}
          sessionId={sessionId}
          docs={docs}
          lesson={lesson}
          active={!!active}
          onOpenDocument={openDocument}
          onAskQuestion={prefillTutor}
        />
      );
      break;
    case 'understand':
      step = (
        <LessonStudy
          lesson={lesson}
          active={!!active}
          current={current}
          focusNonce={focusNonce}
          onSelect={selectBlock}
          onOpenCitation={openCitation}
          onPrefill={prefillTutor}
          onGo={goTo}
          staged={staged}
        />
      );
      break;
    case 'rework':
      step = (
        <ExplainStep
          slug={slug}
          sessionId={sessionId}
          active={!!active}
          draft={draft}
          onDraftChange={setDraft}
          onOpenCitation={openCitation}
        />
      );
      break;
    case 'apply':
      step = (
        <ApplyStep
          slug={slug}
          sessionId={sessionId}
          active={!!active}
          hasDocuments={docs.length > 0}
          onOpenCitation={openCitation}
          onAsk={onAsk}
        />
      );
      break;
    case 'recall':
      step = (
        <RecallStep
          slug={slug}
          sessionId={sessionId}
          session={session}
          sessionKey={sessionKey}
          active={!!active}
          activeMs={shownMs}
          ending={endMutation.isPending}
          endError={endMutation.isError ? (endMutation.error as Error).message : null}
          onEnd={() => endMutation.mutate()}
          onGoApply={() => goTo('apply')}
        />
      );
      break;
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
          {phase === 'understand'
            ? blockCount
              ? ` · blocco ${Math.min(current + 1, blockCount)} di ${blockCount}`
              : ''
            : ` · ${phaseLabel}`}
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
      {!active && !staged && (
        <SessionClosing
          slug={slug}
          sessionId={sessionId}
          session={session}
          sessionKey={sessionKey}
        />
      )}
      {!active && staged && phase !== 'recall' && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-ok/40 bg-ok/5 p-3 text-sm text-fg-primary"
        >
          <span className="min-w-0 flex-1">
            La lezione è terminata. Flashcard e drill sono in Ricorda.
          </span>
          <Button type="button" size="sm" variant="secondary" onClick={() => goTo('recall')}>
            Vai a Ricorda
          </Button>
        </div>
      )}
      {endMutation.isError && (!staged || phase !== 'recall') && (
        <p role="alert" className="text-sm text-danger">
          {(endMutation.error as Error).message}
        </p>
      )}
      {staged && savePhase.isError && (
        <p role="alert" className="text-xs text-danger">
          Non sono riuscito a salvare la fase: riaprendo la lezione ripartirai dall&apos;ultima
          salvata.
        </p>
      )}

      {staged && (
        <>
          <PhaseStepper current={phase} progress={progress} onSelect={goTo} />
          <p role="status" className="sr-only">
            {announce}
          </p>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div
          id="lesson-phase"
          role="region"
          aria-label="Fase della lezione"
          ref={mainRef}
          tabIndex={-1}
          className="min-w-0 space-y-4 outline-none"
        >
          {step}
          {staged && <PhaseNav phase={phase} onGo={goTo} primary={phase !== 'understand'} />}
        </div>

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
