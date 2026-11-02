'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BulkPlanActionRequest,
  DocumentDto,
  ExamDto,
  GeneratePlanRequest,
  Intensity,
  PlanDiffDto,
  PlanDto,
  TaskDto,
  TopicDto,
} from '@studyhub/contracts';
import { useIsMobile } from '@/lib/useIsMobile';
import type { LessonMethodChoice } from '@/lib/taskMethod';
import {
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD_BOX,
  FOCUS,
  ICON_BTN,
} from '@/components/flashcards/shared/styles';
import { FitCard } from './plan/FitCard';
import { IntensityCard } from './plan/IntensityCard';
import { PlanSchedule } from './plan/PlanSchedule';
import { PlanTopicsList } from './plan/PlanTopicsList';
import { WizardForm } from './plan/PlanWizard';
import { todayIso, topicName } from './plan/planModel';
import { PlanChangeBox } from './PlanChangeBox';
import { PlanMobile } from './plan-mobile/PlanMobile';

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

/** Bulk edits on the draft (docs/fasi/F6 "Azioni bulk"); a refused action shows why and changes nothing. */
function BulkBar({ slug, plan, onDone }: { slug: string; plan: PlanDto; onDone: () => void }) {
  const [days, setDays] = useState(2);
  const [percent, setPercent] = useState(20);
  const [topicKey, setTopicKey] = useState('');

  const topicOptions = [
    ...new Map(
      plan.tasks
        .filter((t) => t.topicKey)
        // read: "Studia <argomento> — pp. …"; lesson: "<argomento>" or "<argomento> · parte n di m"
        .filter((t) => t.kind === 'read' || t.kind === 'lesson')
        .map(
          (t) =>
            [
              t.topicKey!,
              t.kind === 'lesson'
                ? t.title.split(' · parte ')[0]!
                : t.title.replace(/^Studia /, '').split(' — ')[0]!,
            ] as const,
        ),
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
 * §9), rendered as the subject page's Piano tab: no page of its own on desktop. This is a
 * day-grouped list, not a calendar grid; moves go through a button, not a pointer gesture
 * (docs/fasi/F6-planner-calendario.md "Stato").
 */
export function PlanDesktop({ slug }: { slug: string }) {
  const queryClient = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  // Set when the wizard is opened from the intensity card: the form starts on that intensity.
  const [wizardIntensity, setWizardIntensity] = useState<Intensity | null>(null);
  // Only poll while we're actively waiting on a just-submitted generate_plan
  // job — otherwise a subject with no plan yet (or a broken backend) would
  // hammer the endpoint every 2s forever (no dedicated job-status endpoint
  // exists in this codebase; see GenerationPanel/ExamPrepPanel for the same
  // fixed-delay-then-refetch convention this follows).
  const [awaitingDraft, setAwaitingDraft] = useState(false);

  // A subject has one plan per exam or partial (plus a general one) and at most one draft under review.
  const planQuery = useQuery({
    queryKey: ['plans', slug],
    queryFn: () => getJson<PlanDto[]>(`/api/subjects/${slug}/plan/list`, 'plans'),
    refetchInterval: awaitingDraft ? 2000 : false,
  });
  const plans = planQuery.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (awaitingDraft && plans.length > 0) setAwaitingDraft(false);
  }, [awaitingDraft, plans.length]);

  useEffect(() => {
    if (!awaitingDraft) return;
    const timeout = setTimeout(() => setAwaitingDraft(false), 60_000); // give up if the job never produces a draft
    return () => clearTimeout(timeout);
  }, [awaitingDraft]);
  const examsQuery = useQuery({
    queryKey: ['exams', slug],
    queryFn: () => getJson<ExamDto[]>(`/api/subjects/${slug}/exams`, 'exams'),
  });
  const topicsQuery = useQuery({
    queryKey: ['topics', slug],
    queryFn: () => getJson<TopicDto[]>(`/api/subjects/${slug}/topics`, 'topics'),
  });
  const documentsQuery = useQuery({
    queryKey: ['documents', slug],
    queryFn: () => getJson<DocumentDto[]>(`/api/subjects/${slug}/documents`, 'documents'),
  });
  const diffQuery = useQuery({
    queryKey: ['plan-diff', slug],
    queryFn: () => getJson<PlanDiffDto | null>(`/api/subjects/${slug}/plan/diff`, 'diff'),
  });

  const invalidatePlan = () => {
    queryClient.invalidateQueries({ queryKey: ['plans', slug] });
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
  const deletePlan = useMutation({
    mutationFn: (planId: string) => send(`/api/subjects/${slug}/plan/${planId}`, 'DELETE'),
    onSuccess: () => {
      invalidatePlan();
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
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
  // Not optimistic: the server sets the minutes of the new method, the row shows what comes back.
  const setMethod = useMutation({
    mutationFn: async ({ id, method }: { id: string; method: LessonMethodChoice }) =>
      (await send(`/api/subjects/${slug}/plan/tasks/${id}`, 'PATCH', { method })).task as TaskDto,
    onSuccess: invalidatePlan,
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'done' | 'skipped' | 'todo' }) =>
      send(`/api/subjects/${slug}/plan/tasks/${id}/status`, 'POST', { status }),
    onSuccess: invalidatePlan,
  });

  // "Modifica piano" a parole: the confirmed proposal goes through the normal draft generation.
  const generateFromChange = useMutation({
    mutationFn: (request: GeneratePlanRequest) =>
      send(`/api/subjects/${slug}/plan`, 'POST', request),
    onSuccess: () => {
      setSelectedId(null);
      setAwaitingDraft(true);
      invalidatePlan();
    },
  });

  const plan = plans.find((p) => p.id === selectedId) ?? plans[0] ?? null;
  const planLabel = (p: PlanDto) => {
    const exam = p.examId ? (examsQuery.data ?? []).find((x) => x.id === p.examId) : null;
    return exam ? exam.title : 'Generale';
  };
  const today = todayIso();
  const nameOf = (key: string) => topicName(key, topicsQuery.data ?? [], documentsQuery.data ?? []);

  // Opens the wizard (a new draft) and moves the focus to its first field.
  const openWizard = (intensity: Intensity | null) => {
    setWizardIntensity(intensity);
    setWizardOpen(true);
    setTimeout(() => {
      const form = document.getElementById('piano-wizard');
      form?.scrollIntoView?.({ block: 'start' });
      form?.querySelector<HTMLInputElement>('input')?.focus();
    }, 0);
  };
  const focusExclude = () => {
    document
      .querySelector<HTMLSelectElement>('select[aria-label="Argomento da escludere"]')
      ?.focus();
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {planQuery.isLoading && (
        <div aria-hidden="true" className="flex flex-col gap-5">
          <div className="h-10 w-72 animate-pulse rounded-lg bg-bg-raised motion-reduce:animate-none" />
          <div className="h-64 animate-pulse rounded-[var(--radius-card)] bg-bg-raised motion-reduce:animate-none" />
        </div>
      )}
      {planQuery.isError && (
        <p role="alert" className="text-sm text-danger">
          {(planQuery.error as Error).message}
        </p>
      )}

      {planQuery.isSuccess && !plan && !awaitingDraft && (
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-fg-primary">Nuovo piano</h2>
            <p className="text-[13px] text-fg-secondary">
              Servono solo la data dell&apos;esame e il tempo che hai. Tutto il resto ha già un
              valore sensato.
            </p>
          </div>
          <span className="text-xs text-fg-muted">Nessun piano per questa materia</span>
        </div>
      )}

      {plan && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Piani della materia"
            className="flex flex-wrap gap-0.5 rounded-lg border border-border bg-bg-inset p-[3px]"
          >
            {plans.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={p.id === plan.id}
                onClick={() => setSelectedId(p.id)}
                className={`inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] px-3.5 text-[13px] font-medium transition-colors duration-120 ${FOCUS} ${
                  p.id === plan.id
                    ? 'bg-bg-raised text-fg-primary'
                    : 'text-fg-secondary hover:text-fg-primary'
                }`}
              >
                {planLabel(p)}
                {p.status === 'draft' && (
                  <span className="inline-flex h-5 items-center rounded bg-warn/10 px-1.5 text-[11px] text-warn">
                    bozza
                  </span>
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-expanded={wizardOpen}
            aria-controls="piano-nuovo"
            onClick={() => {
              setWizardIntensity(null);
              setWizardOpen((v) => !v);
            }}
            className={`${BTN_SECONDARY} h-9 ${wizardOpen ? 'bg-bg-raised' : ''}`}
          >
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M10 4v12M4 10h12" />
            </svg>
            {plan.status === 'draft' ? 'Rigenera bozza' : 'Nuovo piano'}
          </button>
        </div>
      )}

      {awaitingDraft && (
        <section
          role="status"
          aria-busy="true"
          className={`${CARD_BOX} flex flex-col gap-2.5 px-6 py-5`}
        >
          <h2 className="text-sm font-semibold text-fg-primary">Sto preparando la bozza…</h2>
          <span aria-hidden="true" className="block h-1 overflow-hidden rounded-sm bg-border">
            <span className="block h-1 w-1/3 animate-pulse rounded-sm bg-accent motion-reduce:animate-none" />
          </span>
          <p className="text-[13px] text-fg-secondary">
            Circa un minuto. La trovi qui appena è pronta, da controllare e approvare.
          </p>
        </section>
      )}

      {planQuery.isSuccess && ((!plan && !awaitingDraft) || wizardOpen) && (
        <section
          id="piano-nuovo"
          aria-label="Nuovo piano"
          className={
            plan
              ? 'flex flex-col gap-4 rounded-[var(--radius-card)] border border-accent/40 p-5'
              : undefined
          }
        >
          {plan && (
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-sm font-semibold text-fg-primary">Nuovo piano</h2>
                <p className="text-[13px] text-fg-secondary">
                  {wizardIntensity
                    ? 'Per cambiare intensità si prepara una nuova bozza: scegli le date e genera.'
                    : 'Il piano attivo resta finché non approvi la nuova bozza.'}
                </p>
              </div>
              <button
                type="button"
                aria-label="Chiudi"
                onClick={() => {
                  setWizardOpen(false);
                  setWizardIntensity(null);
                }}
                className={ICON_BTN}
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>
          )}
          <WizardForm
            key={wizardIntensity ?? 'default'}
            slug={slug}
            exams={examsQuery.data ?? []}
            defaultIntensity={wizardIntensity ?? undefined}
            onGenerated={() => {
              setWizardOpen(false);
              setWizardIntensity(null);
              setSelectedId(null);
              setAwaitingDraft(true);
              invalidatePlan();
            }}
          />
        </section>
      )}

      {plan && !wizardOpen && (
        <div className="space-y-5">
          {plan.status === 'draft' ? (
            <section
              aria-labelledby="piano-bozza"
              className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[var(--radius-card)] border border-warn/40 bg-warn/5 px-5 py-4"
            >
              <span
                aria-hidden="true"
                className="inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] bg-bg-base/40 text-warn"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                >
                  <path d="M5 3h7l3 3v11H5z M8 10h4M8 13h4" />
                </svg>
              </span>
              <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-0.5">
                <h2 id="piano-bozza" className="text-sm font-semibold text-fg-primary">
                  Bozza pronta · controllala e approvala
                </h2>
                <span className="text-[13px] text-fg-secondary">
                  {plan.startDate} → {plan.targetDate} · {plan.tasks.length} attività. Non è ancora
                  nel calendario.
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => commit.mutate(plan.id)}
                  disabled={commit.isPending || plan.tasks.length === 0}
                  title={plan.tasks.length === 0 ? 'La bozza non ha task: rigenerala.' : undefined}
                  className={BTN_PRIMARY}
                >
                  {commit.isPending ? 'Approvo…' : 'Approva'}
                </button>
                <button type="button" onClick={() => openWizard(null)} className={BTN_SECONDARY}>
                  Cambia impostazioni
                </button>
                <button
                  type="button"
                  onClick={() => discard.mutate()}
                  disabled={discard.isPending}
                  className={BTN_GHOST}
                >
                  Scarta
                </button>
              </div>
            </section>
          ) : (
            <p className="text-xs text-fg-muted">
              <span className="mr-2 inline-flex h-5 items-center rounded bg-ok/10 px-1.5 text-[11px] text-ok">
                attivo
              </span>
              {plan.startDate} → {plan.targetDate} · {plan.tasks.length} attività
            </p>
          )}

          <PlanChangeBox
            key={plan.id}
            slug={slug}
            planId={plan.id}
            pending={generateFromChange.isPending || awaitingDraft}
            onConfirm={(request) => generateFromChange.mutate(request)}
          />
          {generateFromChange.isError && (
            <p role="alert" className="text-sm text-danger">
              {(generateFromChange.error as Error).message}
            </p>
          )}

          <IntensityCard
            intensity={plan.prefs.intensity}
            hasPlannerSprint={plan.feasibility.sprintLessonKeys.length > 0}
            onChange={(next) => openWizard(next)}
          />
          <FitCard
            plan={plan}
            nameOf={nameOf}
            onAddAvailability={() => openWizard(null)}
            onExcludeMore={
              // Same candidates as the BulkBar select: hidden when it has none.
              plan.status === 'draft' &&
              plan.tasks.some((t) => t.topicKey && (t.kind === 'read' || t.kind === 'lesson'))
                ? focusExclude
                : undefined
            }
          />
          {diffQuery.data && <DiffPanel diff={diffQuery.data} />}

          {plan.status === 'draft' && <BulkBar slug={slug} plan={plan} onDone={invalidatePlan} />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const what = plan.status === 'draft' ? 'questa bozza' : 'il piano attivo';
                if (
                  window.confirm(
                    `Eliminare definitivamente ${what} e tutte le sue ${plan.tasks.length} task? L'operazione non si può annullare.`,
                  )
                ) {
                  deletePlan.mutate(plan.id);
                }
              }}
              disabled={deletePlan.isPending}
              className="rounded-[var(--radius-control)] border border-danger px-3 py-1.5 text-xs text-danger hover:bg-danger/10 disabled:opacity-50"
            >
              {deletePlan.isPending ? 'Elimino…' : 'Elimina piano'}
            </button>
            {deletePlan.isError && (
              <p role="alert" className="text-xs text-danger">
                {(deletePlan.error as Error).message}
              </p>
            )}
          </div>
          {commit.isError && (
            <p role="alert" className="text-xs text-danger">
              {(commit.error as Error).message}
            </p>
          )}

          {plan.tasks.length === 0 && (
            <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-8 text-center text-sm text-fg-muted">
              Nessuna task pianificata — carica materiale nella materia, poi rigenera il piano.
            </div>
          )}

          {plan.tasks.length > 0 && (
            <>
              <PlanSchedule
                key={plan.id}
                slug={slug}
                plan={plan}
                today={today}
                onPin={(id, pinned) => pin.mutate({ id, pinned })}
                onDelete={(id) => removeTask.mutate(id)}
                onStatus={(id, status) => setStatus.mutate({ id, status })}
                onMethod={(id, method) => setMethod.mutateAsync({ id, method })}
              />
              <PlanTopicsList plan={plan} today={today} nameOf={nameOf} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** `/materie/[slug]/piano`: its own screen on mobile; on desktop the plan is the subject's Piano tab. */
export function PlanClient({ slug }: { slug: string }) {
  const isMobile = useIsMobile();
  const router = useRouter();
  useEffect(() => {
    if (isMobile === false) router.replace(`/materie/${slug}?tab=piano`);
  }, [isMobile, router, slug]);
  if (!isMobile) {
    return (
      <p role="status" className="p-4 text-sm text-fg-muted">
        Caricamento…
      </p>
    );
  }
  return <PlanMobile slug={slug} />;
}
