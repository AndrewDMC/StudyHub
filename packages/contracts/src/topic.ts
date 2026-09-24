import { z } from 'zod';

export const TopicSourceSchema = z.enum(['ai', 'user']);

export const TopicDtoSchema = z.object({
  id: z.string().uuid(),
  subjectId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string(),
  slug: z.string(),
  orderIndex: z.number().int(),
  confidence: z.number().nullable(),
  source: TopicSourceSchema,
  mastery: z.number().nullable(),
  createdAt: z.string().datetime(),
});
export type TopicDto = z.infer<typeof TopicDtoSchema>;

export const CreateTopicRequestSchema = z.object({
  name: z.string().trim().min(1, 'Il nome è obbligatorio').max(200),
  parentId: z.string().uuid().nullable().optional(),
});
export type CreateTopicRequest = z.infer<typeof CreateTopicRequestSchema>;

export const UpdateTopicRequestSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  parentId: z.string().uuid().nullable().optional(),
});
export type UpdateTopicRequest = z.infer<typeof UpdateTopicRequestSchema>;

/**
 * "Unisco due argomenti duplicati: flashcard e chunk si riattaccano
 * correttamente" (docs/fasi/F2-materie.md, criterio di accettazione). The
 * topic in the URL is merged away *into* `intoTopicId`, which survives.
 */
export const MergeTopicsRequestSchema = z.object({
  intoTopicId: z.string().uuid(),
});
export type MergeTopicsRequest = z.infer<typeof MergeTopicsRequestSchema>;
