import { and, eq, gte, lt } from 'drizzle-orm';
import { exams, studyPlans, subjects, tasks, type Exam, type Task } from '@studyhub/db';
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
