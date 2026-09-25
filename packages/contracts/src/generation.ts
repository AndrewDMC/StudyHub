import { z } from 'zod';
import { FlashcardTypeSchema } from '@studyhub/ai';

/** docs/fasi/F3-ai-core.md scope: generate from specific documents or specific topics. */
export const GenerationScopeSchema = z
  .object({
    docIds: z.array(z.string().uuid()).optional(),
    topicIds: z.array(z.string().uuid()).optional(),
  })
  .refine((s) => (s.docIds && s.docIds.length > 0) || (s.topicIds && s.topicIds.length > 0), {
    message: 'Specifica almeno un documento o un argomento',
  });
export type GenerationScope = z.infer<typeof GenerationScopeSchema>;

export const GenerateFlashcardsJobInputSchema = z.object({
  subjectId: z.string().uuid(),
  scope: GenerationScopeSchema,
  count: z.union([z.literal('auto'), z.number().int().positive().max(200)]).default('auto'),
  types: z.array(FlashcardTypeSchema).min(1).default(['basic']),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  lang: z.string().default('it'),
  model: z.string().optional(),
  /** Bypasses the daily/monthly budget cap once, with an explicit ack (docs/fasi/F3 "Decisioni"). */
  force: z.boolean().default(false),
});
export type GenerateFlashcardsJobInput = z.infer<typeof GenerateFlashcardsJobInputSchema>;

export const GenerateSchemaJobInputSchema = z.object({
  subjectId: z.string().uuid(),
  scope: GenerationScopeSchema,
  depth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(2),
  style: z.enum(['gerarchico', 'mappa', 'timeline', 'confronto']).default('gerarchico'),
  model: z.string().optional(),
  force: z.boolean().default(false),
});
export type GenerateSchemaJobInput = z.infer<typeof GenerateSchemaJobInputSchema>;

export const GenerateSummaryJobInputSchema = z.object({
  subjectId: z.string().uuid(),
  scope: GenerationScopeSchema,
  length: z.enum(['flash', 'standard', 'esteso']).default('standard'),
  model: z.string().optional(),
  force: z.boolean().default(false),
});
export type GenerateSummaryJobInput = z.infer<typeof GenerateSummaryJobInputSchema>;

export const ArtifactKindSchema = z.enum([
  'flashcard_deck',
  'schema',
  'summary',
  'simulation',
  'drill',
]);
export const ArtifactStatusSchema = z.enum(['draft', 'approved', 'archived']);

export const ArtifactDtoSchema = z.object({
  id: z.string().uuid(),
  subjectId: z.string().uuid(),
  kind: ArtifactKindSchema,
  title: z.string(),
  path: z.string(),
  status: ArtifactStatusSchema,
  model: z.string(),
  promptVersion: z.string(),
  costEur: z.number().nullable(),
  createdAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
});
export type ArtifactDto = z.infer<typeof ArtifactDtoSchema>;

export const FlashcardDtoSchema = z.object({
  id: z.string().uuid(),
  deckId: z.string().uuid(),
  topicId: z.string().uuid().nullable(),
  type: FlashcardTypeSchema,
  front: z.string(),
  back: z.string(),
  hint: z.string().nullable(),
  sourceRef: z.object({ docId: z.string().uuid(), page: z.number().int(), quote: z.string() }),
  state: z.enum(['new', 'learning', 'review', 'relearning']),
  suspended: z.boolean(),
  createdAt: z.string().datetime(),
});
export type FlashcardDto = z.infer<typeof FlashcardDtoSchema>;

export const ReviewFlashcardRequestSchema = z.object({
  action: z.enum(['approve', 'discard', 'edit']),
  front: z.string().min(1).optional(),
  back: z.string().min(1).optional(),
});
export type ReviewFlashcardRequest = z.infer<typeof ReviewFlashcardRequestSchema>;
