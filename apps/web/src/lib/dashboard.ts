import { and, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { artifacts, exams, flashcards, subjects, topics } from '@studyhub/db';
import { addDays, diffDays, type IsoDate } from '@studyhub/core';
import type { DashboardSummaryDto } from '@studyhub/contracts';
import { listSubjectSummaries } from './subjects';
import { getCalendarRange } from './calendar';
import { getRecentJobs } from './jobs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const UPCOMING_DAYS = 14; // docs/fasi/F7-dashboard-polish.md §5: "prossimi 14 giorni"

/**
 * Cards due *by the end of `today`* (docs/fasi/F4-flashcard.md daily queue rule): new, or
 * past/at their `dueAt`. Joins subjects to exclude archived ones — a card doesn't stop being
 * "due" when its subject is archived, but it should stop showing up on the dashboard home
 * (docs/fasi/F2-materie.md "Archivio una materia: sparisce dalla dashboard").
 */
async function countDueCards(db: AnyDb, endOfToday: Date): Promise<number> {
  const rows: { id: string }[] = await db
    .select({ id: flashcards.id })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .innerJoin(subjects, eq(artifacts.subjectId, subjects.id))
    .where(
      and(
        eq(flashcards.suspended, false),
        isNull(subjects.archivedAt),
        or(
          eq(flashcards.state, 'new'),
          and(isNotNull(flashcards.dueAt), lte(flashcards.dueAt, endOfToday)),
        ),
      ),
    );
  return rows.length;
}

/** Per-subject due-card counts, for the "Flashcard per materia" tile. */
async function countDueCardsBySubject(db: AnyDb, endOfToday: Date): Promise<Map<string, number>> {
  const rows: { subjectId: string }[] = await db
    .select({ subjectId: artifacts.subjectId })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .innerJoin(subjects, eq(artifacts.subjectId, subjects.id))
    .where(
      and(
        eq(flashcards.suspended, false),
        isNull(subjects.archivedAt),
        or(
          eq(flashcards.state, 'new'),
          and(isNotNull(flashcards.dueAt), lte(flashcards.dueAt, endOfToday)),
        ),
      ),
    );
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.subjectId, (counts.get(r.subjectId) ?? 0) + 1);
  return counts;
}

/**
 * `mastery` (docs/02-filesystem-e-dati.md §5) is `null` on many topics still — only those with
 * a reviewed card, a simulation, or assigned material get one (`recomputeTopicMastery`). Joins
 * subjects to exclude archived ones from the average (same reasoning as `countDueCards`).
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
 * Everything the Dashboard home needs in one call (docs/fasi/F7-dashboard-polish.md
 * "Scope — Dashboard"): status tiles, today's actionable tasks, a 14-day
 * strip, per-subject flashcard load, and the recent-jobs activity feed.
 */
export async function getDashboardSummary(db: AnyDb, today: IsoDate): Promise<DashboardSummaryDto> {
  const startOfToday = new Date(`${today}T00:00:00.000Z`);
  const endOfToday = new Date(`${today}T23:59:59.999Z`);
  const [subjectSummaries, dueBySubject, dueCardsCount, avgMastery, exam, upcoming, recentJobs] =
    await Promise.all([
      listSubjectSummaries(db),
      countDueCardsBySubject(db, endOfToday),
      countDueCards(db, endOfToday),
      averageMastery(db),
      nextExam(db, startOfToday),
      getCalendarRange(db, today, addDays(today, UPCOMING_DAYS)),
      getRecentJobs(db, 10),
    ]);

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
      dueCardsCount: dueBySubject.get(s.id) ?? 0,
    })),
    recentJobs,
  };
}
