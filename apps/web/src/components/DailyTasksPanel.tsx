'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskDto } from '@studyhub/contracts';

async function fetchToday(slug: string): Promise<TaskDto[]> {
  const res = await fetch(`/api/subjects/${slug}/plan/today`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare le task di oggi');
  return body.tasks as TaskDto[];
}

async function setStatus(slug: string, taskId: string, status: 'done' | 'skipped') {
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

/**
 * "Oggi" (docs/fasi/F7-dashboard-polish.md): the committed plan's actionable
 * tasks for today, one click away from Dashboard/Materia. **Not built**:
 * the "Debito" screen (rimanda/riassorbi/archivia for overdue tasks) — this
 * lists overdue `todo`/`doing` tasks flatly, without that triage UI.
 */
export function DailyTasksPanel({ subjectSlug }: { subjectSlug: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['daily-tasks', subjectSlug],
    queryFn: () => fetchToday(subjectSlug),
  });

  const mutate = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: 'done' | 'skipped' }) =>
      setStatus(subjectSlug, taskId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['daily-tasks', subjectSlug] }),
  });

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">Oggi</h2>
        <Link
          href={`/materie/${subjectSlug}/piano`}
          className="text-[11px] text-fg-muted underline-offset-2 hover:text-fg-secondary hover:underline"
        >
          Piano →
        </Link>
      </div>

      <div className="space-y-2 px-1 text-xs">
        {query.isLoading && <p className="text-fg-muted">Caricamento…</p>}
        {query.isError && (
          <p role="alert" className="text-danger">
            {(query.error as Error).message}
          </p>
        )}
        {query.isSuccess && query.data.length === 0 && (
          <p className="text-fg-muted">Nessuna task per oggi — genera o rigenera un piano.</p>
        )}
      </div>

      {query.isSuccess && query.data.length > 0 && (
        <ul className="mt-1 space-y-1.5">
          {query.data.map((task) => (
            <li
              key={task.id}
              className="rounded-[var(--radius-control)] border border-border px-2.5 py-1.5"
            >
              <p className="text-[11px] uppercase tracking-wide text-fg-muted">
                {task.date} · {task.minutes} min
              </p>
              <p className="text-sm text-fg-primary">{task.title}</p>
              <div className="mt-1 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => mutate.mutate({ taskId: task.id, status: 'done' })}
                  disabled={mutate.isPending}
                  className="rounded-[var(--radius-control)] border border-ok px-2 py-0.5 text-[11px] text-ok"
                >
                  Fatta
                </button>
                <button
                  type="button"
                  onClick={() => mutate.mutate({ taskId: task.id, status: 'skipped' })}
                  disabled={mutate.isPending}
                  className="rounded-[var(--radius-control)] border border-border px-2 py-0.5 text-[11px] text-fg-muted"
                >
                  Salta
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
