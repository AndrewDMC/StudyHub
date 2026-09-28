import { z } from 'zod';
import { JobStatusSchema, JobTypeSchema } from './job.js';
import { DocumentTypeSchema } from './document.js';

/**
 * Panoramica tab (docs/fasi/F2-materie.md "Centro ... La Panoramica è la vista di default:
 * prossimo esame, 3 azioni consigliate, attività recente, gap rilevati"). Deterministic rules,
 * not AI — see `apps/web/src/lib/overview.ts` for why each one applies.
 */
export const SuggestedActionKindSchema = z.enum([
  'review',
  'drill',
  'verify',
  'generate_plan',
  'tag',
]);
export type SuggestedActionKind = z.infer<typeof SuggestedActionKindSchema>;

export const SuggestedActionDtoSchema = z.object({
  kind: SuggestedActionKindSchema,
  label: z.string(),
  description: z.string(),
  href: z.string(),
});
export type SuggestedActionDto = z.infer<typeof SuggestedActionDtoSchema>;

/** One row of the last 7 days' activity — a job, a flashcard review, or a document upload. */
export const RecentActivityItemDtoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('job'),
    id: z.string().uuid(),
    jobType: JobTypeSchema,
    status: JobStatusSchema,
    timestamp: z.string().datetime(),
  }),
  z.object({
    kind: z.literal('review'),
    id: z.string().uuid(),
    rating: z.number().int().min(1).max(4),
    timestamp: z.string().datetime(),
  }),
  z.object({
    kind: z.literal('upload'),
    id: z.string().uuid(),
    documentName: z.string(),
    documentType: DocumentTypeSchema,
    timestamp: z.string().datetime(),
  }),
]);
export type RecentActivityItemDto = z.infer<typeof RecentActivityItemDtoSchema>;

/** A detected shortfall on one topic — informational, distinct from `suggestedActions`' single CTA per kind. */
export const GapKindSchema = z.enum([
  'topic_without_documents',
  'topic_without_flashcards',
  'low_mastery',
]);
export type GapKind = z.infer<typeof GapKindSchema>;

export const GapDtoSchema = z.object({
  kind: GapKindSchema,
  topicId: z.string().uuid(),
  topicName: z.string(),
  message: z.string(),
});
export type GapDto = z.infer<typeof GapDtoSchema>;

export const SubjectOverviewDtoSchema = z.object({
  suggestedActions: z.array(SuggestedActionDtoSchema).max(3),
  recentActivity: z.array(RecentActivityItemDtoSchema),
  gaps: z.array(GapDtoSchema),
});
export type SubjectOverviewDto = z.infer<typeof SubjectOverviewDtoSchema>;
