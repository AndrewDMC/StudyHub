'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DashboardSummaryDto, OnboardingDto } from '@studyhub/contracts';
import { SUBJECT_COLOR_HEX } from '@/lib/subjectColors';

async function fetchDashboard(): Promise<DashboardSummaryDto> {
  const res = await fetch('/api/dashboard');
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare la dashboard');
  return body as DashboardSummaryDto;
}

async function setTaskStatus(subjectSlug: string, taskId: string, status: 'done' | 'skipped') {
  const res = await fetch(`/api/subjects/${subjectSlug}/plan/tasks/${taskId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Azione fallita');
  }
}

const JOB_STATUS_LABELS: Record<string, string> = {
  queued: 'In coda',
  running: 'In corso',
  succeeded: 'Completato',
  failed: 'Fallito',
  cancelled: 'Annullato',
};

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | undefined;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4">
      <p className="text-xs uppercase tracking-wide text-fg-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-fg-primary">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-fg-muted">{sub}</p>}
    </div>
  );
}

/**
 * First-run checklist: five steps from an empty install to "I see my first task". Every step is
 * derived from real state (`getOnboarding`), so it can't drift from what the user actually did,
 * and it disappears on its own once complete.
 */
function OnboardingCard({ onboarding }: { onboarding: OnboardingDto }) {
  const done = onboarding.steps.filter((s) => s.done).length;
  return (
    <section
      aria-label="Per iniziare"
      data-testid="onboarding"
      className="rounded-[var(--radius-card)] border border-accent bg-bg-surface p-4"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-fg-primary">Per iniziare</h2>
        <span className="font-mono text-xs tabular-nums text-fg-muted">
          {done}/{onboarding.steps.length}
        </span>
      </div>
      <ol className="space-y-2">
        {onboarding.steps.map((step, i) => {
          const isNext = step.key === onboarding.nextKey;
          return (
            <li key={step.key} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                  step.done
                    ? 'border-ok text-ok'
                    : isNext
                      ? 'border-accent text-accent'
                      : 'border-border text-fg-muted'
                }`}
              >
                {step.done ? '✓' : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm ${step.done ? 'text-fg-muted line-through' : 'font-medium text-fg-primary'}`}
                >
                  {step.label}
                  <span className="sr-only">{step.done ? ' (fatto)' : ''}</span>
                </p>
                {isNext && <p className="mt-0.5 text-xs text-fg-secondary">{step.hint}</p>}
              </div>
              {isNext && (
                <Link
                  href={step.href}
                  className="shrink-0 rounded-[var(--radius-control)] bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover"
                >
                  Vai
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TodaySection({
  summary,
  onStatus,
}: {
  summary: DashboardSummaryDto;
  onStatus: (subjectSlug: string, taskId: string, status: 'done' | 'skipped') => void;
}) {
  const [first, ...rest] = summary.todayTasks;

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-muted">Oggi</h2>

      {!first && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border p-6 text-center text-sm text-fg-muted">
          Nessuna task per oggi.{' '}
          {summary.subjectsCount === 0
            ? 'Crea una materia per iniziare.'
            : 'Genera o rigenera un piano in una materia.'}
        </div>
      )}

      {first && (
        <div className="mb-3 rounded-[var(--radius-card)] border border-accent bg-bg-raised p-4">
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-fg-muted">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: SUBJECT_COLOR_HEX[first.subjectColor] }}
            />
            {first.subjectName} · {first.minutes} min
          </p>
          <p className="mt-1 text-lg font-semibold text-fg-primary">{first.title}</p>
          {first.description && (
            <p className="mt-1 text-sm text-fg-secondary">{first.description}</p>
          )}
          <div className="mt-3 flex gap-2">
            <Link
              href={`/materie/${first.subjectSlug}/piano`}
              className="rounded-[var(--radius-control)] bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Inizia
            </Link>
            <button
              type="button"
              onClick={() => onStatus(first.subjectSlug, first.id, 'done')}
              className="rounded-[var(--radius-control)] border border-ok px-3 py-1.5 text-sm text-ok"
            >
              Fatta
            </button>
            <button
              type="button"
              onClick={() => onStatus(first.subjectSlug, first.id, 'skipped')}
              className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm text-fg-muted"
            >
              Salta
            </button>
          </div>
        </div>
      )}

      {rest.length > 0 && (
        <ul className="space-y-1.5">
          {rest.map((task) => (
            <li
              key={task.id}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: SUBJECT_COLOR_HEX[task.subjectColor] }}
                />
                <span className="truncate text-fg-primary">{task.title}</span>
              </span>
              <span className="shrink-0 font-mono text-xs text-fg-muted">{task.minutes} min</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FlashcardsBySubject({ summary }: { summary: DashboardSummaryDto }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-muted">
        Flashcard per materia
      </h2>
      {summary.subjects.length === 0 && (
        <p className="text-sm text-fg-muted">Nessuna materia ancora.</p>
      )}
      <ul className="space-y-2">
        {summary.subjects.map((s) => (
          <li key={s.slug}>
            <Link
              href={`/materie/${s.slug}`}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-sm hover:bg-bg-raised"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: SUBJECT_COLOR_HEX[s.color] }}
                />
                <span className="truncate text-fg-primary">{s.name}</span>
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-fg-muted">
                {s.dueCardsCount > 0 ? `${s.dueCardsCount} da ripassare` : 'in pari'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href="/materie"
        className="mt-3 inline-block text-xs text-fg-muted underline-offset-2 hover:text-fg-secondary hover:underline"
      >
        Carica materiale →
      </Link>
    </section>
  );
}

function CompactCalendar({ summary }: { summary: DashboardSummaryDto }) {
  const byDay = new Map<string, number>();
  const examsByDay = new Set<string>();
  for (const t of summary.upcoming.tasks) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.minutes);
  for (const e of summary.upcoming.exams) examsByDay.add(e.date.slice(0, 10));
  const days =
    [...byDay.keys(), ...examsByDay].length > 0
      ? [...new Set([...byDay.keys(), ...examsByDay])].sort()
      : [];
  const maxMinutes = Math.max(1, ...byDay.values());

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">
          Prossimi 14 giorni
        </h2>
        <Link
          href="/calendario"
          className="text-xs text-fg-muted underline-offset-2 hover:text-fg-secondary hover:underline"
        >
          Calendario →
        </Link>
      </div>
      {days.length === 0 && (
        <p className="text-sm text-fg-muted">Nessuna task o esame nei prossimi 14 giorni.</p>
      )}
      {days.length > 0 && (
        <div className="flex items-end gap-1.5">
          {days.map((date) => {
            const minutes = byDay.get(date) ?? 0;
            const heightPct = Math.max(6, Math.round((minutes / maxMinutes) * 100));
            return (
              <div key={date} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-16 w-full items-end">
                  <div
                    className="w-full rounded-t-[3px] bg-accent/60"
                    style={{ height: `${heightPct}%` }}
                    title={`${minutes} min`}
                  />
                </div>
                <span className="font-mono text-[10px] text-fg-muted">{date.slice(8, 10)}</span>
                {examsByDay.has(date) && <span className="text-[10px]">🎯</span>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ActivityFeed({ summary }: { summary: DashboardSummaryDto }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-muted">Attività</h2>
      {summary.recentJobs.length === 0 && (
        <p className="text-sm text-fg-muted">Nessun job ancora.</p>
      )}
      <ul className="space-y-1.5">
        {summary.recentJobs.map((job) => (
          <li key={job.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-fg-secondary">
              {job.type}
              {job.subjectName ? ` · ${job.subjectName}` : ''}
              {job.errorMessage ? ` — ${job.errorMessage}` : ''}
            </span>
            <span
              className={`shrink-0 rounded-full border px-1.5 py-0.5 ${
                job.status === 'failed'
                  ? 'border-danger text-danger'
                  : job.status === 'succeeded'
                    ? 'border-ok text-ok'
                    : 'border-border text-fg-muted'
              }`}
            >
              {JOB_STATUS_LABELS[job.status] ?? job.status}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Dashboard home (docs/fasi/F7-dashboard-polish.md "Scope — Dashboard").
 * **Not built in this slice** (see F7 "Stato"): the "azioni AI" section of
 * the command palette (navigation-only so far), Lighthouse/a11y audit,
 * light theme, density levels — the tile layout and live cross-subject
 * data are real, the visual polish pass is not.
 */
export function DashboardClient() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard });

  const status = useMutation({
    mutationFn: ({
      subjectSlug,
      taskId,
      status: s,
    }: {
      subjectSlug: string;
      taskId: string;
      status: 'done' | 'skipped';
    }) => setTaskStatus(subjectSlug, taskId, s),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
  });

  if (query.isLoading) {
    return <div className="mx-auto max-w-[1440px] p-6 text-sm text-fg-muted">Caricamento…</div>;
  }
  if (query.isError || !query.data) {
    return (
      <div className="mx-auto max-w-[1440px] p-6">
        <div
          role="alert"
          className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-6 text-sm text-danger"
        >
          {query.isError ? (query.error as Error).message : 'Dashboard non disponibile.'}
        </div>
      </div>
    );
  }

  const summary = query.data;

  return (
    <div className="mx-auto max-w-[1440px] space-y-4 p-6">
      <h1 className="text-xl font-semibold tracking-[-0.02em]">Dashboard</h1>

      {!summary.onboarding.completed && <OnboardingCard onboarding={summary.onboarding} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Prossimo esame"
          value={summary.daysToNextExam === null ? '—' : `${summary.daysToNextExam}g`}
          sub={summary.nextExam?.title}
        />
        <StatTile label="Minuti pianificati oggi" value={String(summary.minutesPlannedToday)} />
        <StatTile label="Card in scadenza" value={String(summary.dueCardsCount)} />
        <StatTile
          label="Mastery media"
          value={
            summary.averageMastery === null ? 'N/D' : `${Math.round(summary.averageMastery * 100)}%`
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-7">
          <TodaySection
            summary={summary}
            onStatus={(subjectSlug, taskId, s) => status.mutate({ subjectSlug, taskId, status: s })}
          />
          <CompactCalendar summary={summary} />
        </div>
        <div className="space-y-4 lg:col-span-5">
          <FlashcardsBySubject summary={summary} />
          <ActivityFeed summary={summary} />
        </div>
      </div>
    </div>
  );
}
