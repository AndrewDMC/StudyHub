'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminJobsResponse, AdminOverviewDto } from '@studyhub/contracts';

const JOB_STATUS_LABELS: Record<string, string> = {
  queued: 'In coda',
  running: 'In corso',
  succeeded: 'Completato',
  failed: 'Fallito',
  cancelled: 'Annullato',
};

const STATUS_FILTERS = ['tutti', 'queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const PAGE_SIZE = 20;

async function fetchOverview(): Promise<AdminOverviewDto> {
  const res = await fetch('/api/admin/overview');
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare la panoramica');
  return body as AdminOverviewDto;
}

async function fetchJobs(status: StatusFilter, offset: number): Promise<AdminJobsResponse> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (status !== 'tutti') params.set('status', status);
  const res = await fetch(`/api/admin/jobs?${params}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare i job');
  return body as AdminJobsResponse;
}

async function postReconcile(): Promise<{ jobId: string }> {
  const res = await fetch('/api/admin/reconcile', { method: 'POST' });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Avvio reconcile fallito');
  return body as { jobId: string };
}

function formatCost(costEur: number): string {
  return costEur === 0 ? 'gratis' : `€${costEur.toFixed(4)}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
}

function StatusBadge({ status }: { status: string }) {
  const colorClass =
    status === 'failed'
      ? 'border-danger text-danger'
      : status === 'succeeded'
        ? 'border-ok text-ok'
        : 'border-border text-fg-muted';
  return (
    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] ${colorClass}`}>
      {JOB_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function FsSyncCard({ overview }: { overview: AdminOverviewDto }) {
  const queryClient = useQueryClient();
  const reconcileMutation = useMutation({
    mutationFn: postReconcile,
    onSuccess: () => {
      // Runs asynchronously in the worker; give it a moment then refresh both panels.
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
        queryClient.invalidateQueries({ queryKey: ['admin-jobs'] });
      }, 3000);
    },
  });

  const { fsSync } = overview;

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">
          Stato sync filesystem
        </h2>
        <button
          type="button"
          disabled={reconcileMutation.isPending}
          onClick={() => reconcileMutation.mutate()}
          className="rounded-[var(--radius-control)] border border-border px-2 py-1 text-xs text-fg-secondary hover:text-fg-primary disabled:opacity-50"
        >
          Reset indice (reconcile)
        </button>
      </div>

      {reconcileMutation.isError && (
        <p role="alert" className="mb-2 text-xs text-danger">
          {(reconcileMutation.error as Error).message}
        </p>
      )}
      {reconcileMutation.isSuccess && (
        <p className="mb-2 text-[11px] text-ok">Job avviato — questo pannello si aggiorna a breve.</p>
      )}

      {!fsSync.lastRunAt ? (
        <p className="text-sm text-fg-muted">Nessun reconcile eseguito ancora.</p>
      ) : (
        <div className="space-y-1 text-xs text-fg-secondary">
          <div className="flex items-center gap-2">
            <span>{formatDateTime(fsSync.lastRunAt)}</span>
            {fsSync.status && <StatusBadge status={fsSync.status} />}
          </div>
          <p>
            {fsSync.imported.length} importate · {fsSync.alreadyIndexed.length} già indicizzate ·{' '}
            {fsSync.skippedInvalid.length} scartate
          </p>
          {fsSync.skippedInvalid.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-danger">
              {fsSync.skippedInvalid.map((s) => (
                <li key={s.slug}>
                  {s.slug}: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function CostsByMonthCard({ overview }: { overview: AdminOverviewDto }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-muted">
        Costi per mese
      </h2>
      {overview.costsByMonth.length === 0 ? (
        <p className="text-sm text-fg-muted">Nessun job con costo registrato ancora.</p>
      ) : (
        <ul className="space-y-1.5">
          {overview.costsByMonth.map((m) => (
            <li key={m.month} className="flex items-center justify-between text-xs">
              <span className="text-fg-secondary">{m.month}</span>
              <span className="font-mono text-fg-primary">
                {formatCost(m.costEur)} · {m.jobCount} job
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function JobsTable() {
  const [status, setStatus] = useState<StatusFilter>('tutti');
  const [offset, setOffset] = useState(0);

  const query = useQuery({
    queryKey: ['admin-jobs', status, offset],
    queryFn: () => fetchJobs(status, offset),
  });

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">Job</h2>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as StatusFilter);
            setOffset(0);
          }}
          aria-label="Filtra per stato"
          className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-xs text-fg-primary outline-none focus:border-accent"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === 'tutti' ? 'Tutti gli stati' : (JOB_STATUS_LABELS[s] ?? s)}
            </option>
          ))}
        </select>
      </div>

      {query.isLoading && <p className="text-sm text-fg-muted">Caricamento…</p>}
      {query.isError && (
        <p role="alert" className="text-sm text-danger">
          {(query.error as Error).message}
        </p>
      )}
      {query.isSuccess && query.data.jobs.length === 0 && (
        <p className="text-sm text-fg-muted">Nessun job.</p>
      )}
      {query.isSuccess && query.data.jobs.length > 0 && (
        <>
          <ul className="space-y-1.5">
            {query.data.jobs.map((job) => (
              <li key={job.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-fg-secondary">
                  {job.type}
                  {job.subjectName ? ` · ${job.subjectName}` : ''}
                  {' · '}
                  <span className="text-fg-muted">{formatDateTime(job.createdAt)}</span>
                  {job.errorMessage ? ` — ${job.errorMessage}` : ''}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {job.costEur !== null && (
                    <span className="font-mono text-fg-muted">{formatCost(job.costEur)}</span>
                  )}
                  <StatusBadge status={job.status} />
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between text-[11px] text-fg-muted">
            <span>
              {offset + 1}–{offset + query.data.jobs.length} di {query.data.total}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                className="rounded-[var(--radius-control)] border border-border px-2 py-1 disabled:opacity-40"
              >
                Precedenti
              </button>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= query.data.total}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                className="rounded-[var(--radius-control)] border border-border px-2 py-1 disabled:opacity-40"
              >
                Successivi
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * `/admin` (docs/fasi/F7-dashboard-polish.md scope: "job, costi per mese, stato sync FS, log,
 * reset indice"). "Log" here is the per-job error message already on each row — non c'è uno
 * store di log persistito oltre a `jobs.error` (vedi docs/fasi/F7-dashboard-polish.md "Stato").
 */
export function AdminClient() {
  const overviewQuery = useQuery({ queryKey: ['admin-overview'], queryFn: fetchOverview });

  return (
    <div className="mx-auto max-w-[960px] space-y-4 p-6">
      <h1 className="text-xl font-semibold tracking-[-0.02em]">Admin</h1>

      {overviewQuery.isLoading && <p className="text-sm text-fg-muted">Caricamento…</p>}
      {overviewQuery.isError && (
        <p role="alert" className="text-sm text-danger">
          {(overviewQuery.error as Error).message}
        </p>
      )}
      {overviewQuery.isSuccess && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FsSyncCard overview={overviewQuery.data} />
          <CostsByMonthCard overview={overviewQuery.data} />
        </div>
      )}

      <JobsTable />
    </div>
  );
}
