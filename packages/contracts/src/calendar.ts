import { z } from 'zod';
import { SubjectColorSchema } from '@studyhub/core';
import { ExamKindSchema, ExamStatusSchema } from './exam.js';
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
  status: ExamStatusSchema,
  location: z.string().nullable(),
  description: z.string().nullable(),
});
export type CalendarExamDto = z.infer<typeof CalendarExamDtoSchema>;

/**
 * An external commitment imported from an .ics file (docs/04-planner.md §9.4: "vincoli in
 * ingresso per lo scheduler, non suoi output" — lectures, personal commitments; distinct from
 * `tasks`, which the Planner produces). This slice shows them on the calendar; it does not yet
 * subtract them from the Planner's capacity (docs/fasi/F6-planner-calendario.md "Stato").
 */
export const CalendarImportedEventDtoSchema = z.object({
  id: z.string().uuid(),
  date: z.string(),
  title: z.string(),
  description: z.string().nullable(),
});
export type CalendarImportedEventDto = z.infer<typeof CalendarImportedEventDtoSchema>;

export const CalendarRangeDtoSchema = z.object({
  tasks: z.array(CalendarTaskDtoSchema),
  exams: z.array(CalendarExamDtoSchema),
  importedEvents: z.array(CalendarImportedEventDtoSchema),
});
export type CalendarRangeDto = z.infer<typeof CalendarRangeDtoSchema>;

export const ImportIcsResponseSchema = z.object({
  imported: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
});
export type ImportIcsResponse = z.infer<typeof ImportIcsResponseSchema>;
