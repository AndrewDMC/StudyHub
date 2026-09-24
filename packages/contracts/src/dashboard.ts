import { z } from 'zod';
import { SubjectColorSchema } from '@studyhub/core';
import { CalendarRangeDtoSchema, CalendarTaskDtoSchema } from './calendar.js';
import { JobStatusSchema } from './job.js';

/** One row of the "Attività" feed (docs/fasi/F7-dashboard-polish.md "Scope — Dashboard" §6). */
export const RecentJobDtoSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: JobStatusSchema,
  subjectSlug: z.string().nullable(),
  subjectName: z.string().nullable(),
  createdAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  costEur: z.number().nullable(),
  errorMessage: z.string().nullable(),
});
export type RecentJobDto = z.infer<typeof RecentJobDtoSchema>;

/** Per-subject row for the "Flashcard per materia" tile. */
export const SubjectDueDtoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  color: SubjectColorSchema,
  documentCount: z.number().int(),
  nextExamAt: z.string().datetime().nullable(),
  dueCardsCount: z.number().int(),
});
export type SubjectDueDto = z.infer<typeof SubjectDueDtoSchema>;

export const NextExamDtoSchema = z.object({
  subjectSlug: z.string(),
  subjectName: z.string(),
  subjectColor: SubjectColorSchema,
  title: z.string(),
  date: z.string().datetime(),
});
export type NextExamDto = z.infer<typeof NextExamDtoSchema>;

/**
 * Dashboard home (docs/fasi/F7-dashboard-polish.md "Scope — Dashboard"):
 * the "riga stato" tiles, today's tasks, the 14-day strip and the activity
 * feed in one response. `averageMastery` is honestly `null` in practice —
 * nothing writes `topics.mastery` yet anywhere in the app (see
 * docs/fasi/F7-dashboard-polish.md "Stato").
 */
export const DashboardSummaryDtoSchema = z.object({
  subjectsCount: z.number().int(),
  daysToNextExam: z.number().int().nullable(),
  nextExam: NextExamDtoSchema.nullable(),
  minutesPlannedToday: z.number().int(),
  dueCardsCount: z.number().int(),
  averageMastery: z.number().nullable(),
  todayTasks: z.array(CalendarTaskDtoSchema),
  upcoming: CalendarRangeDtoSchema,
  subjects: z.array(SubjectDueDtoSchema),
  recentJobs: z.array(RecentJobDtoSchema),
});
export type DashboardSummaryDto = z.infer<typeof DashboardSummaryDtoSchema>;
