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

async function postRetryJob(jobId: string): Promise<{ jobId: string }> {
  const res = await fetch(`/api/admin/jobs/${jobId}/retry`, { method: 'POST' });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Rilancio job fallito');
  return body as { jobId: string };
}

interface ClaudeAuthSnapshot {
  auth: {
    cliAvailable: boolean;
    loggedIn: boolean;
    email?: string;
    subscriptionType?: string;
  };
  login: { status: 'idle' | 'running' | 'succeeded' | 'failed'; url?: string; error?: string };
  preferred: 'claude-cli' | 'auto';
  activeProvider: string;
  lockedByEnv: boolean;
}

type ClaudeAuthAction =
  | { action: 'login' | 'cancel-login' | 'logout' | 'use' | 'stop-using' }
  | { action: 'submit-code'; code: string };

async function fetchClaudeAuth(): Promise<ClaudeAuthSnapshot> {
  const res = await fetch('/api/settings/claude-auth');
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? "Impossibile leggere lo stato dell'account");
  return body as ClaudeAuthSnapshot;
}

async function postClaudeAuth(payload: ClaudeAuthAction): Promise<ClaudeAuthSnapshot> {
  const res = await fetch('/api/settings/claude-auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Operazione non riuscita');
  return body as ClaudeAuthSnapshot;
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

/** Sign in with a Claude subscription via the `claude` CLI and route generation through it (no API key, no per-token billing). */
function ClaudeAccountCard() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['claude-auth'],
    queryFn: fetchClaudeAuth,
    // Poll while the browser sign-in is in flight so the card flips to "connesso" on its own.
    refetchInterval: (q) => (q.state.data?.login.status === 'running' ? 2000 : false),
  });
  const mutation = useMutation({
    mutationFn: postClaudeAuth,
    onSuccess: (data) => {
      queryClient.setQueryData(['claude-auth'], data);
      queryClient.invalidateQueries({ queryKey: ['ai-provider'] });
    },
  });

  const [code, setCode] = useState('');
  const data = query.data;
  const running = data?.login.status === 'running';
  const usingCli = data?.activeProvider === 'claude-cli';
  const btn =
    'rounded-[var(--radius-control)] border border-border px-2 py-1 text-xs text-fg-secondary hover:text-fg-primary disabled:opacity-50';

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-muted">
        Account Claude
      </h2>

      {query.isLoading && <p className="text-sm text-fg-muted">Caricamento…</p>}
      {(query.isError || mutation.isError) && (
        <p role="alert" className="mb-2 text-xs text-danger">
          {((query.error ?? mutation.error) as Error).message}
        </p>
      )}

      {data && !data.auth.cliAvailable && (
        <p className="text-sm text-fg-muted">
          La CLI <code>claude</code> non è installata su questa macchina (o il web gira in un
          container senza CLI): installa Claude Code ed esegui il login da lì, poi imposta{' '}
          <code>AI_PROVIDER=claude-cli</code>.
        </p>
      )}

      {data && data.auth.cliAvailable && (
        <div className="space-y-3 text-xs text-fg-secondary">
          {data.auth.loggedIn ? (
            <p>
              Connesso come{' '}
              <span className="text-fg-primary">{data.auth.email ?? 'account Claude'}</span>
              {data.auth.subscriptionType ? ` · piano ${data.auth.subscriptionType}` : ''}
            </p>
          ) : (
            <p>Nessun account Claude collegato.</p>
          )}

          {running && (
            <div className="rounded-[var(--radius-control)] border border-border bg-bg-inset p-2">
              {data.login.url ? (
                <>
                  <p>
                    1.{' '}
                    <a
                      href={data.login.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent underline"
                    >
                      Apri la pagina di accesso di Claude
                    </a>{' '}
                    e accedi con il tuo account.
                  </p>
                  <p className="mt-1">2. Copia il codice mostrato al termine e incollalo qui:</p>
                  <form
                    className="mt-1 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (code.trim()) mutation.mutate({ action: 'submit-code', code });
                    }}
                  >
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      aria-label="Codice di accesso"
                      autoComplete="off"
                      spellCheck={false}
                      className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-bg-surface px-2 py-1 font-mono text-xs text-fg-primary outline-none focus:border-accent"
                    />
                    <button
                      type="submit"
                      disabled={mutation.isPending || !code.trim()}
                      className={btn}
                    >
                      Conferma
                    </button>
                  </form>
                </>
              ) : (
                <p>Preparo il link di accesso…</p>
              )}
            </div>
          )}
          {data.login.status === 'failed' && data.login.error && (
            <p role="alert" className="text-danger">
              {data.login.error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {!data.auth.loggedIn && !running && (
              <button
                type="button"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ action: 'login' })}
                className={btn}
              >
                Accedi con Claude
              </button>
            )}
            {running && (
              <button
                type="button"
                onClick={() => mutation.mutate({ action: 'cancel-login' })}
                className={btn}
              >
                Annulla
              </button>
            )}
            {data.auth.loggedIn && !data.lockedByEnv && (
              <button
                type="button"
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate({
                    action: data.preferred === 'claude-cli' ? 'stop-using' : 'use',
                  })
                }
                className={btn}
              >
                {data.preferred === 'claude-cli'
                  ? "Smetti di usare l'abbonamento"
                  : "Usa questo abbonamento per l'AI"}
              </button>
            )}
            {data.auth.loggedIn && (
              <button
                type="button"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ action: 'logout' })}
                className={btn}
              >
                Esci
              </button>
            )}
          </div>

          <p className="text-[11px] text-fg-muted">
            Provider AI attivo: <span className="font-mono">{data.activeProvider}</span>
            {data.lockedByEnv && " (fissato da AI_PROVIDER nell'ambiente)"}
            {usingCli ? ' · le generazioni usano il tuo abbonamento, senza costo a token.' : ''}
          </p>
        </div>
      )}
    </section>
  );
}

/** One model for every AI function that does not name its own; "Automatico" leaves each function on its default (Haiku to extract, Sonnet to generate, Opus to reason). */
function AiModelCard() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['ai-model'],
    queryFn: async () => {
      const res = await fetch('/api/settings/ai-model');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile leggere il modello');
      return body as { model: string | null; options: { id: string; label: string }[] };
    },
  });
  const mutation = useMutation({
    mutationFn: async (model: string | null) => {
      const res = await fetch('/api/settings/ai-model', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? 'Operazione non riuscita');
      return body as { model: string | null; options: { id: string; label: string }[] };
    },
    onSuccess: (data) => queryClient.setQueryData(['ai-model'], data),
  });
  const data = query.data;

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-muted">Modello AI</h2>
      {query.isLoading && <p className="text-sm text-fg-muted">Caricamento…</p>}
      {(query.isError || mutation.isError) && (
        <p role="alert" className="mb-2 text-xs text-danger">
          {((query.error ?? mutation.error) as Error).message}
        </p>
      )}
      {data && (
        <div className="space-y-2 text-xs text-fg-secondary">
          <label className="flex flex-col gap-1">
            Modello usato dalle funzioni AI
            <select
              value={data.model ?? ''}
              disabled={mutation.isPending}
              onChange={(e) => mutation.mutate(e.target.value || null)}
              className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-sm text-fg-primary"
            >
              <option value="">Automatico — il migliore per ogni funzione</option>
              {data.options.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] text-fg-muted">
            {data.model
              ? 'Vale per tutte le funzioni che non indicano un modello proprio: piano, simulazioni, flashcard, riassunti, sessione di studio. Un modello più capace costa e impiega di più.'
              : 'Ogni funzione usa il suo modello: Haiku per estrarre, Sonnet per generare e correggere, Opus per piano e simulazioni.'}
          </p>
        </div>
      )}
    </section>
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
        <p className="mb-2 text-[11px] text-ok">
          Job avviato — questo pannello si aggiorna a breve.
        </p>
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
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['admin-jobs', status, offset],
    queryFn: () => fetchJobs(status, offset),
  });

  const retryMutation = useMutation({
    mutationFn: postRetryJob,
    onSuccess: () => {
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['admin-jobs'] }), 3000);
    },
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
                  {job.status === 'failed' && (
                    <button
                      type="button"
                      disabled={retryMutation.isPending && retryMutation.variables === job.id}
                      onClick={() => retryMutation.mutate(job.id)}
                      className="rounded-[var(--radius-control)] border border-border px-1.5 py-0.5 text-[11px] text-fg-secondary hover:text-fg-primary disabled:opacity-50"
                    >
                      Rilancia
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {retryMutation.isError && (
            <p role="alert" className="mt-2 text-[11px] text-danger">
              {(retryMutation.error as Error).message}
            </p>
          )}
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
    <div className="mx-auto max-w-[960px] space-y-4 p-4 md:p-6">
      <h1 className="text-xl font-semibold tracking-[-0.02em]">Admin</h1>

      <ClaudeAccountCard />
      <AiModelCard />

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
