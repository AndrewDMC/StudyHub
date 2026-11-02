'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  DriftReportDto,
  PlanDto,
  ReviewOverviewDto,
  SimulationSummaryDto,
  TaskDto,
} from '@studyhub/contracts';
import { fetchSubjectOverview, subjectOverviewKey } from '@/lib/reviewOverview';
import { useOverview } from '../OverviewPanel';

async function getJson<T>(url: string, key: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Caricamento fallito');
  return body[key] as T;
}

/**
 * The queries behind the Panoramica cards. Same keys as the rest of the app, so each endpoint is
 * fetched once; every card reads its own query and fails on its own.
 */
export function useOverviewData(slug: string) {
  const plans = useQuery({
    queryKey: ['plans', slug],
    queryFn: () => getJson<PlanDto[]>(`/api/subjects/${slug}/plan/list`, 'plans'),
  });
  const today = useQuery({
    queryKey: ['daily-tasks', slug],
    queryFn: () => getJson<TaskDto[]>(`/api/subjects/${slug}/plan/today`, 'tasks'),
  });
  const drift = useQuery({
    queryKey: ['plan-drift', slug],
    queryFn: () => getJson<DriftReportDto | null>(`/api/subjects/${slug}/plan/drift`, 'drift'),
  });
  const review = useQuery({
    queryKey: subjectOverviewKey(slug),
    queryFn: () => fetchSubjectOverview(slug),
    select: (dto: ReviewOverviewDto) =>
      dto.subjects.find((s) => s.slug === slug) ?? dto.subjects[0] ?? null,
  });
  const overview = useOverview(slug);
  const simulations = useQuery({
    queryKey: ['simulations', slug],
    queryFn: () =>
      getJson<SimulationSummaryDto[]>(`/api/subjects/${slug}/simulations`, 'simulations'),
  });
  return { plans, today, drift, review, overview, simulations };
}
