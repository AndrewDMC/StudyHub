'use client';

import { useQuery } from '@tanstack/react-query';
import type { SessionFocus, SessionItemCitationDto } from '@studyhub/contracts';
import {
  ExerciseCard,
  SessionBriefing,
  fetchBriefing,
  type useSessionBriefing,
} from '@/components/SessionBriefing';

type BriefingApi = ReturnType<typeof useSessionBriefing>;

/** The guide questions of the lesson, answered and corrected like the exercises. Nothing without them. */
export function GuideQuestions({
  api,
  active,
  onOpenCitation,
}: {
  api: BriefingApi;
  active: boolean;
  onOpenCitation: (citation: SessionItemCitationDto) => void;
}) {
  const questions = [...api.guideQuestions].sort((a, b) => a.orderIndex - b.orderIndex);
  if (questions.length === 0) return null;
  return (
    <section aria-labelledby="apply-guide" className="space-y-3">
      <div className="space-y-1">
        <h3 id="apply-guide" className="text-base font-semibold text-fg-primary">
          Ora rispondi alle domande guida
        </h3>
        <p className="text-sm text-fg-secondary">
          Sono quelle dell&apos;inizio: a fine lezione dovresti saperle spiegare.
        </p>
      </div>
      <ul className="space-y-3">
        {questions.map((item, i) => (
          <ExerciseCard
            key={item.id}
            item={item}
            index={i}
            variant="guide"
            active={active}
            grading={api.grade.isPending && api.grade.variables?.id === item.id}
            gradeError={
              api.grade.isError && api.grade.variables?.id === item.id
                ? (api.grade.error as Error).message
                : null
            }
            onPatch={(body) => api.patch.mutate({ id: item.id, ...body })}
            onGrade={(answer) => api.grade.mutate({ id: item.id, answer })}
            onOpenCitation={onOpenCitation}
          />
        ))}
      </ul>
    </section>
  );
}

/** "Applica": the exercises of the session and, below, the guide questions. */
export function ApplyStep({
  slug,
  sessionId,
  active,
  hasDocuments,
  onOpenCitation,
  onAsk,
}: {
  slug: string;
  sessionId: string;
  active: boolean;
  hasDocuments: boolean;
  onOpenCitation: (citation: SessionItemCitationDto) => void;
  onAsk: (focus: SessionFocus) => void;
}) {
  // Same key as the briefing below: one request, shared through the cache.
  const briefing = useQuery({
    queryKey: ['sessionBriefing', slug, sessionId],
    queryFn: () => fetchBriefing(slug, sessionId),
  });
  const exercises = (briefing.data?.items ?? []).filter((i) => i.kind === 'exercise');
  const right = exercises.filter((i) => i.state === 'correct').length;

  return (
    <section
      aria-labelledby="apply-title"
      className="space-y-4 rounded-[var(--radius-card)] border border-border bg-bg-surface p-5 max-md:border-0 max-md:bg-transparent max-md:px-0 md:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="apply-title"
          data-phase-heading
          tabIndex={-1}
          className="text-xl font-semibold text-fg-primary outline-none"
        >
          Mettiti alla prova
        </h2>
        {exercises.length > 0 && (
          <p className="text-sm text-fg-secondary">
            {right} di {exercises.length} {right === 1 ? 'corretto' : 'corretti'} · difficoltà
            crescente
          </p>
        )}
      </div>
      <SessionBriefing
        slug={slug}
        sessionId={sessionId}
        active={active}
        hasDocuments={hasDocuments}
        onOpenCitation={onOpenCitation}
        onAsk={onAsk}
        only="exercise"
        footer={(api) => (
          <GuideQuestions api={api} active={active} onOpenCitation={onOpenCitation} />
        )}
      />
    </section>
  );
}
