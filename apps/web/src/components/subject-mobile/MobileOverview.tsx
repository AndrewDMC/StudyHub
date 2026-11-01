'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DocumentDto, ExamDto, TopicDto } from '@studyhub/contracts';
import { SkeletonRows, SectionError } from './SectionState';
import { MobileTodayLesson } from './MobileTodayLesson';
import { MobileRecall } from './MobileRecall';
import { MobileFixList } from './MobileFixList';
import { MobileTopics } from './MobileTopics';
import { RecentActivitySection } from './RecentActivitySection';
import { useOverviewData } from '../overview/useOverviewData';
import {
  buildTodayModel,
  fixRows,
  pickActivePlan,
  progressCounts,
  recallVerifies,
  todayIso,
  topicRows,
} from '../overview/model';
import { cardClass } from '../simulation-mobile/styles';

/** Panoramica of the subject below md: today's lesson, recall, fixes, topics, recent activity. */
export function MobileOverview({
  slug,
  topics,
  documents,
  nextExam,
  fakeProvider,
}: {
  slug: string;
  topics: TopicDto[];
  documents: DocumentDto[];
  nextExam: ExamDto | undefined;
  fakeProvider: boolean;
}) {
  const { plans, today, drift, review, overview } = useOverviewData(slug);
  // Same key as the subject page: the list shows a skeleton until the topics have arrived.
  const topicsLoading = useQuery({
    queryKey: ['topics', slug],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${slug}/topics`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare gli argomenti');
      return body.topics as TopicDto[];
    },
  }).isLoading;
  const todayDate = todayIso();

  const planList = useMemo(() => plans.data ?? [], [plans.data]);
  const plan = useMemo(
    () => pickActivePlan(planList, nextExam?.id, todayDate),
    [planList, nextExam?.id, todayDate],
  );
  const todayTasks = useMemo(() => today.data ?? [], [today.data]);
  const model = useMemo(
    () => buildTodayModel(todayTasks, planList, plan, todayDate),
    [todayTasks, planList, plan, todayDate],
  );
  const counts = useMemo(() => progressCounts(plan), [plan]);
  const rows = useMemo(
    () => topicRows(plan, topics, documents, todayDate),
    [plan, topics, documents, todayDate],
  );
  const verifies = useMemo(() => recallVerifies(plan, todayDate), [plan, todayDate]);
  const fixes = overview.data
    ? fixRows({ slug, overview: overview.data, plan, drift: drift.data, topics, documents })
    : [];
  const hasDebt = todayTasks.some((t) => t.date < todayDate);
  const heroLoading = plans.isLoading || today.isLoading;
  const heroError = plans.isError || today.isError;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {heroLoading ? (
        <section
          data-testid="lesson-today"
          aria-labelledby="m-oggi"
          aria-busy="true"
          className={`${cardClass} p-[18px]`}
        >
          <h2 id="m-oggi" className="sr-only">
            Lezione di oggi
          </h2>
          <SkeletonRows count={3} />
        </section>
      ) : heroError ? (
        <section data-testid="lesson-today" aria-labelledby="m-oggi">
          <h2 id="m-oggi" className="sr-only">
            Lezione di oggi
          </h2>
          <SectionError
            message="Impossibile caricare la lezione di oggi."
            onRetry={() => {
              void plans.refetch();
              void today.refetch();
            }}
          />
        </section>
      ) : (
        <MobileTodayLesson slug={slug} model={model} documents={documents} />
      )}
      <MobileRecall
        slug={slug}
        verifies={verifies}
        planLoading={plans.isLoading}
        review={review.data ?? null}
        reviewLoading={review.isLoading}
        reviewError={review.isError}
        onRetryReview={() => void review.refetch()}
      />
      <MobileFixList
        slug={slug}
        rows={fixes}
        hasDebt={hasDebt}
        loading={overview.isLoading}
        error={overview.isError}
        onRetry={() => void overview.refetch()}
      />
      <MobileTopics
        slug={slug}
        rows={rows}
        counts={counts}
        hasPlan={plan !== null}
        loading={topicsLoading}
      />
      <RecentActivitySection slug={slug} />
      {fakeProvider && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-3 text-xs text-fg-muted">
          Generazione simulata (nessun provider AI configurato): le flashcard/riassunti sono creati
          per estrazione deterministica dal testo, non da un modello reale — vedi
          docs/fasi/F3-ai-core.md &quot;Stato&quot;.
        </div>
      )}
    </div>
  );
}
