'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BulkPlanActionRequest,
  DriftReportDto,
  ExamDto,
  GeneratePlanRequest,
  PlanDiffDto,
  PlanDto,
  PlanPreviewDto,
  SubjectDto,
  TaskDto,
} from '@studyhub/contracts';

// Same helpers as `PlanClient.tsx` (not exported from there on purpose: the desktop stays untouched).
async function getJson<T>(url: string, key: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Caricamento fallito');
  return body[key] as T;
}

export async function send(url: string, method: string, payload?: unknown) {
  const init: RequestInit = { method };
  if (payload !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(payload);
  }
  const res = await fetch(url, init);
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Operazione fallita');
  return body;
}

export type TaskStatusChange = 'done' | 'skipped' | 'todo';

/** Read side of the plan screen: same query keys as the desktop `PlanClient`. */
export function usePlanQueries(
  slug: string,
  opts: { awaitingDraft: boolean; selectedId: string | null },
) {
  const plans = useQuery({
    queryKey: ['plans', slug],
    queryFn: () => getJson<PlanDto[]>(`/api/subjects/${slug}/plan/list`, 'plans'),
    refetchInterval: opts.awaitingDraft ? 2000 : false,
  });
  const list = plans.data ?? [];
  const selected = list.find((p) => p.id === opts.selectedId) ?? list[0] ?? null;
  const exams = useQuery({
    queryKey: ['exams', slug],
    queryFn: () => getJson<ExamDto[]>(`/api/subjects/${slug}/exams`, 'exams'),
  });
  const subject = useQuery({
    queryKey: ['subject', slug],
    queryFn: () => getJson<SubjectDto>(`/api/subjects/${slug}`, 'subject'),
  });
  const diff = useQuery({
    queryKey: ['plan-diff', slug],
    queryFn: () => getJson<PlanDiffDto | null>(`/api/subjects/${slug}/plan/diff`, 'diff'),
    enabled: list.some((p) => p.status === 'draft'),
  });
  const drift = useQuery({
    queryKey: ['plan-drift', slug],
    queryFn: () => getJson<DriftReportDto | null>(`/api/subjects/${slug}/plan/drift`, 'drift'),
    enabled: selected?.status === 'active',
  });
  return { plans, exams, subject, diff, drift };
}

export function usePlanPreview(slug: string, settledKey: string, enabled: boolean) {
  return useQuery({
    queryKey: ['plan-preview', slug, settledKey],
    queryFn: async () => {
      const body = await send(`/api/subjects/${slug}/plan/preview`, 'POST', JSON.parse(settledKey));
      return body.preview as PlanPreviewDto;
    },
    enabled,
    retry: false,
  });
}

/** Write side: every mutation refreshes the plan queries; calendar-affecting ones refresh `['calendar']` too. */
export function usePlanMutations(slug: string) {
  const queryClient = useQueryClient();
  const invalidate = (withCalendar: boolean) => {
    for (const key of ['plans', 'plan-diff', 'plan-drift', 'daily-tasks']) {
      queryClient.invalidateQueries({ queryKey: [key, slug] });
    }
    if (withCalendar) queryClient.invalidateQueries({ queryKey: ['calendar'] });
  };
  const base = `/api/subjects/${slug}/plan`;

  const generate = useMutation({
    mutationFn: (req: GeneratePlanRequest) => send(base, 'POST', req),
    onSuccess: () => invalidate(false),
  });
  const commit = useMutation({
    mutationFn: (planId: string) => send(`${base}/${planId}/commit`, 'POST', {}),
    onSuccess: () => invalidate(true),
  });
  const discard = useMutation({
    mutationFn: () => send(`${base}/draft`, 'DELETE'),
    onSuccess: () => invalidate(false),
  });
  const deletePlan = useMutation({
    mutationFn: (planId: string) => send(`${base}/${planId}`, 'DELETE'),
    onSuccess: () => invalidate(true),
  });
  const pin = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      send(`${base}/tasks/${id}`, 'PATCH', { pinned }),
    onSuccess: () => invalidate(false),
  });
  const removeTask = useMutation({
    mutationFn: (id: string) => send(`${base}/tasks/${id}`, 'DELETE'),
    onSuccess: () => invalidate(false),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatusChange }) =>
      send(`${base}/tasks/${id}/status`, 'POST', { status }),
    onSuccess: () => invalidate(true),
  });
  const move = useMutation({
    mutationFn: ({ id, date }: { id: string; date: string }) =>
      send(`${base}/tasks/${id}/move`, 'POST', { date }),
    onSuccess: () => invalidate(true),
  });
  const bulk = useMutation({
    mutationFn: (action: BulkPlanActionRequest) => send(`${base}/bulk`, 'POST', action),
    onSuccess: () => invalidate(true),
  });
  // One transaction: on error nothing has moved.
  const moveMany = useMutation({
    mutationFn: (ids: string[]) =>
      send(`${base}/tasks/move`, 'POST', { taskIds: ids.slice(0, 100), days: 1 }),
    onSuccess: () => invalidate(true),
  });
  // One by one: each reabsorb reads the plan the previous one wrote. Stops at the first refusal.
  const reabsorb = useMutation({
    mutationFn: async (tasks: TaskDto[]) => {
      let done = 0;
      for (const t of tasks) {
        try {
          await send(`${base}/tasks/${t.id}/reabsorb`, 'POST');
        } catch (err) {
          throw new Error(`${(err as Error).message} (${done} di ${tasks.length} riassorbite)`, {
            cause: err,
          });
        }
        done += 1;
      }
    },
    onSettled: () => invalidate(true),
  });

  return {
    generate,
    commit,
    discard,
    deletePlan,
    pin,
    removeTask,
    setStatus,
    move,
    bulk,
    moveMany,
    reabsorb,
  };
}
