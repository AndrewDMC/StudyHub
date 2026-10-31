'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SessionDocumentDto, StudySessionDto, VerifyStateDto } from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import { usePomodoro } from '@/components/PomodoroTimer';
import { patchSession, postEnd } from '@/lib/sessionApi';
import { verifyKey } from '@/lib/verifyClient';
import { LessonError, LessonSkeleton } from '@/components/lesson/LessonStatus';
import { VerifyHeader } from '@/components/verify/VerifyHeader';
import {
  VerifyMaterialPanel,
  type VerifyMaterialTarget,
} from '@/components/verify/VerifyMaterialPanel';
import { VerifyProgress } from '@/components/verify/VerifyProgress';
import { VerifyQuestionCard } from '@/components/verify/VerifyQuestionCard';
import { VerifySummary } from '@/components/verify/VerifySummary';
import {
  canRetry,
  currentIndex,
  jobInFlight,
  showSummary,
  useVerify,
  verifyMode,
  type VerifyCitation,
} from '@/lib/verifyClient';

type RenderDocument = (props: {
  doc: SessionDocumentDto;
  canAsk: boolean;
  onAsk: () => void;
  target: { page: number; nonce: number } | null;
}) => ReactNode;

const NOTE =
  'Una verifica non è una rilettura: prima rispondi a memoria, solo se sbagli si riapre il materiale.';

function Shell({ children, header }: { children: ReactNode; header?: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-base text-fg-primary">
      {header}
      {children}
    </div>
  );
}

/** Index of the next question still open after `from` (none: `items.length`, i.e. the outcome). */
export function nextOpenIndex(items: { state: string }[], from: number): number {
  for (let i = from + 1; i < items.length; i++) if (items[i]!.state === 'open') return i;
  return items.length;
}

/**
 * The closed-book check of a topic, one question at a time. Mounted by `SessionClient` for
 * `kind === 'verify'`; a verify session from before this page (no prepared questions) renders
 * `fallback`, the page of old.
 */
export function VerifyClient({
  slug,
  sessionId,
  session,
  renderDocument,
  fallback,
}: {
  slug: string;
  sessionId: string;
  session: StudySessionDto;
  renderDocument: RenderDocument;
  fallback: ReactNode;
}) {
  const verify = useVerify({ slug, sessionId });
  const data = verify.data;
  const mode = verifyMode(data);

  if (mode === 'legacy') return <>{fallback}</>;
  if (!data) {
    if (verify.query.isError) {
      return (
        <Shell>
          <div className="space-y-3 p-4">
            <p role="alert" className="text-sm text-danger">
              {(verify.query.error as Error).message}
            </p>
            <Button type="button" variant="secondary" onClick={() => verify.query.refetch()}>
              Riprova
            </Button>
          </div>
        </Shell>
      );
    }
    return (
      <Shell>
        <div className="mx-auto w-full max-w-[760px] px-6 pt-8 max-md:px-4">
          <LessonSkeleton label="Carico la verifica…" />
        </div>
      </Shell>
    );
  }
  return (
    <VerifyPage
      slug={slug}
      sessionId={sessionId}
      session={session}
      data={data}
      mode={mode}
      verify={verify}
      renderDocument={renderDocument}
    />
  );
}

function VerifyPage({
  slug,
  sessionId,
  session,
  data,
  mode,
  verify,
  renderDocument,
}: {
  slug: string;
  sessionId: string;
  session: StudySessionDto;
  data: VerifyStateDto;
  mode: ReturnType<typeof verifyMode>;
  verify: ReturnType<typeof useVerify>;
  renderDocument: RenderDocument;
}) {
  const { grade, markUnknown, retry, prepare } = verify;
  const { items, ended } = data;
  const router = useRouter();
  const queryClient = useQueryClient();
  const active = !ended && session.status === 'active';
  // Only the clock: it keeps the active time, which is saved when the check is closed.
  const timer = usePomodoro({
    savedActiveMs: session.activeMs,
    savedPomodoros: session.pomodoros,
    enabled: active,
    onBeat: (activeMs, pomodoros) => {
      patchSession(slug, sessionId, { activeMs, pomodoros }).catch(() => {
        /* a missed beat is recovered by the next one or by the closing */
      });
    },
  });
  const endMutation = useMutation({
    mutationFn: () =>
      postEnd(slug, sessionId, {
        activeMs: timer.studyMsRef.current,
        pomodoros: timer.completedRef.current,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(['studySession', slug, sessionId], next);
      queryClient.invalidateQueries({ queryKey: verifyKey(slug, sessionId) });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['plans', slug] });
      queryClient.invalidateQueries({ queryKey: ['topics', slug] });
    },
  });
  const subjectHref = `/materie/${slug}`;
  const [viewIndex, setViewIndex] = useState(() => currentIndex(items));
  const [material, setMaterial] = useState<VerifyMaterialTarget | null>(null);
  const [announce, setAnnounce] = useState('');
  const trigger = useRef<HTMLElement | null>(null);
  const mounted = useRef(false);

  const index = Math.min(viewIndex, items.length);
  const atEnd = index >= items.length;
  const item = atEnd ? null : items[index]!;
  const summaryShown = showSummary(data);
  const lastOpen = item ? nextOpenIndex(items, index) >= items.length : false;

  // The outcome takes the focus when it appears after "Avanti", never when the page opens.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (atEnd) document.getElementById('esito')?.focus({ preventScroll: false });
  }, [atEnd]);

  useEffect(() => {
    if (item) setAnnounce(`Domanda ${index + 1} di ${items.length}`);
  }, [index, item?.id, items.length]);

  function openCitation(citation: VerifyCitation) {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMaterial({ docId: citation.docId, page: citation.page, nonce: Date.now() });
    setAnnounce(`Materiale aperto: ${citation.documentName}, pagina ${citation.page}.`);
    if (window.matchMedia?.('(max-width: 1023.98px)').matches) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.setTimeout(
        () =>
          document
            .getElementById('verify-material')
            ?.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }),
        0,
      );
    }
  }
  function closeMaterial() {
    setMaterial(null);
    trigger.current?.focus();
  }

  function goNext() {
    setViewIndex(ended ? index + 1 : nextOpenIndex(items, index));
  }
  function doRetry() {
    retry.mutate(undefined, {
      onSuccess: (state) => {
        const first = currentIndex(state.items);
        setViewIndex(first);
        const redo = state.items.filter((i) => i.state === 'open').length;
        setAnnounce(`Rifaccio ${redo} ${redo === 1 ? 'domanda' : 'domande'}.`);
        window.setTimeout(
          () => document.querySelector<HTMLElement>('[data-verify-heading]')?.focus(),
          0,
        );
      },
    });
  }

  const errorOf = (id: string): string | null => {
    if (grade.isError && grade.variables?.id === id) return (grade.error as Error).message;
    if (markUnknown.isError && markUnknown.variables?.id === id)
      return (markUnknown.error as Error).message;
    return null;
  };

  const header = (
    <VerifyHeader
      subjectName={data.subjectName}
      subjectHref={subjectHref}
      topicName={data.topicName}
      daysOffset={data.daysOffset}
    />
  );

  if (mode === 'preparing') {
    return (
      <Shell header={header}>
        <main
          aria-label="Verifica"
          className="mx-auto w-full max-w-[760px] space-y-3 px-6 pt-8 max-md:px-4"
        >
          <LessonSkeleton label="Sto preparando la verifica: qualche domanda nuova dal materiale…" />
          <p className="text-xs text-fg-muted">
            Puoi restare qui: la verifica parte da sola quando è pronta.
          </p>
        </main>
      </Shell>
    );
  }
  if (mode === 'failed' || mode === 'empty') {
    return (
      <Shell header={header}>
        <main aria-label="Verifica" className="mx-auto w-full max-w-[760px] px-6 pt-8 max-md:px-4">
          <LessonError
            what="la verifica"
            error={
              data.job?.error ??
              (mode === 'empty' ? 'non ci sono domande disponibili per questo argomento' : null)
            }
            retrying={prepare.isPending}
            onRetry={() => prepare.mutate({ force: true })}
          />
        </main>
      </Shell>
    );
  }

  const grading = grade.isPending;
  const busy = grading || markUnknown.isPending;
  const generating = jobInFlight(data);
  const failedWithItems = data.job?.status === 'failed';
  const bodyWidth = material ? 'max-w-[1200px]' : 'max-w-[760px]';

  return (
    <Shell header={header}>
      <p role="status" className="sr-only">
        {announce}
      </p>
      <div
        className={`mx-auto w-full ${bodyWidth} px-6 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-8 max-md:px-4 max-md:pb-[calc(2rem+env(safe-area-inset-bottom))] ${
          material ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-6' : ''
        }`}
      >
        <main aria-label="Verifica" className="flex min-w-0 flex-col gap-5">
          {failedWithItems && (
            <LessonError
              what="la verifica"
              error={data.job?.error ?? null}
              retrying={prepare.isPending}
              onRetry={() => prepare.mutate({ force: true })}
            />
          )}
          {ended && (
            <p
              role="status"
              className="rounded-[var(--radius-control)] border border-border bg-bg-raised px-3.5 py-2.5 text-sm text-fg-secondary"
            >
              Verifica terminata. Qui puoi rileggere le risposte.
            </p>
          )}
          <VerifyProgress items={items} viewIndex={index} done={atEnd && summaryShown} />
          {generating && (
            <p className="-mt-2 text-xs text-fg-muted">Sto aggiungendo una domanda nuova…</p>
          )}

          {item ? (
            <>
              <VerifyQuestionCard
                key={item.id}
                sessionId={sessionId}
                item={item}
                n={index + 1}
                total={items.length}
                ended={ended}
                busy={busy}
                grading={grading && grade.variables?.id === item.id}
                error={errorOf(item.id)}
                nextLabel={ended ? null : lastOpen ? 'Vedi l’esito →' : 'Avanti →'}
                onGrade={(answer) => grade.mutate({ id: item.id, answer })}
                onUnknown={() => markUnknown.mutate({ id: item.id })}
                onNext={goNext}
                onOpenCitation={openCitation}
              />
              {ended && (
                <div className="flex justify-between gap-2.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={index === 0}
                    aria-label={`Domanda precedente (${index} di ${items.length})`}
                    onClick={() => setViewIndex(index - 1)}
                  >
                    ← Domanda precedente
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Domanda successiva (${index + 2} di ${items.length})`}
                    onClick={() => setViewIndex(index + 1)}
                  >
                    Domanda successiva →
                  </Button>
                </div>
              )}
            </>
          ) : summaryShown && data.summary ? (
            <>
              <VerifySummary
                summary={data.summary}
                subjectHref={subjectHref}
                topicName={data.topicName}
                canRetry={canRetry(data)}
                retrying={retry.isPending}
                onRetry={doRetry}
                closed={ended}
                closing={endMutation.isPending}
                closeError={endMutation.isError ? (endMutation.error as Error).message : null}
                onClose={() => endMutation.mutate()}
                onBack={() =>
                  endMutation.mutate(undefined, { onSuccess: () => router.push(subjectHref) })
                }
                retryError={retry.isError ? (retry.error as Error).message : null}
              />
              {ended && items.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => setViewIndex(items.length - 1)}
                >
                  ← Domanda precedente
                </Button>
              )}
            </>
          ) : ended ? (
            <p className="text-sm text-fg-secondary">
              La verifica è stata chiusa prima di finire: l’esito non è disponibile.
            </p>
          ) : (
            <p role="status" className="text-sm text-fg-secondary">
              {generating ? 'Sto aggiungendo una domanda nuova…' : 'Calcolo l’esito…'}
            </p>
          )}

          <p className="text-[13px] text-fg-secondary">{NOTE}</p>
        </main>

        {material && (
          <div
            id="verify-material"
            className="mt-4 max-lg:h-[75dvh] lg:sticky lg:top-4 lg:mt-0 lg:h-[calc(100vh-2rem)]"
          >
            <VerifyMaterialPanel
              docs={session.documents}
              target={material}
              onClose={closeMaterial}
              renderDocument={renderDocument}
            />
          </div>
        )}
      </div>
    </Shell>
  );
}
