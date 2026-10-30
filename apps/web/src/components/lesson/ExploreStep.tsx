'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionDocumentDto } from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import { Markdown, fetchBriefing } from '@/components/SessionBriefing';
import { LessonError } from '@/components/lesson/LessonStatus';
import { formatPageRanges, guideQuestionsOf, type useLesson } from '@/lib/lessonClient';

type Lesson = ReturnType<typeof useLesson>;

export type ExploreLessonStatus =
  'loading' | 'load_error' | 'preparing' | 'ready' | 'not_generated';

const LABEL = 'text-xs font-medium uppercase tracking-wide text-fg-secondary';
const BOX = 'rounded-[var(--radius-control)] border border-border bg-bg-inset p-4';

/** Documents of the lesson: the ones the task points at first, or all of them when none is. */
export function lessonDocuments(docs: SessionDocumentDto[]): SessionDocumentDto[] {
  const highlighted = docs.filter((d) => d.highlighted);
  return highlighted.length > 0 ? highlighted : docs;
}

function Bars({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2">
      <div className="space-y-2 motion-reduce:hidden" aria-hidden="true">
        <div className="h-3 w-4/5 animate-pulse rounded bg-bg-raised" />
        <div className="h-3 w-full animate-pulse rounded bg-bg-raised" />
        <div className="h-3 w-3/5 animate-pulse rounded bg-bg-raised" />
      </div>
      <p className="text-sm text-fg-secondary">{label}</p>
    </div>
  );
}

/** Presentation of "Esplora": documents, the index of the lesson and the guide questions. */
export function ExploreStepView({
  docs,
  blockTitles,
  blockCount,
  questions,
  status,
  error,
  canAsk,
  onOpenDocument,
  onAskQuestion,
}: {
  docs: SessionDocumentDto[];
  /** Titles of the blocks already written, in order. */
  blockTitles: string[];
  blockCount: number | null;
  questions: { id: string; title: string }[];
  status: ExploreLessonStatus;
  /** The block 0 job failed: the reason and what "Riprova" does. */
  error: { message: string | null; retrying: boolean; onRetry: () => void } | null;
  canAsk: boolean;
  onOpenDocument: (docId: string, page?: number) => void;
  onAskQuestion: (text: string) => void;
}) {
  const [own, setOwn] = useState('');
  const shownDocs = lessonDocuments(docs);
  const rows = Array.from({ length: Math.max(blockCount ?? 0, blockTitles.length) }, (_, i) => i);

  return (
    <section
      aria-labelledby="explore-title"
      className="space-y-4 rounded-[var(--radius-card)] border border-border bg-bg-surface p-5 md:p-6"
    >
      <div className="space-y-1">
        <h2
          id="explore-title"
          data-phase-heading
          tabIndex={-1}
          className="text-xl font-semibold text-fg-primary outline-none"
        >
          Prima di leggere: guarda la struttura
        </h2>
        <p className="text-sm text-fg-secondary">
          2–5 minuti. Scorri titoli e figure, senza leggere tutto.
        </p>
      </div>

      {error && (
        <LessonError
          what="la lezione"
          error={error.message}
          retrying={error.retrying}
          onRetry={error.onRetry}
        />
      )}

      <div className="flex flex-wrap gap-4">
        <div className="min-w-0 flex-1 basis-[16rem] space-y-3">
          <div className={BOX}>
            <p className={LABEL}>Il materiale di oggi</p>
            {shownDocs.length === 0 ? (
              <p className="mt-2 text-sm text-fg-secondary">
                Nessun documento collegato a questa lezione.
              </p>
            ) : (
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                {shownDocs.map((d) => {
                  const pages = formatPageRanges(d.pageRanges);
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => onOpenDocument(d.id, d.pageRanges[0]?.pageFrom)}
                        className="min-h-11 w-full rounded-[var(--radius-control)] px-2 py-1 text-left text-sm text-fg-primary hover:bg-bg-raised md:min-h-9"
                      >
                        {d.name}
                        {pages && <span className="text-xs text-fg-secondary"> · {pages}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className={BOX}>
            <p className={LABEL}>La lezione · {blockCount ?? '…'} blocchi</p>
            {status === 'load_error' ? null : status === 'loading' ||
              (status === 'preparing' && rows.length === 0) ? (
              <div className="mt-2">
                <Bars label="Sto preparando la lezione dal materiale…" />
              </div>
            ) : status === 'not_generated' ? (
              <p className="mt-2 text-sm text-fg-secondary">Questa lezione non è stata generata.</p>
            ) : (
              <ol className="mt-2 space-y-1 text-sm">
                {rows.map((i) => (
                  <li key={i} className={blockTitles[i] ? 'text-fg-primary' : 'text-fg-muted'}>
                    <span className="mr-1.5 text-fg-secondary">{i + 1}.</span>
                    {blockTitles[i] ?? `Blocco ${i + 1}`}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-[1.2] basis-[20rem] space-y-3">
          <div className={BOX}>
            <p className={LABEL}>Domande guida · a fine lezione saprai rispondere</p>
            {questions.length > 0 ? (
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-fg-primary">
                {questions.map((q) => (
                  <li key={q.id}>
                    <Markdown source={q.title} />
                  </li>
                ))}
              </ol>
            ) : status === 'ready' ? (
              <p className="mt-2 text-sm text-fg-secondary">Questa lezione non ha domande guida.</p>
            ) : status === 'not_generated' || status === 'load_error' ? null : (
              <p role="status" className="mt-2 text-sm text-fg-secondary">
                Le domande guida arrivano insieme al primo blocco della lezione.
              </p>
            )}
          </div>

          {canAsk && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                const text = own.trim();
                if (!text) return;
                onAskQuestion(text);
                setOwn('');
              }}
            >
              <label htmlFor="explore-own-question" className={LABEL}>
                Una tua domanda (facoltativa)
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="explore-own-question"
                  value={own}
                  onChange={(e) => setOwn(e.target.value)}
                  maxLength={500}
                  placeholder="Cosa vuoi capire da questa lezione?"
                  className="h-11 min-w-0 flex-1 basis-[12rem] rounded-[var(--radius-control)] border border-border bg-bg-inset px-3 text-sm text-fg-primary outline-none focus:border-accent md:h-9"
                />
                <Button type="submit" variant="secondary" disabled={!own.trim()}>
                  Chiedi al tutor
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

/** "Esplora": opening it already asks for the first block (the lesson hook does it by itself). */
export function ExploreStep({
  slug,
  sessionId,
  docs,
  lesson,
  active,
  onOpenDocument,
  onAskQuestion,
}: {
  slug: string;
  sessionId: string;
  docs: SessionDocumentDto[];
  lesson: Lesson;
  active: boolean;
  onOpenDocument: (docId: string, page?: number) => void;
  onAskQuestion: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const briefing = useQuery({
    queryKey: ['sessionBriefing', slug, sessionId],
    queryFn: () => fetchBriefing(slug, sessionId),
  });
  const blocks = lesson.data?.blocks ?? [];
  const blockCount = lesson.data?.blockCount ?? null;

  // The guide questions are born with block 0: read them again as soon as it exists.
  const hadBlocks = useRef(blocks.length > 0);
  useEffect(() => {
    if (blocks.length > 0 && !hadBlocks.current) {
      queryClient.invalidateQueries({ queryKey: ['sessionBriefing', slug, sessionId] });
    }
    hadBlocks.current = blocks.length > 0;
  }, [blocks.length, queryClient, slug, sessionId]);

  const job = lesson.job;
  const startFailed = lesson.start.isError ? (lesson.start.error as Error).message : null;
  const failed = blocks.length === 0 && (job?.status === 'failed' || !!startFailed);
  let status: ExploreLessonStatus;
  if (lesson.query.isError && !lesson.data) status = 'load_error';
  else if (lesson.query.isLoading || !lesson.data) status = 'loading';
  else if (blocks.length > 0) status = 'ready';
  else if (!active && !lesson.inFlight) status = 'not_generated';
  else status = 'preparing';

  return (
    <ExploreStepView
      docs={docs}
      blockTitles={blocks.map((b) => b.title)}
      blockCount={blockCount}
      questions={guideQuestionsOf(briefing.data?.items ?? [])}
      status={status}
      error={
        status === 'load_error'
          ? {
              message: (lesson.query.error as Error).message,
              retrying: lesson.query.isFetching,
              onRetry: () => void lesson.query.refetch(),
            }
          : failed
            ? {
                message: startFailed ?? job?.error ?? null,
                retrying: lesson.start.isPending,
                onRetry: () => lesson.start.mutate({}),
              }
            : null
      }
      canAsk={active}
      onOpenDocument={onOpenDocument}
      onAskQuestion={onAskQuestion}
    />
  );
}
