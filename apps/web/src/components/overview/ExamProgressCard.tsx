import Link from 'next/link';
import type { ExamDto, PlanDto, SimulationSummaryDto, TaskDto } from '@studyhub/contracts';
import { TabCard } from '../subject-tabs/TabCard';
import { ProgressBar } from '../subject-tabs/ProgressBar';
import { LINK_TEXT } from '../subject-tabs/styles';
import { formatExamDuration } from '../subject-tabs/format';
import { formatExamCountdown } from '@/lib/format';
import { examHeading, formatDayShort, plural, type ProgressCounts } from './model';

const EXAM_KIND: Record<ExamDto['kind'], string> = {
  scritto: 'Scritto',
  orale: 'Orale',
  parziale: 'Parziale',
  progetto: 'Progetto',
};

/** "Verso lo scritto": days to the exam, how much of the plan is done, what was left out. */
export function ExamProgressCard({
  slug,
  exam,
  plan,
  counts,
  excludedNames,
  lastSim,
  nextSimTask,
}: {
  slug: string;
  exam: ExamDto | undefined;
  plan: PlanDto | null;
  counts: ProgressCounts;
  excludedNames: string[];
  lastSim: SimulationSummaryDto | null;
  nextSimTask: TaskDto | null;
}) {
  const sprint = plan?.feasibility.sprintLessonKeys.length ?? 0;
  const segments = [
    { n: counts.studied, text: `${counts.studied} studiati`, cls: 'bg-ok' },
    { n: counts.inProgress, text: `${counts.inProgress} in corso`, cls: 'bg-accent' },
    { n: counts.todo, text: `${counts.todo} da fare`, cls: 'bg-border-strong' },
    { n: counts.out, text: `${counts.out} fuori dal piano`, cls: 'bg-danger' },
  ];
  const ratio = counts.lessonsTotal > 0 ? counts.lessonsDone / counts.lessonsTotal : 0;

  return (
    <TabCard label={examHeading(exam?.kind)} labelId="avanz">
      <div data-testid="overview-progress" className="flex flex-col gap-3.5">
        {exam ? (
          <div className="flex items-center justify-between gap-2 text-[13px] text-fg-secondary">
            <span>
              {EXAM_KIND[exam.kind]} {formatDayShort(exam.date)}
            </span>
            <span className="rounded-[var(--radius-control)] bg-bg-raised px-2 py-0.5 font-mono text-xs text-fg-primary">
              {formatExamCountdown(exam.date)}
            </span>
          </div>
        ) : (
          <p className="text-[13px] text-fg-secondary">
            Nessun esame in programma.{' '}
            <Link href={`/materie/${slug}?tab=esami`} className={LINK_TEXT}>
              Aggiungi un esame
            </Link>
          </p>
        )}

        {plan ? (
          <>
            <div
              role="img"
              aria-label={`Argomenti: ${segments.map((s) => s.text).join(', ')}`}
              className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-border"
            >
              {segments
                .filter((s) => s.n > 0)
                .map((s) => (
                  <span key={s.text} className={s.cls} style={{ flexGrow: s.n }} />
                ))}
            </div>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px] text-fg-secondary">
              {segments.map((s) => (
                <li key={s.text} className="flex items-center gap-2">
                  <span aria-hidden="true" className={`size-2 shrink-0 rounded-sm ${s.cls}`} />
                  {s.text}
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-1.5">
              <ProgressBar ratio={ratio} tone="ok" />
              <p className="text-[13px] text-fg-secondary">
                Lezioni fatte: {counts.lessonsDone} di {counts.lessonsTotal}
              </p>
            </div>
          </>
        ) : (
          <p className="text-[13px] text-fg-secondary">
            Senza un piano non c&apos;è un avanzamento da mostrare.{' '}
            <Link href={`/materie/${slug}/piano`} className={LINK_TEXT}>
              Genera il piano
            </Link>
          </p>
        )}

        <div className="flex flex-col gap-1 text-[13px] text-fg-secondary">
          {sprint > 0 && <p>In sprint: {plural(sprint, 'lezione', 'lezioni')}</p>}
          {excludedNames.length > 0 && <p>Fuori dal piano: {excludedNames.join(', ')}.</p>}
          {plan && plan.feasibility.shortfallMinutes > 0 && excludedNames.length > 0 && (
            <p>Mancano circa {formatExamDuration(plan.feasibility.shortfallMinutes)}.</p>
          )}
          {lastSim && lastSim.lastScoreRatio !== null && lastSim.lastGradedAt && (
            <p>
              Ultima simulazione:{' '}
              <span className="text-fg-primary">
                {Math.round(lastSim.lastScoreRatio * 100)}% · {formatDayShort(lastSim.lastGradedAt)}
              </span>
            </p>
          )}
          {nextSimTask && (
            <p>
              Prossima simulazione:{' '}
              <span className="text-fg-primary">
                {formatDayShort(nextSimTask.date)} · {nextSimTask.minutes} min
              </span>
            </p>
          )}
          {!lastSim && !nextSimTask && (
            <p>
              Nessuna simulazione ancora.{' '}
              <Link href={`/materie/${slug}?tab=simulazioni`} className={LINK_TEXT}>
                Vai alle simulazioni
              </Link>
            </p>
          )}
        </div>
      </div>
    </TabCard>
  );
}
