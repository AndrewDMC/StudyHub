'use client';

import { useMemo } from 'react';
import type { DocumentDto, ExamDto, TopicDto } from '@studyhub/contracts';
import { RecentActivityPanel } from '../OverviewPanel';
import { TabCard } from '../subject-tabs/TabCard';
import { TabError, TabLoading } from '../subject-tabs/TabState';
import { TAB_STACK } from '../subject-tabs/styles';
import { ExamProgressCard } from './ExamProgressCard';
import { FixList } from './FixList';
import { RecallCard } from './RecallCard';
import { TodayLesson } from './TodayLesson';
import { TopicsTable } from './TopicsTable';
import {
  buildTodayModel,
  fixRows,
  lastSimulation,
  nextSimulationTask,
  pickActivePlan,
  progressCounts,
  recallVerifies,
  todayIso,
  topicRows,
} from './model';
import { topicName } from '../plan/planModel';
import { useOverviewData } from './useOverviewData';

/** Panoramica of the subject (desktop): today's lesson, recall, progress, fixes, topics. */
export function OverviewTab({
  slug,
  topics,
  documents,
  nextExam,
}: {
  slug: string;
  topics: TopicDto[];
  documents: DocumentDto[];
  nextExam: ExamDto | undefined;
}) {
  const { plans, today, drift, review, overview, simulations } = useOverviewData(slug);
  const todayDate = todayIso();

  const planList = useMemo(() => plans.data ?? [], [plans.data]);
  const plan = useMemo(
    () => pickActivePlan(planList, nextExam?.id, todayDate),
    [planList, nextExam?.id, todayDate],
  );
  const todayTasks = today.data ?? [];
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
  const excludedNames = (plan?.feasibility.excludedTopicKeys ?? []).map((k) =>
    topicName(k, topics, documents),
  );
  const fixes = overview.data
    ? fixRows({
        slug,
        overview: overview.data,
        plan,
        drift: drift.data,
        topics,
        documents,
      })
    : [];
  const hasDebt = todayTasks.some((t) => t.date < todayDate);
  const heroLoading = plans.isLoading || today.isLoading;
  const heroError = plans.isError || today.isError;

  return (
    <div className={TAB_STACK}>
      <div className="grid items-start gap-5 @4xl/tab:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        {heroLoading ? (
          <TabCard aria-label="Lezione di oggi">
            <TabLoading rows={3} />
          </TabCard>
        ) : heroError ? (
          <TabError
            message="Impossibile caricare la lezione di oggi."
            onRetry={() => {
              void plans.refetch();
              void today.refetch();
            }}
          />
        ) : (
          <TodayLesson slug={slug} model={model} documents={documents} />
        )}
        <div className="flex min-w-0 flex-col gap-5">
          <RecallCard
            slug={slug}
            verifies={verifies}
            planLoading={plans.isLoading}
            review={review.data ?? null}
            reviewLoading={review.isLoading}
            reviewError={review.isError}
            onRetryReview={() => void review.refetch()}
          />
          <ExamProgressCard
            slug={slug}
            exam={nextExam}
            plan={plan}
            counts={counts}
            excludedNames={excludedNames}
            lastSim={lastSimulation(simulations.data ?? [])}
            nextSimTask={nextSimulationTask(plan)}
          />
        </div>
      </div>

      <FixList
        slug={slug}
        rows={fixes}
        hasDebt={hasDebt}
        loading={overview.isLoading}
        error={overview.isError}
        onRetry={() => void overview.refetch()}
      />

      <TopicsTable slug={slug} rows={rows} />

      <RecentActivityPanel subjectSlug={slug} />
    </div>
  );
}
