'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import type { GeneratePlanRequest, PlanDto, TaskDto } from '@studyhub/contracts';
import { dayRange, defaultDay, excludableTopics, overdueTasks } from '@/lib/planMobile';
import { materialHref } from '@/lib/subjectTabs';
import { SUBJECT_COLOR_HEX } from '@/lib/subjectColors';
import { secondaryButton } from '../simulation-mobile/styles';
import { SectionError, SkeletonRows } from '../subject-mobile/SectionState';
import { todayIso } from '../subject-mobile/queries';
import { AssistantHost } from '../subject-mobile/AssistantHost';
import { DayStrip } from './DayStrip';
import { DayTasks } from './DayTasks';
import { DeletePlanSheet } from './DeletePlanSheet';
import { DraftCard } from './DraftCard';
import { DriftCard } from './DriftCard';
import { EmptyPlan } from './EmptyPlan';
import { ExcludeTopicSheet } from './ExcludeTopicSheet';
import { FeasibilityCard } from './FeasibilityCard';
import { PlanHeader } from './PlanHeader';
import { PlanSheet } from './PlanSheet';
import { PlanSummaryCard } from './PlanSummaryCard';
import { TaskSheet } from './TaskSheet';
import { usePlanMutations, usePlanQueries } from './usePlanData';

type Sheet =
  | { type: 'task'; taskId: string }
  | { type: 'plan'; planId?: string }
  | { type: 'exclude' | 'delete' }
  | null;

// The server explains why the move was refused (e.g. a lesson would pass the exam date).
function moveErrorMessage(err: Error): string {
  return `Nessuna task spostata. ${err.message}`;
}

/** Mobile (< md) view of `/materie/[slug]/piano`; the desktop keeps `PlanDesktop`. */
export function PlanMobile({ slug }: { slug: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  // Set while a just-submitted generate_plan job has not produced a (new) draft yet.
  const [awaiting, setAwaiting] = useState<{ prevDraftId: string | null } | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);

  const q = usePlanQueries(slug, { awaitingDraft: awaiting !== null, selectedId });
  const mutations = usePlanMutations(slug);

  const plans = q.plans.data ?? [];
  const plan: PlanDto | null = plans.find((p) => p.id === selectedId) ?? plans[0] ?? null;
  const draftPlan = plans.find((p) => p.status === 'draft') ?? null;

  useEffect(() => {
    if (!awaiting) return;
    if (plans.some((p) => p.status === 'draft' && p.id !== awaiting.prevDraftId)) {
      setAwaiting(null);
      setSelectedId(null);
      setNotice('Bozza pronta: controllala e confermala.');
      // The draft row can be read before its tasks are written: look again shortly.
      setTimeout(() => void q.plans.refetch(), 1500);
    }
  }, [awaiting, plans]);

  useEffect(() => {
    if (!awaiting) return;
    const timeout = setTimeout(() => {
      setAwaiting(null);
      setTimedOut(true);
    }, 60_000);
    return () => clearTimeout(timeout);
  }, [awaiting]);

  const today = todayIso();
  const subject = q.subject.data;
  const subjectHex = subject ? SUBJECT_COLOR_HEX[subject.color] : undefined;
  // Mutation errors are shared by sheets and page: clear them when a sheet opens or closes.
  const { generate: genM, bulk: bulkM, deletePlan: delM } = mutations;
  const {
    setStatus: statusM,
    pin: pinM,
    move: moveM,
    removeTask: rmM,
    reabsorb: reabM,
    moveMany: moveManyM,
  } = mutations;
  const closeSheet = () => {
    statusM.reset();
    pinM.reset();
    moveM.reset();
    rmM.reset();
    reabM.reset();
    moveManyM.reset();
    setSheet(null);
  };
  const openSheet = (next: NonNullable<Sheet>, trigger?: HTMLElement) => {
    if (trigger) triggerRef.current = trigger;
    genM.reset();
    bulkM.reset();
    delM.reset();
    moveManyM.reset();
    setNotice(null);
    setSheet(next);
  };

  const planLabel = (p: PlanDto) => {
    const exam = p.examId ? (q.exams.data ?? []).find((x) => x.id === p.examId) : null;
    return `${exam ? exam.title : 'Generale'}${p.status === 'draft' ? ' (bozza)' : ''}`;
  };

  const days = plan ? dayRange(plan.tasks) : [];
  const day = selectedDay && days.includes(selectedDay) ? selectedDay : defaultDay(days, today);
  const tasksByDay = new Map<string, TaskDto[]>();
  for (const t of plan?.tasks ?? []) tasksByDay.set(t.date, [...(tasksByDay.get(t.date) ?? []), t]);

  const drift = q.drift.data ?? null;
  const late = drift && plan ? overdueTasks(plan, drift.overdueKeys, today) : [];
  const lateDays = new Set(late.map((t) => t.date));

  const sheetTask =
    sheet?.type === 'task' ? (plan?.tasks.find((t) => t.id === sheet.taskId) ?? null) : null;
  const busy = mutations.setStatus.isPending || mutations.pin.isPending;
  const listError =
    sheet?.type !== 'task' && (mutations.setStatus.error || mutations.pin.error)
      ? ((mutations.setStatus.error ?? mutations.pin.error) as Error).message
      : null;

  const generate = (req: GeneratePlanRequest) => {
    mutations.generate.mutate(req, {
      onSuccess: () => {
        setTimedOut(false);
        setAwaiting({ prevDraftId: draftPlan?.id ?? null });
        closeSheet();
      },
    });
  };

  return (
    <div className="flex min-h-full min-w-0 flex-col overflow-x-clip">
      <PlanHeader
        slug={slug}
        subject={subject}
        onOpenActions={() => setActionsOpen(true)}
        actionsButtonRef={actionsButtonRef}
      />
      <div className="flex min-w-0 flex-col gap-5 p-4">
        {awaiting && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-[var(--radius-card)] border border-border bg-bg-surface p-3 text-sm text-fg-secondary"
          >
            <Loader2
              className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Generazione in corso — la bozza appare a breve.
          </p>
        )}
        {timedOut && !awaiting && (
          <p role="status" className="text-sm text-fg-secondary">
            La generazione sta richiedendo più del previsto. Riprova tra poco.
          </p>
        )}

        {notice && (
          <p
            role="status"
            data-testid="plan-notice"
            className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3 text-sm text-fg-secondary"
          >
            {notice}
          </p>
        )}

        {plans.length > 1 && (
          <div role="group" aria-label="Piani della materia" className="flex flex-wrap gap-1.5">
            {plans.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={p.id === plan?.id}
                onClick={() => {
                  setSelectedId(p.id);
                  setSelectedDay(null);
                }}
                className={`min-h-11 rounded-full border px-4 text-[13px] ${
                  p.id === plan?.id
                    ? 'border-accent bg-accent-subtle text-fg-primary'
                    : 'border-border text-fg-secondary'
                }`}
              >
                {planLabel(p)}
              </button>
            ))}
          </div>
        )}

        {q.plans.isLoading ? (
          <div aria-busy="true">
            <SkeletonRows count={3} />
          </div>
        ) : q.plans.isError ? (
          <SectionError
            message={(q.plans.error as Error).message}
            onRetry={() => void q.plans.refetch()}
          />
        ) : !plan ? (
          awaiting ? null : (
            <EmptyPlan onGenerate={(t) => openSheet({ type: 'plan' }, t)} />
          )
        ) : (
          <>
            <PlanSummaryCard
              plan={plan}
              onEditPace={(t) => openSheet({ type: 'plan', planId: plan.id }, t)}
              editDisabled={awaiting !== null}
            />
            {plan.status === 'active' && draftPlan && !awaiting && (
              <section
                aria-label="Bozza in attesa"
                className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-card)] border border-warn bg-bg-surface p-3"
              >
                <p className="text-sm">C’è una bozza in attesa di conferma.</p>
                <button
                  type="button"
                  data-testid="plan-draft-pending-open"
                  onClick={() => {
                    setSelectedId(draftPlan.id);
                    setSelectedDay(null);
                  }}
                  className={`${secondaryButton} min-h-11 text-sm`}
                >
                  Apri la bozza
                </button>
              </section>
            )}
            {plan.status === 'draft' && (
              <DraftCard
                diff={q.diff.data}
                onCommit={() => mutations.commit.mutate(plan.id)}
                empty={plan.tasks.length === 0}
                onDiscard={() => mutations.discard.mutate()}
                commitPending={mutations.commit.isPending}
                discardPending={mutations.discard.isPending}
                error={
                  mutations.commit.isError
                    ? (mutations.commit.error as Error).message
                    : mutations.discard.isError
                      ? (mutations.discard.error as Error).message
                      : null
                }
              />
            )}
            {drift && late.length > 0 && (
              <DriftCard
                count={late.length}
                drift={drift}
                feasibility={plan.feasibility}
                onReabsorb={() => {
                  mutations.moveMany.reset();
                  mutations.reabsorb.mutate(late);
                }}
                onRecalculate={(t) => openSheet({ type: 'plan' }, t)}
                onMoveDay={() => {
                  mutations.reabsorb.reset();
                  const sent = Math.min(late.length, 100);
                  mutations.moveMany.mutate(
                    late.map((t) => t.id),
                    {
                      onSuccess: () =>
                        setNotice(
                          sent < late.length
                            ? `${sent} task spostate. Ripeti per le altre.`
                            : sent === 1
                              ? '1 task spostata.'
                              : `${sent} task spostate.`,
                        ),
                    },
                  );
                }}
                movePending={mutations.moveMany.isPending}
                pending={mutations.reabsorb.isPending}
                error={
                  mutations.reabsorb.isError
                    ? (mutations.reabsorb.error as Error).message
                    : mutations.moveMany.isError
                      ? moveErrorMessage(mutations.moveMany.error as Error)
                      : null
                }
              />
            )}
            <FeasibilityCard plan={plan} />

            {day === null ? (
              <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-5 text-center text-sm text-fg-muted">
                Nessuna task pianificata — carica materiale nella materia, poi rigenera il piano.
                <Link
                  href={materialHref(slug, 'tutti')}
                  className="mx-auto mt-2 flex min-h-11 items-center justify-center text-fg-secondary underline"
                >
                  Vai al materiale
                </Link>
              </div>
            ) : (
              <>
                <DayStrip
                  days={days}
                  tasksByDay={tasksByDay}
                  selected={day}
                  onSelect={setSelectedDay}
                  today={today}
                  lateDays={lateDays}
                  subjectHex={subjectHex}
                />
                <DayTasks
                  slug={slug}
                  plan={plan}
                  day={day}
                  today={today}
                  subjectHex={subjectHex}
                  busy={busy}
                  triggerRef={triggerRef}
                  onOpenTask={(taskId) => setSheet({ type: 'task', taskId })}
                  onDone={(id) => mutations.setStatus.mutate({ id, status: 'done' })}
                  onPin={(t) => mutations.pin.mutate({ id: t.id, pinned: !t.pinned })}
                />
                {listError && (
                  <p role="alert" className="text-xs text-danger">
                    {listError}
                  </p>
                )}
              </>
            )}

            <div className="flex flex-col gap-2">
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={(e) => openSheet({ type: 'plan' }, e.currentTarget)}
                disabled={awaiting !== null}
                className={`${secondaryButton} min-h-12`}
              >
                Rigenera bozza
              </button>
              {excludableTopics(plan).length > 0 && (
                <button
                  type="button"
                  aria-haspopup="dialog"
                  data-testid="plan-exclude-open"
                  onClick={(e) => openSheet({ type: 'exclude' }, e.currentTarget)}
                  className="flex min-h-11 items-center justify-center text-sm text-fg-secondary underline-offset-2 hover:underline"
                >
                  Escludi un argomento…
                </button>
              )}
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={(e) => openSheet({ type: 'delete' }, e.currentTarget)}
                className="flex min-h-11 items-center justify-center text-sm text-danger underline-offset-2 hover:underline"
              >
                Elimina piano
              </button>
            </div>
          </>
        )}
      </div>

      {plan && (
        <TaskSheet
          slug={slug}
          task={sheetTask}
          plan={plan}
          onClose={closeSheet}
          returnFocusRef={triggerRef}
          mutations={mutations}
        />
      )}
      <PlanSheet
        open={sheet?.type === 'plan'}
        onOpenChange={(o) => {
          if (!o) closeSheet();
        }}
        slug={slug}
        plan={
          plans.find((p) => p.id === (sheet?.type === 'plan' ? sheet.planId : undefined)) ?? plan
        }
        hasDraft={draftPlan !== null}
        exams={q.exams.data ?? []}
        returnFocusRef={triggerRef}
        pending={mutations.generate.isPending}
        error={mutations.generate.isError ? (mutations.generate.error as Error).message : null}
        onSubmit={generate}
      />
      <ExcludeTopicSheet
        open={sheet?.type === 'exclude'}
        onOpenChange={(o) => {
          if (!o) closeSheet();
        }}
        plan={plan}
        hasDraft={draftPlan !== null}
        returnFocusRef={triggerRef}
        pending={mutations.bulk.isPending}
        error={mutations.bulk.isError ? (mutations.bulk.error as Error).message : null}
        onExclude={(topicKey, openCount) =>
          plan &&
          mutations.bulk.mutate(
            { type: 'exclude_topic', topicKey, planId: plan.id },
            {
              onSuccess: (res: { skipped?: number } | null) => {
                closeSheet();
                if (plan.status === 'active') {
                  const n = res?.skipped ?? openCount;
                  setNotice(
                    n === 1
                      ? '1 lezione segnata come saltata.'
                      : `${n} lezioni segnate come saltate.`,
                  );
                }
              },
            },
          )
        }
      />
      <DeletePlanSheet
        open={sheet?.type === 'delete'}
        onOpenChange={(o) => {
          if (!o) closeSheet();
        }}
        plan={plan}
        returnFocusRef={triggerRef}
        pending={mutations.deletePlan.isPending}
        error={mutations.deletePlan.isError ? (mutations.deletePlan.error as Error).message : null}
        onConfirm={() =>
          plan &&
          mutations.deletePlan.mutate(plan.id, {
            onSuccess: () => {
              closeSheet();
              setSelectedId(null);
            },
          })
        }
      />
      {subject && (
        <AssistantHost
          slug={slug}
          subject={subject}
          open={actionsOpen}
          onOpenChange={setActionsOpen}
          returnFocusRef={actionsButtonRef}
        />
      )}
    </div>
  );
}
