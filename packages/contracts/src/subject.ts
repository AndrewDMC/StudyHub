import { z } from 'zod';
import { SubjectColorSchema } from '@studyhub/core';

/** POST /api/subjects request body. */
export const CreateSubjectRequestSchema = z.object({
  name: z.string().trim().min(1, 'Il nome è obbligatorio').max(120),
  color: SubjectColorSchema,
  professor: z.string().trim().min(1).max(120).optional(),
  cfu: z.number().int().positive().max(60).optional(),
});
export type CreateSubjectRequest = z.infer<typeof CreateSubjectRequestSchema>;

export const SubjectDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  color: SubjectColorSchema,
  professor: z.string().nullable(),
  cfu: z.number().nullable(),
  folderPath: z.string(),
  archivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type SubjectDto = z.infer<typeof SubjectDtoSchema>;

/** List-view aggregation (docs/fasi/F2-materie.md griglia Materie). */
export const SubjectSummaryDtoSchema = SubjectDtoSchema.extend({
  documentCount: z.number().int().nonnegative(),
  nextExamAt: z.string().datetime().nullable(),
  averageMastery: z.number().nullable(),
  dueCardsToday: z.number().int().nonnegative(),
  topicCoverage: z.number().nullable(),
});
export type SubjectSummaryDto = z.infer<typeof SubjectSummaryDtoSchema>;

export const UpdateSubjectRequestSchema = z.object({
  archived: z.boolean(),
});
export type UpdateSubjectRequest = z.infer<typeof UpdateSubjectRequestSchema>;
