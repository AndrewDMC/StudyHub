import { z } from 'zod';
import { SubjectColorSchema } from '@studyhub/core';
import { ExamKindSchema } from './exam.js';
import { TaskDtoSchema } from './plan.js';

/**
 * Cross-subject calendar (docs/fasi/F6-planner-calendario.md "Scope": "overlay
 * multi-materia con colori identità"). Only tasks from *active* plans — a
 * `draft` is invisible outside its own review screen (docs/04-planner.md §9.1).
 */
export const CalendarTaskDtoSchema = TaskDtoSchema.extend({
  subjectSlug: z.string(),
  subjectName: z.string(),
  subjectColor: SubjectColorSchema,
});
export type CalendarTaskDto = z.infer<typeof CalendarTaskDtoSchema>;

/** Exams as milestones on the calendar (docs/fasi/F6-planner-calendario.md "Scope"). */
export const CalendarExamDtoSchema = z.object({
  id: z.string().uuid(),
  subjectSlug: z.string(),
  subjectName: z.string(),
  subjectColor: SubjectColorSchema,
  title: z.string(),
  kind: ExamKindSchema,
  date: z.string().datetime(),
});
export type CalendarExamDto = z.infer<typeof CalendarExamDtoSchema>;

export const CalendarRangeDtoSchema = z.object({
  tasks: z.array(CalendarTaskDtoSchema),
  exams: z.array(CalendarExamDtoSchema),
});
export type CalendarRangeDto = z.infer<typeof CalendarRangeDtoSchema>;
