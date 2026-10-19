import { and, eq, gt, isNull } from 'drizzle-orm';
import {
  artifacts,
  documents,
  exams,
  flashcards,
  studyPlans,
  subjects,
  tasks,
  topics,
} from '@studyhub/db';
import { addDays, diffDays, type IsoDate } from '@studyhub/core';
import type { DashboardSummaryDto, OnboardingDto } from '@studyhub/contracts';
import { listSubjectSummaries } from './subjects';
import { getCalendarRange } from './calendar';
import { getRecentJobs } from './jobs';
import { getReviewOverview } from './review';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const UPCOMING_DAYS = 14; // docs/fasi/F7-dashboard-polish.md §5: "prossimi 14 giorni"

/**
 * `mastery` (docs/02-filesystem-e-dati.md §5) is `null` on many topics still — only those with
 * a reviewed card, a simulation, or assigned material get one (`recomputeTopicMastery`). Joins
 * subjects to exclude archived ones from the average (docs/fasi/F2-materie.md "Archivio una
 * materia: sparisce dalla dashboard").
 */
async function averageMastery(db: AnyDb): Promise<number | null> {
  const rows: { mastery: number | null }[] = await db
    .select({ mastery: topics.mastery })
    .from(topics)
    .innerJoin(subjects, eq(topics.subjectId, subjects.id))
    .where(isNull(subjects.archivedAt));
  const values = rows.map((r) => r.mastery).filter((m): m is number => m !== null);
  if (values.length === 0) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 1000) / 1000;
}

async function nextExam(db: AnyDb, startOfToday: Date) {
  const [row] = await db
    .select({
      title: exams.title,
      date: exams.date,
      subjectSlug: subjects.slug,
      subjectName: subjects.name,
      subjectColor: subjects.color,
    })
    .from(exams)
    .innerJoin(subjects, eq(exams.subjectId, subjects.id))
    .where(
      and(eq(exams.status, 'scheduled'), gt(exams.date, startOfToday), isNull(subjects.archivedAt)),
    )
    .orderBy(exams.date)
    .limit(1);
  return row ?? null;
}

/**
 * The first-run checklist, from what actually exists (archived subjects don't count). Each step
 * links to where it is done: the first subject's page, or the subject list before there is one.
 * "Ready" means a document reached `parsed` — uploading isn't enough to get cards out of it.
 */
export async function getOnboarding(db: AnyDb): Promise<OnboardingDto> {
  const live = isNull(subjects.archivedAt);
  const subjectRows: { slug: string }[] = await db
    .select({ slug: subjects.slug })
    .from(subjects)
    .where(live)
    .orderBy(subjects.createdAt);
  const docRows: { status: string }[] = await db
    .select({ status: documents.status })
    .from(documents)
    .innerJoin(subjects, eq(documents.subjectId, subjects.id))
    .where(live);
  const cardRows: { id: string }[] = await db
    .select({ id: flashcards.id })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .innerJoin(subjects, eq(artifacts.subjectId, subjects.id))
    .where(live)
    .limit(1);
  // A committed plan with at least one task: what "vedi la prima task" needs.
  const planRows: { id: string }[] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(studyPlans, eq(tasks.planId, studyPlans.id))
    .innerJoin(subjects, eq(studyPlans.subjectId, subjects.id))
    .where(and(live, eq(studyPlans.status, 'active')))
    .limit(1);

  const slug = subjectRows[0]?.slug;
  const subjectHref = slug ? `/materie/${slug}` : '/materie';
  const steps: OnboardingDto['steps'] = [
    {
      key: 'subject',
      label: 'Crea una materia',
      hint: 'Ogni materia è una cartella con tutto il suo materiale.',
      done: subjectRows.length > 0,
      href: '/materie',
    },
    {
      key: 'document',
      label: 'Carica un PDF o una foto',
      hint: 'Appunti, slide o un esame passato: diventano Markdown pulito.',
      done: docRows.length > 0,
      href: subjectHref,
    },
    {
      key: 'ready',
      label: 'Aspetta che sia pronto',
      hint: 'Il documento deve arrivare a "Pronto" prima di generare da esso.',
      done: docRows.some((d) => d.status === 'parsed'),
      href: subjectHref,
    },
    {
      key: 'flashcards',
      label: 'Genera le prime flashcard',
      hint: 'Dal pannello AI della materia: scegli il documento e genera.',
      done: cardRows.length > 0,
      href: subjectHref,
    },
    {
      key: 'plan',
      label: 'Conferma un piano di studio',
      hint: "Indica la data dell'esame: le task del giorno compaiono qui.",
      done: planRows.length > 0,
      href: slug ? `/materie/${slug}/piano` : '/materie',
    },
  ];
  const next = steps.find((s) => !s.done);
  return { steps, completed: !next, nextKey: next ? next.key : null };
}

/**
 * Everything the Dashboard home needs in one call (docs/fasi/F7-dashboard-polish.md
 * "Scope — Dashboard"): status tiles, today's actionable tasks, a 14-day
 * strip, per-subject flashcard load, and the recent-jobs activity feed.
 */
export async function getDashboardSummary(db: AnyDb, today: IsoDate): Promise<DashboardSummaryDto> {
  const startOfToday = new Date(`${today}T00:00:00.000Z`);
  // Due cards come from the Ripasso overview, i.e. the queue's own rule (docs/09-ripasso-mobile.md
  // §B1): the count is exactly what a review session serves — flagged cards and the new-card limit
  // included. `today` is normally the current day; a test may pin another one.
  const now = new Date();
  const reviewClock = now.toISOString().startsWith(today) ? now : startOfToday;
  const [subjectSummaries, reviewOverview, avgMastery, exam, upcoming, recentJobs, onboarding] =
    await Promise.all([
      listSubjectSummaries(db, { now: reviewClock }),
      getReviewOverview(db, reviewClock),
      averageMastery(db),
      nextExam(db, startOfToday),
      getCalendarRange(db, today, addDays(today, UPCOMING_DAYS)),
      getRecentJobs(db, 10),
      getOnboarding(db),
    ]);

  const dueBySubject = new Map(reviewOverview.subjects.map((s) => [s.slug, s.due]));
  const dueCardsCount = reviewOverview.totalDue;
  const todayTasksAll = upcoming.tasks.filter((t) => t.date === today);
  const minutesPlannedToday = todayTasksAll.reduce((s, t) => s + t.minutes, 0);
  const todayTasks = todayTasksAll.filter((t) => t.status === 'todo' || t.status === 'doing');

  return {
    subjectsCount: subjectSummaries.length,
    daysToNextExam: exam ? diffDays(today, exam.date.toISOString().slice(0, 10)) : null,
    nextExam: exam
      ? {
          subjectSlug: exam.subjectSlug,
          subjectName: exam.subjectName,
          subjectColor: exam.subjectColor,
          title: exam.title,
          date: exam.date.toISOString(),
        }
      : null,
    minutesPlannedToday,
    dueCardsCount,
    averageMastery: avgMastery,
    todayTasks,
    upcoming,
    subjects: subjectSummaries.map((s) => ({
      slug: s.slug,
      name: s.name,
      color: s.color,
      documentCount: s.documentCount,
      nextExamAt: s.nextExamAt,
      dueCardsCount: dueBySubject.get(s.slug) ?? 0,
    })),
    recentJobs,
    onboarding,
  };
}
