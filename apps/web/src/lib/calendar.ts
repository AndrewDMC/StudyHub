import { and, eq, gte, lt } from 'drizzle-orm';
import { exams, studyPlans, subjects, tasks, type Exam, type Task } from '@studyhub/db';
import { buildIcsCalendar, type IcsEvent } from '@studyhub/core';
import type { CalendarExamDto, CalendarRangeDto, CalendarTaskDto } from '@studyhub/contracts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

interface SubjectMeta {
  slug: string;
  name: string;
  color: string;
}

function toCalendarTaskDto(row: Task, subject: SubjectMeta): CalendarTaskDto {
  return {
    id: row.id,
    planId: row.planId,
    taskKey: row.taskKey,
    date: row.date,
    kind: row.kind,
    topicKey: row.topicKey,
    topicId: row.topicId,
    minutes: row.minutes,
    title: row.title,
    description: row.description,
    payload: row.payload,
    pinned: row.pinned,
    origin: row.origin,
    status: row.status,
    subjectSlug: subject.slug,
    subjectName: subject.name,
    subjectColor: subject.color as CalendarTaskDto['subjectColor'],
  };
}

function toCalendarExamDto(row: Exam, subject: SubjectMeta): CalendarExamDto {
  return {
    id: row.id,
    subjectSlug: subject.slug,
    subjectName: subject.name,
    subjectColor: subject.color as CalendarExamDto['subjectColor'],
    title: row.title,
    kind: row.kind,
    date: row.date.toISOString(),
    status: row.status,
    location: row.location,
    description: row.description,
  };
}

/**
 * Cross-subject view over [start, end) — `start`/`end` are `YYYY-MM-DD`
 * (`tasks.date` is a plain IsoDate string, compared lexically; exam
 * timestamps are compared as real dates). Only *active* plans' tasks are
 * visible: a `draft` is invisible outside its own review screen
 * (docs/04-planner.md §9.1) — same rule `getDailyTasks` follows.
 */
export async function getCalendarRange(
  db: AnyDb,
  start: string,
  end: string,
): Promise<CalendarRangeDto> {
  const taskRows: (Task & { subjectSlug: string; subjectName: string; subjectColor: string })[] =
    await db
      .select({
        id: tasks.id,
        subjectId: tasks.subjectId,
        planId: tasks.planId,
        taskKey: tasks.taskKey,
        date: tasks.date,
        kind: tasks.kind,
        topicKey: tasks.topicKey,
        topicId: tasks.topicId,
        minutes: tasks.minutes,
        title: tasks.title,
        description: tasks.description,
        payload: tasks.payload,
        pinned: tasks.pinned,
        origin: tasks.origin,
        status: tasks.status,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        subjectSlug: subjects.slug,
        subjectName: subjects.name,
        subjectColor: subjects.color,
      })
      .from(tasks)
      .innerJoin(studyPlans, eq(tasks.planId, studyPlans.id))
      .innerJoin(subjects, eq(tasks.subjectId, subjects.id))
      .where(and(eq(studyPlans.status, 'active'), gte(tasks.date, start), lt(tasks.date, end)));

  const examRows: (Exam & { subjectSlug: string; subjectName: string; subjectColor: string })[] =
    await db
      .select({
        id: exams.id,
        subjectId: exams.subjectId,
        title: exams.title,
        kind: exams.kind,
        date: exams.date,
        weight: exams.weight,
        description: exams.description,
        location: exams.location,
        status: exams.status,
        allowedMaterials: exams.allowedMaterials,
        durationMin: exams.durationMin,
        createdAt: exams.createdAt,
        subjectSlug: subjects.slug,
        subjectName: subjects.name,
        subjectColor: subjects.color,
      })
      .from(exams)
      .innerJoin(subjects, eq(exams.subjectId, subjects.id))
      .where(
        and(
          gte(exams.date, new Date(`${start}T00:00:00.000Z`)),
          lt(exams.date, new Date(`${end}T00:00:00.000Z`)),
        ),
      );

  return {
    tasks: taskRows.map((r) =>
      toCalendarTaskDto(r, { slug: r.subjectSlug, name: r.subjectName, color: r.subjectColor }),
    ),
    exams: examRows.map((r) =>
      toCalendarExamDto(r, { slug: r.subjectSlug, name: r.subjectName, color: r.subjectColor }),
    ),
  };
}

const TASK_KIND_LABELS: Record<CalendarTaskDto['kind'], string> = {
  read: 'Lettura',
  flashcards: 'Flashcard',
  schema: 'Schema',
  simulation: 'Simulazione',
  drill: 'Drill',
  rest: 'Riposo',
  review: 'Ripasso',
};

const TASK_STATUS_LABELS: Record<CalendarTaskDto['status'], string> = {
  proposed: 'proposta',
  todo: 'da fare',
  doing: 'in corso',
  done: 'fatta',
  skipped: 'saltata',
  moved: 'spostata',
};

/**
 * Widest window `getCalendarRange`'s string/date comparisons accept — this is a single-user
 * local app, so fetching the whole history/future in one feed request is cheap, and simpler than
 * teaching calendar clients (which re-poll a fixed URL, no query params to vary) about a rolling
 * window.
 */
const FEED_START = '0001-01-01';
const FEED_END = '9999-12-31';

/**
 * ICS feed (docs/fasi/F6-planner-calendario.md scope: "Export ICS, feed sottoscrivibile") —
 * every active-plan task and every non-cancelled exam, cross-subject, as one subscribable
 * calendar. Reuses `getCalendarRange` rather than a parallel query, so the feed can never drift
 * from what `/calendario` itself shows.
 */
export async function getIcsFeed(db: AnyDb): Promise<string> {
  const range = await getCalendarRange(db, FEED_START, FEED_END);

  const taskEvents: IcsEvent[] = range.tasks.map((t) => ({
    uid: `task-${t.id}@studyhub.local`,
    dateStart: t.date,
    summary: t.title,
    description: `${t.minutes} min · ${TASK_KIND_LABELS[t.kind]} · ${TASK_STATUS_LABELS[t.status]}${t.description ? `\n${t.description}` : ''}`,
    categories: [t.subjectName],
  }));

  const examEvents: IcsEvent[] = range.exams
    .filter((e) => e.status !== 'cancelled')
    .map((e) => {
      const description = [e.location, e.description].filter(Boolean).join(' — ');
      return {
        uid: `exam-${e.id}@studyhub.local`,
        dateStart: e.date.slice(0, 10),
        summary: `Esame: ${e.title}`,
        categories: [e.subjectName, 'Esame'],
        ...(description ? { description } : {}),
      };
    });

  return buildIcsCalendar([...taskEvents, ...examEvents]);
}
