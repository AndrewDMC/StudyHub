'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DriftReportDto, TaskDto } from '@studyhub/contracts';

async function fetchToday(slug: string): Promise<TaskDto[]> {
  const res = await fetch(`/api/subjects/${slug}/plan/today`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare le task di oggi');
  return body.tasks as TaskDto[];
}

async function fetchDrift(slug: string): Promise<DriftReportDto | null> {
  const res = await fetch(`/api/subjects/${slug}/plan/drift`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile verificare lo scostamento');
  return body.drift as DriftReportDto | null;
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "Debito" — rimanda: sposta la task scaduta a oggi (docs/fasi/F6-planner-calendario.md "Decisioni"). */
async function postpone(slug: string, taskId: string) {
  const res = await fetch(`/api/subjects/${slug}/plan/tasks/${taskId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: todayIso() }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Rinvio fallito');
  }
}

/** "Debito" — riassorbi nel piano: il primo giorno libero lo sceglie l'algoritmo, non l'utente. */
async function reabsorb(slug: string, taskId: string) {
  const res = await fetch(`/api/subjects/${slug}/plan/tasks/${taskId}/reabsorb`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Riassorbimento fallito');
  }
}

/**
 * "Oggi" (docs/fasi/F7-dashboard-polish.md): the committed plan's actionable
 * tasks for today, one click away from Dashboard/Materia. Overdue tasks are
 * split out as "Debito" (docs/fasi/F6-planner-calendario.md "Decisioni") with
 * their own triage — rimanda (oggi) / riassorbi nel piano / archivia — instead
 * of accumulating silently in the flat list.
 */
export function DailyTasksPanel({ subjectSlug }: { subjectSlug: string }) {
  const queryClient = useQueryClient();
  const today = todayIso();
  const query = useQuery({
    queryKey: ['daily-tasks', subjectSlug],
    queryFn: () => fetchToday(subjectSlug),
  });
  const driftQuery = useQuery({
    queryKey: ['plan-drift', subjectSlug],
    queryFn: () => fetchDrift(subjectSlug),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['daily-tasks', subjectSlug] });
  const mutate = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: 'done' | 'skipped' }) =>
      setStatus(subjectSlug, taskId, status),
    onSuccess: invalidate,
  });
  const postponeMutation = useMutation({
    mutationFn: (taskId: string) => postpone(subjectSlug, taskId),
    onSuccess: invalidate,
  });
  const reabsorbMutation = useMutation({
    mutationFn: (taskId: string) => reabsorb(subjectSlug, taskId),
    onSuccess: invalidate,
  });

  const debtTasks = query.data?.filter((t) => t.date < today) ?? [];
  const todayTasks = query.data?.filter((t) => t.date >= today) ?? [];

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

      {driftQuery.data?.shouldRecalculate && (
        <div className="mx-1 mb-2 rounded-[var(--radius-control)] border border-warn/40 bg-bg-inset px-2.5 py-1.5 text-xs text-warn">
          Il piano è indietro ({driftQuery.data.reason}).{' '}
          <Link
            href={`/materie/${subjectSlug}/piano`}
            className="underline underline-offset-2 hover:text-warn"
          >
            Rigenera il piano
          </Link>
          .
        </div>
      )}

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

      {debtTasks.length > 0 && (
        <div className="mt-1 px-1">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-warn">
            Debito — {debtTasks.length} task scadute
          </p>
          <ul className="space-y-1.5">
            {debtTasks.map((task) => (
              <li
                key={task.id}
                className="rounded-[var(--radius-control)] border border-warn/40 px-2.5 py-1.5"
              >
                <p className="text-[11px] uppercase tracking-wide text-fg-muted">
                  {task.date} · {task.minutes} min
                </p>
                <p className="text-sm text-fg-primary">{task.title}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => postponeMutation.mutate(task.id)}
                    disabled={postponeMutation.isPending}
                    className="rounded-[var(--radius-control)] border border-border px-2 py-0.5 text-[11px] text-fg-secondary hover:text-fg-primary"
                  >
                    Rimanda a oggi
                  </button>
                  <button
                    type="button"
                    onClick={() => reabsorbMutation.mutate(task.id)}
                    disabled={reabsorbMutation.isPending}
                    className="rounded-[var(--radius-control)] border border-border px-2 py-0.5 text-[11px] text-fg-secondary hover:text-fg-primary"
                  >
                    Riassorbi nel piano
                  </button>
                  <button
                    type="button"
                    onClick={() => mutate.mutate({ taskId: task.id, status: 'skipped' })}
                    disabled={mutate.isPending}
                    className="rounded-[var(--radius-control)] border border-border px-2 py-0.5 text-[11px] text-fg-muted"
                  >
                    Archivia
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {(postponeMutation.isError || reabsorbMutation.isError) && (
            <p role="alert" className="mt-1.5 text-[11px] text-danger">
              {((postponeMutation.error ?? reabsorbMutation.error) as Error).message}
            </p>
          )}
        </div>
      )}

      {todayTasks.length > 0 && (
        <ul className="mt-1 space-y-1.5">
          {todayTasks.map((task) => (
            <li
              key={task.id}
              className="rounded-[var(--radius-control)] border border-border px-2.5 py-1.5"
            >
              <p className="text-[11px] uppercase tracking-wide text-fg-muted">
                {task.date} · {task.minutes} min
              </p>
              <p className="text-sm text-fg-primary">{task.title}</p>
              <div className="mt-1 flex gap-1.5 max-md:[&>button]:min-h-11 max-md:[&>button]:px-3">
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
