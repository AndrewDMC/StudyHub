'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BulkPlanActionRequest,
  ExamDto,
  Intensity,
  PlanDiffDto,
  PlanDto,
  PlanPreviewDto,
  TaskDto,
} from '@studyhub/contracts';

async function getJson<T>(url: string, key: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Caricamento fallito');
  return body[key] as T;
}

async function send(url: string, method: string, payload?: unknown) {
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// perWeekday index 0 = Sunday … 6 = Saturday (packages/core/src/planner/dates.ts convention).
const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

const KIND_LABELS: Record<TaskDto['kind'], string> = {
  read: 'Lettura',
  flashcards: 'Flashcard',
  schema: 'Schema',
  simulation: 'Simulazione',
  drill: 'Drill',
  rest: 'Riposo',
  review: 'Ripasso',
};

function WizardForm({
  slug,
  exams,
  onGenerated,
}: {
  slug: string;
  exams: ExamDto[];
  onGenerated: () => void;
}) {
  const [startDate, setStartDate] = useState(todayIso());
  const [targetDate, setTargetDate] = useState('');
  const [examId, setExamId] = useState('');
  const [perWeekday, setPerWeekday] = useState<number[]>([0, 90, 90, 90, 90, 90, 60]);
  const [sessionLength, setSessionLength] = useState(50);
  const [intensity, setIntensity] = useState<Intensity>('standard');
  const [simulationCount, setSimulationCount] = useState('auto');
  const [blackoutText, setBlackoutText] = useState('');

  // Comma/space separated YYYY-MM-DD; anything else is flagged, not silently dropped.
  const blackoutTokens = blackoutText.split(/[\s,;]+/).filter(Boolean);
  const isIso = (t: string) => /^\d{4}-\d{2}-\d{2}$/.test(t);
  const blackoutDates = blackoutTokens.filter(isIso);
  const blackoutInvalid = blackoutTokens.filter((t) => !isIso(t));

  const requestBody = {
    startDate,
    targetDate,
    examId: examId || undefined,
    availability: { perWeekday, blackoutDates },
    prefs: {
      sessionLength,
      intensity,
      simulationCount: simulationCount === 'auto' ? 'auto' : Number(simulationCount),
      simulationMinutes: 90,
      reviewMinutesPerCard: 0.5,
    },
    force: false,
  };

  const generate = useMutation({
    mutationFn: () => send(`/api/subjects/${slug}/plan`, 'POST', requestBody),
    onSuccess: onGenerated,
  });

  // Free pre-flight (no AI call): re-run shortly after the form settles.
  const previewKey = JSON.stringify(requestBody);
  const [settledKey, setSettledKey] = useState(previewKey);
  useEffect(() => {
    const t = setTimeout(() => setSettledKey(previewKey), 500);
    return () => clearTimeout(t);
  }, [previewKey]);
  const previewReady = !!targetDate && targetDate > startDate && blackoutInvalid.length === 0;
  const previewQuery = useQuery({
    queryKey: ['plan-preview', slug, settledKey],
    queryFn: async () => {
      const body = await send(`/api/subjects/${slug}/plan/preview`, 'POST', JSON.parse(settledKey));
      return body.preview as PlanPreviewDto;
    },
    enabled: previewReady,
    retry: false,
  });

  const setDay = (i: number, minutes: number) =>
    setPerWeekday((prev) => prev.map((v, idx) => (idx === i ? minutes : v)));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        generate.mutate();
      }}
      className="space-y-4 rounded-[var(--radius-card)] border border-border bg-bg-surface p-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          Inizio studio
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
            className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-sm text-fg-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          Data esame
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            required
            className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-sm text-fg-primary"
          />
        </label>
      </div>

      {exams.length > 0 && (
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          Esame collegato (opzionale)
          <select
            value={examId}
            onChange={(e) => {
              setExamId(e.target.value);
              const exam = exams.find((x) => x.id === e.target.value);
              if (exam) setTargetDate(exam.date.slice(0, 10));
            }}
            className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-sm text-fg-primary"
          >
            <option value="">Nessuno</option>
            {exams.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title} — {x.date.slice(0, 10)}
              </option>
            ))}
          </select>
        </label>
      )}

      <div>
        <p className="mb-1 text-xs text-fg-secondary">Minuti disponibili per giorno</p>
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAY_LABELS.map((label, i) => (
            <label
              key={label}
              className="flex flex-col items-center gap-1 text-[11px] text-fg-muted"
            >
              {label}
              <input
                type="number"
                min={0}
                max={1440}
                step={15}
                value={perWeekday[i]}
                onChange={(e) => setDay(i, Number(e.target.value))}
                className="w-full rounded-[var(--radius-control)] border border-border bg-bg-inset px-1 py-1 text-center font-mono text-xs text-fg-primary"
              />
            </label>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-xs text-fg-secondary">
        Giorni non disponibili (YYYY-MM-DD, separati da virgola)
        <input
          value={blackoutText}
          onChange={(e) => setBlackoutText(e.target.value)}
          placeholder="2026-04-25, 2026-05-01"
          aria-invalid={blackoutInvalid.length > 0}
          className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-sm text-fg-primary"
        />
        {blackoutInvalid.length > 0 && (
          <span className="text-danger">Data non valida: {blackoutInvalid.join(', ')}</span>
        )}
      </label>

      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          Sessione (min)
          <input
            type="number"
            min={10}
            max={180}
            value={sessionLength}
            onChange={(e) => setSessionLength(Number(e.target.value))}
            className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-sm text-fg-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          Intensità
          <select
            value={intensity}
            onChange={(e) => setIntensity(e.target.value as Intensity)}
            className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-sm text-fg-primary"
          >
            <option value="sostenibile">Sostenibile</option>
            <option value="standard">Standard</option>
            <option value="sprint">Sprint</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          Simulazioni
          <input
            value={simulationCount}
            onChange={(e) => setSimulationCount(e.target.value)}
            placeholder="auto"
            className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-sm text-fg-primary"
          />
        </label>
      </div>

      {previewReady && previewQuery.data && <PreviewPanel preview={previewQuery.data} />}
      {previewReady && previewQuery.isError && (
        <p role="alert" className="text-xs text-danger">
          Anteprima non disponibile: {(previewQuery.error as Error).message}
        </p>
      )}

      <button
        type="submit"
        disabled={generate.isPending}
        className="rounded-[var(--radius-control)] bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {generate.isPending ? 'Generazione…' : 'Genera piano'}
      </button>
      {generate.isSuccess && (
        <p className="text-xs text-ok">Piano in generazione — la bozza appare a breve.</p>
      )}
      {generate.isError && (
        <p role="alert" className="text-xs text-danger">
          {(generate.error as Error).message}
        </p>
      )}
    </form>
  );
}

/** What the wizard tells you before it spends the AI call: is there enough time, week by week. */
function PreviewPanel({ preview }: { preview: PlanPreviewDto }) {
  const { feasibility } = preview;
  const peak = Math.max(1, ...preview.loadPerWeek.map((w) => Math.max(w.available, w.planned)));
  return (
    <div
      data-testid="plan-preview"
      className={`space-y-2 rounded-[var(--radius-card)] border p-3 text-xs ${feasibility.feasible ? 'border-ok' : 'border-warn'}`}
    >
      <p className={`font-medium ${feasibility.feasible ? 'text-ok' : 'text-warn'}`}>
        {feasibility.feasible
          ? 'Tempo sufficiente'
          : `Tempo insufficiente: mancano ~${feasibility.shortfallMinutes} min su ${feasibility.requiredMinutes} richiesti`}
      </p>
      <p className="text-fg-muted">
        {preview.topicCount} argomenti · ~{preview.taskCount} task · stima dalle pagine (non ancora
        dall&apos;AI)
        {preview.busyMinutes > 0 && ` · ${preview.busyMinutes} min già occupati da altri impegni`}
      </p>
      <ul className="space-y-1">
        {preview.loadPerWeek.map((w) => (
          <li key={w.weekStart} className="flex items-center gap-2">
            <span className="w-20 shrink-0 font-mono tabular-nums text-fg-muted">
              {w.weekStart}
            </span>
            <span className="relative h-2 flex-1 rounded-full bg-bg-inset">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-border"
                style={{ width: `${(w.available / peak) * 100}%` }}
              />
              <span
                className={`absolute inset-y-0 left-0 rounded-full ${w.planned > w.available ? 'bg-danger' : 'bg-accent'}`}
                style={{ width: `${(Math.min(w.planned, w.available) / peak) * 100}%` }}
              />
            </span>
            <span className="w-24 shrink-0 text-right font-mono tabular-nums text-fg-secondary">
              {w.planned}/{w.available} min
            </span>
          </li>
        ))}
      </ul>
      {!feasibility.feasible && (
        <ul className="space-y-1 text-fg-secondary">
          {feasibility.strategies.map((st) => (
            <li key={st.id}>
              <span className="font-medium text-fg-primary">{st.label}:</span> {st.description}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Bulk edits on the draft (docs/fasi/F6 "Azioni bulk"); a refused action shows why and changes nothing. */
function BulkBar({ slug, plan, onDone }: { slug: string; plan: PlanDto; onDone: () => void }) {
  const [days, setDays] = useState(2);
  const [percent, setPercent] = useState(20);
  const [topicKey, setTopicKey] = useState('');

  const topicOptions = [
    ...new Map(
      plan.tasks
        .filter((t) => t.topicKey)
        .filter((t) => t.kind === 'read') // "Studia <argomento> — pp. …" carries the topic's name
        .map((t) => [t.topicKey!, t.title.replace(/^Studia /, '').split(' — ')[0]!] as const),
    ),
  ];
  const run = useMutation({
    mutationFn: (action: BulkPlanActionRequest) =>
      send(`/api/subjects/${slug}/plan/bulk`, 'POST', action),
    onSuccess: onDone,
  });
  const btn =
    'rounded-[var(--radius-control)] border border-border px-2 py-1 text-[11px] text-fg-secondary hover:text-fg-primary disabled:opacity-50';
  const num =
    'w-14 rounded-[var(--radius-control)] border border-border bg-bg-inset px-1 py-1 text-center font-mono text-xs text-fg-primary';

  return (
    <div className="space-y-2 rounded-[var(--radius-card)] border border-border bg-bg-surface p-3 text-xs">
      <p className="font-medium text-fg-secondary">
        Azioni in blocco (le task fissate non si muovono)
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-fg-muted">Sposta di</span>
        <input
          type="number"
          aria-label="Giorni di spostamento"
          value={days}
          min={-30}
          max={30}
          onChange={(e) => setDays(Number(e.target.value))}
          className={num}
        />
        <span className="text-fg-muted">giorni</span>
        <button
          type="button"
          className={btn}
          disabled={run.isPending}
          onClick={() => run.mutate({ type: 'shift', days })}
        >
          Sposta tutto
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-fg-muted">Riduci il carico del</span>
        <input
          type="number"
          aria-label="Percentuale di riduzione"
          value={percent}
          min={1}
          max={90}
          onChange={(e) => setPercent(Number(e.target.value))}
          className={num}
        />
        <span className="text-fg-muted">%</span>
        <button
          type="button"
          className={btn}
          disabled={run.isPending}
          onClick={() => run.mutate({ type: 'reduce_load', percent })}
        >
          Riduci
        </button>
      </div>
      {topicOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Argomento da escludere"
            value={topicKey}
            onChange={(e) => setTopicKey(e.target.value)}
            className="min-w-0 max-w-[16rem] rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-xs text-fg-primary"
          >
            <option value="">Escludi argomento…</option>
            {topicOptions.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={btn}
            disabled={!topicKey || run.isPending}
            onClick={() => run.mutate({ type: 'exclude_topic', topicKey })}
          >
            Escludi
          </button>
        </div>
      )}
      {run.isError && (
        <p role="alert" className="text-danger">
          {(run.error as Error).message}
        </p>
      )}
    </div>
  );
}

function FeasibilityBanner({ plan }: { plan: PlanDto }) {
  if (plan.feasibility.feasible) return null;
  return (
    <div className="rounded-[var(--radius-card)] border border-warn bg-bg-surface p-3 text-sm">
      <p className="font-medium text-warn">
        Tempo insufficiente: mancano ~{plan.feasibility.shortfallMinutes} min su{' '}
        {plan.feasibility.requiredMinutes} richiesti.
      </p>
      <ul className="mt-2 space-y-1 text-xs text-fg-secondary">
        {plan.feasibility.strategies.map((s) => (
          <li key={s.id}>
            <span className="font-medium text-fg-primary">{s.label}:</span> {s.description}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TaskRow({
  task,
  isDraft,
  onPin,
  onDelete,
  onStatus,
}: {
  task: TaskDto;
  isDraft: boolean;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
  onStatus: (id: string, status: 'done' | 'skipped') => void;
}) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-bg-surface px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-fg-muted">
          {KIND_LABELS[task.kind]} · {task.minutes} min{task.pinned ? ' · fissata' : ''}
        </p>
        <p className="truncate text-sm font-medium text-fg-primary">{task.title}</p>
        {task.description && (
          <p className="truncate text-xs text-fg-secondary">{task.description}</p>
        )}
      </div>
      <div className="flex shrink-0 gap-1.5">
        {isDraft ? (
          <>
            <button
              type="button"
              onClick={() => onPin(task.id, !task.pinned)}
              className="rounded-[var(--radius-control)] border border-border px-2 py-1 text-[11px] text-fg-secondary hover:text-fg-primary"
            >
              {task.pinned ? 'Sblocca' : 'Fissa'}
            </button>
            <button
              type="button"
              onClick={() => onDelete(task.id)}
              className="rounded-[var(--radius-control)] border border-danger px-2 py-1 text-[11px] text-danger"
            >
              Elimina
            </button>
          </>
        ) : (
          task.status !== 'done' &&
          task.status !== 'skipped' && (
            <>
              <button
                type="button"
                onClick={() => onStatus(task.id, 'done')}
                className="rounded-[var(--radius-control)] border border-ok px-2 py-1 text-[11px] text-ok"
              >
                Fatta
              </button>
              <button
                type="button"
                onClick={() => onStatus(task.id, 'skipped')}
                className="rounded-[var(--radius-control)] border border-border px-2 py-1 text-[11px] text-fg-muted"
              >
                Salta
              </button>
            </>
          )
        )}
      </div>
    </li>
  );
}

function DiffPanel({ diff }: { diff: PlanDiffDto }) {
  if (diff.rows.length === 0) return null;
  return (
    <div className="rounded-[var(--radius-card)] border border-info bg-bg-surface p-3 text-xs">
      <p className="mb-2 font-medium text-info">Ricalcolo rispetto al piano attivo</p>
      <ul className="space-y-1">
        {diff.summary.map((line, i) => (
          <li key={i} className="text-fg-secondary">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Planner wizard + review + committed-plan view in one screen (docs/04-planner.md
 * §9). This is a day-grouped list, not a calendar grid; moves go through a button, not a
 * pointer gesture (docs/fasi/F6-planner-calendario.md "Stato").
 */
export function PlanClient({ slug }: { slug: string }) {
  const queryClient = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  // Only poll while we're actively waiting on a just-submitted generate_plan
  // job — otherwise a subject with no plan yet (or a broken backend) would
  // hammer the endpoint every 2s forever (no dedicated job-status endpoint
  // exists in this codebase; see GenerationPanel/ExamPrepPanel for the same
  // fixed-delay-then-refetch convention this follows).
  const [awaitingDraft, setAwaitingDraft] = useState(false);

  const planQuery = useQuery({
    queryKey: ['plan', slug],
    queryFn: () => getJson<PlanDto | null>(`/api/subjects/${slug}/plan`, 'plan'),
    refetchInterval: awaitingDraft ? 2000 : false,
  });

  useEffect(() => {
    if (awaitingDraft && planQuery.data) setAwaitingDraft(false);
  }, [awaitingDraft, planQuery.data]);

  useEffect(() => {
    if (!awaitingDraft) return;
    const timeout = setTimeout(() => setAwaitingDraft(false), 60_000); // give up if the job never produces a draft
    return () => clearTimeout(timeout);
  }, [awaitingDraft]);
  const examsQuery = useQuery({
    queryKey: ['exams', slug],
    queryFn: () => getJson<ExamDto[]>(`/api/subjects/${slug}/exams`, 'exams'),
  });
  const diffQuery = useQuery({
    queryKey: ['plan-diff', slug],
    queryFn: () => getJson<PlanDiffDto | null>(`/api/subjects/${slug}/plan/diff`, 'diff'),
  });

  const invalidatePlan = () => {
    queryClient.invalidateQueries({ queryKey: ['plan', slug] });
    queryClient.invalidateQueries({ queryKey: ['plan-diff', slug] });
  };

  const commit = useMutation({
    mutationFn: (planId: string) => send(`/api/subjects/${slug}/plan/${planId}/commit`, 'POST', {}),
    onSuccess: invalidatePlan,
  });
  const discard = useMutation({
    mutationFn: () => send(`/api/subjects/${slug}/plan/draft`, 'DELETE'),
    onSuccess: invalidatePlan,
  });
  const pin = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      send(`/api/subjects/${slug}/plan/tasks/${id}`, 'PATCH', { pinned }),
    onSuccess: invalidatePlan,
  });
  const removeTask = useMutation({
    mutationFn: (id: string) => send(`/api/subjects/${slug}/plan/tasks/${id}`, 'DELETE'),
    onSuccess: invalidatePlan,
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'done' | 'skipped' }) =>
      send(`/api/subjects/${slug}/plan/tasks/${id}/status`, 'POST', { status }),
    onSuccess: invalidatePlan,
  });

  const plan = planQuery.data;
  const byDay = new Map<string, TaskDto[]>();
  for (const t of plan?.tasks ?? []) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t]);
  const days = [...byDay.keys()].sort();
  const loadByDate = new Map((plan?.loadPerDay ?? []).map((d) => [d.date, d]));

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <Link
            href={`/materie/${slug}`}
            className="text-xs text-fg-secondary underline-offset-2 hover:underline"
          >
            ← {slug}
          </Link>
          <h1 className="text-xl font-semibold tracking-[-0.02em]">Piano di studio</h1>
        </div>
        {plan && (
          <button
            type="button"
            onClick={() => setWizardOpen((v) => !v)}
            className="rounded-[var(--radius-control)] border border-border px-2.5 py-1 text-xs text-fg-secondary hover:text-fg-primary"
          >
            {wizardOpen ? 'Annulla' : plan.status === 'draft' ? 'Rigenera bozza' : 'Nuovo piano'}
          </button>
        )}
      </div>

      {planQuery.isLoading && <p className="text-sm text-fg-muted">Caricamento…</p>}
      {planQuery.isError && (
        <p role="alert" className="text-sm text-danger">
          {(planQuery.error as Error).message}
        </p>
      )}

      {(!plan || wizardOpen) && (
        <div className="mb-6">
          <WizardForm
            slug={slug}
            exams={examsQuery.data ?? []}
            onGenerated={() => {
              setWizardOpen(false);
              setAwaitingDraft(true);
              invalidatePlan();
            }}
          />
        </div>
      )}

      {plan && !wizardOpen && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`rounded-full border px-2 py-0.5 ${plan.status === 'draft' ? 'border-warn text-warn' : 'border-ok text-ok'}`}
            >
              {plan.status === 'draft' ? 'Bozza — non ancora nel calendario' : 'Attivo'}
            </span>
            <span className="text-fg-muted">
              {plan.startDate} → {plan.targetDate} · {plan.tasks.length} task
            </span>
          </div>

          <FeasibilityBanner plan={plan} />
          {diffQuery.data && <DiffPanel diff={diffQuery.data} />}

          {plan.status === 'draft' && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => commit.mutate(plan.id)}
                disabled={commit.isPending}
                className="rounded-[var(--radius-control)] bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                Conferma piano
              </button>
              <button
                type="button"
                onClick={() => discard.mutate()}
                disabled={discard.isPending}
                className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm text-fg-secondary hover:text-fg-primary"
              >
                Scarta bozza
              </button>
            </div>
          )}
          {plan.status === 'draft' && <BulkBar slug={slug} plan={plan} onDone={invalidatePlan} />}
          {commit.isError && (
            <p role="alert" className="text-xs text-danger">
              {(commit.error as Error).message}
            </p>
          )}

          {days.length === 0 && (
            <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-8 text-center text-sm text-fg-muted">
              Nessuna task pianificata — carica materiale nella materia, poi rigenera il piano.
            </div>
          )}

          <div className="space-y-3">
            {days.map((date) => {
              const load = loadByDate.get(date);
              return (
                <div key={date}>
                  <p className="mb-1.5 font-mono text-xs tabular-nums text-fg-muted">
                    {date}
                    {load ? ` · ${load.planned}/${load.available} min` : ''}
                  </p>
                  <ul className="space-y-1.5">
                    {byDay.get(date)!.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        isDraft={plan.status === 'draft'}
                        onPin={(id, pinned) => pin.mutate({ id, pinned })}
                        onDelete={(id) => removeTask.mutate(id)}
                        onStatus={(id, status) => setStatus.mutate({ id, status })}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
