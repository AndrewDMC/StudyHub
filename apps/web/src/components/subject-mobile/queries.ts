'use client';

import { useQuery } from '@tanstack/react-query';
import type { TaskDto } from '@studyhub/contracts';

async function fetchToday(slug: string): Promise<TaskDto[]> {
  const res = await fetch(`/api/subjects/${slug}/plan/today`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare le task di oggi');
  return body.tasks as TaskDto[];
}

/** Same key as `DailyTasksPanel`: the two share one fetch and one invalidation. */
export function useTodayTasks(slug: string) {
  return useQuery({ queryKey: ['daily-tasks', slug], queryFn: () => fetchToday(slug) });
}

export async function markTaskDone(slug: string, taskId: string) {
  const res = await fetch(`/api/subjects/${slug}/plan/tasks/${taskId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'done' }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Azione fallita');
  }
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Tasks scheduled for today or later (the endpoint also returns overdue ones). */
export function currentTasks(tasks: TaskDto[]): TaskDto[] {
  const today = todayIso();
  return tasks.filter((t) => t.date >= today);
}

export const TASK_KIND_LABELS: Record<TaskDto['kind'], string> = {
  read: 'lettura',
  flashcards: 'flashcard',
  schema: 'schema',
  simulation: 'simulazione',
  drill: 'esercizi',
  review: 'ripasso',
  rest: 'pausa',
};
