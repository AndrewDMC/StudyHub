import type { TaskDto } from '@studyhub/contracts';

/** Changes the method of a lesson task; the server sets the minutes of the new method. */
export async function patchMethod(slug: string, taskId: string, method: 'standard' | 'sprint') {
  const res = await fetch(`/api/subjects/${slug}/plan/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Azione fallita');
  return body.task as TaskDto;
}

/** Marks a task of the plan as done or skipped. */
export async function postStatus(slug: string, taskId: string, status: 'done' | 'skipped') {
  const res = await fetch(`/api/subjects/${slug}/plan/tasks/${taskId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Azione fallita');
  }
}
