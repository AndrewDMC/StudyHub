import { z } from 'zod';
import { FlashcardTypeSchema } from '@studyhub/ai';
import { FlashcardDtoSchema } from './generation.js';

export const FsrsRatingSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type FsrsRatingInput = z.infer<typeof FsrsRatingSchema>;

export const SubmitReviewRequestSchema = z.object({
  rating: FsrsRatingSchema,
  elapsedMs: z.number().int().nonnegative(),
  /** How sure the user was before seeing the answer: 1 non lo so · 2 forse · 3 lo so. Optional. */
  confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});
export type SubmitReviewRequest = z.infer<typeof SubmitReviewRequestSchema>;

export const SuspendFlashcardRequestSchema = z.object({ suspended: z.boolean() });
export type SuspendFlashcardRequest = z.infer<typeof SuspendFlashcardRequestSchema>;

export const FsrsCardStateSchema = z.enum(['new', 'learning', 'review', 'relearning']);

export const FlashcardStatsDtoSchema = z.object({
  countsByState: z.record(FsrsCardStateSchema, z.number().int().nonnegative()),
  suspendedCount: z.number().int().nonnegative(),
  /** Cards reported as low quality during review: out of the queue and of every count above. */
  flaggedCount: z.number().int().nonnegative(),
  forecast: z.array(z.object({ date: z.string(), count: z.number().int().nonnegative() })),
  atRiskForNextExam: z
    .object({
      examTitle: z.string(),
      examDate: z.string().datetime(),
      atRiskCount: z.number().int().nonnegative(),
      totalCount: z.number().int().nonnegative(),
    })
    .nullable(),
  /** Mastery heatmap: one cell per topic (docs/fasi/F4-flashcard.md "heatmap mastery per argomento"). */
  topicMastery: z.array(
    z.object({
      topicId: z.string().uuid(),
      name: z.string(),
      mastery: z.number().min(0).max(1).nullable(),
      cardCount: z.number().int().nonnegative(),
    }),
  ),
  /** Real vs predicted retention, from the reviews log ("curva di ritenzione reale vs prevista"). */
  retention: z.object({
    sampleCount: z.number().int().nonnegative(),
    buckets: z.array(
      z.object({
        from: z.number(),
        to: z.number(),
        predicted: z.number(),
        actual: z.number(),
        count: z.number().int().positive(),
      }),
    ),
  }),
});
export type FlashcardStatsDto = z.infer<typeof FlashcardStatsDtoSchema>;

/**
 * `GET /api/subjects/:slug/flashcards` (docs/fasi/F2-materie.md tab Flashcard: lista in sola
 * lettura + sospensione, l'editor in blocco resta F4). Cursor-based, newest first — the deck can
 * hold thousands of cards (docs/fasi/F2-materie.md "La pagina con 200 documenti e 2000 flashcard
 * resta reattiva").
 */
export const ListFlashcardsQuerySchema = z.object({
  topicId: z.string().uuid().optional(),
  state: FsrsCardStateSchema.optional(),
  suspended: z.boolean().optional(),
  flagged: z.boolean().optional(),
  deckId: z.string().uuid().optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(200).default(50),
});
export type ListFlashcardsQuery = z.infer<typeof ListFlashcardsQuerySchema>;

export const FlashcardPageDtoSchema = z.object({
  items: z.array(FlashcardDtoSchema),
  nextCursor: z.string().nullable(),
});
export type FlashcardPageDto = z.infer<typeof FlashcardPageDtoSchema>;

/**
 * Deck editor (docs/fasi/F4-flashcard.md "Editor deck": crea/modifica/sposta/elimina card, merge
 * di deck, tag).
 */
const TagSchema = z.string().trim().min(1).max(40);

export const CreateFlashcardRequestSchema = z.object({
  deckId: z.string().uuid(),
  type: FlashcardTypeSchema.default('basic'),
  front: z.string().trim().min(1, 'Il fronte non può essere vuoto'),
  back: z.string().trim().min(1, 'Il retro non può essere vuoto'),
  hint: z.string().nullable().optional(),
  topicId: z.string().uuid().nullable().optional(),
  tags: z.array(TagSchema).max(20).optional(),
});
export type CreateFlashcardRequest = z.infer<typeof CreateFlashcardRequestSchema>;

export const UpdateFlashcardRequestSchema = z
  .object({
    type: FlashcardTypeSchema,
    front: z.string().trim().min(1, 'Il fronte non può essere vuoto'),
    back: z.string().trim().min(1, 'Il retro non può essere vuoto'),
    hint: z.string().nullable(),
    topicId: z.string().uuid().nullable(),
    deckId: z.string().uuid(),
    tags: z.array(TagSchema).max(20),
    suspended: z.boolean(),
    /** true = "segnala card scadente" (excluded from the queue, collected); false = clear the flag. */
    flagged: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nessun campo da aggiornare' });
export type UpdateFlashcardRequest = z.infer<typeof UpdateFlashcardRequestSchema>;

export const BulkFlashcardsRequestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('delete') }),
    z.object({ type: z.literal('suspend'), suspended: z.boolean() }),
    z.object({ type: z.literal('move'), deckId: z.string().uuid() }),
    z.object({ type: z.literal('topic'), topicId: z.string().uuid().nullable() }),
    z.object({ type: z.literal('addTag'), tag: TagSchema }),
    z.object({ type: z.literal('removeTag'), tag: TagSchema }),
  ]),
});
export type BulkFlashcardsRequest = z.infer<typeof BulkFlashcardsRequestSchema>;

export const MergeDecksRequestSchema = z
  .object({ sourceDeckId: z.string().uuid(), targetDeckId: z.string().uuid() })
  .refine((v) => v.sourceDeckId !== v.targetDeckId, {
    message: 'Scegli due mazzi diversi',
  });
export type MergeDecksRequest = z.infer<typeof MergeDecksRequestSchema>;

/** Confidence vs. correctness in one subject (docs/06-miglioramenti.md #4). */
export const CalibrationLevelDtoSchema = z.object({
  confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  total: z.number().int(),
  correct: z.number().int(),
  accuracy: z.number().nullable(),
  reliable: z.boolean(),
});

export const CalibrationDtoSchema = z.object({
  total: z.number().int(),
  levels: z.array(CalibrationLevelDtoSchema),
  illusionRate: z.number().nullable(),
  hiddenKnowledgeRate: z.number().nullable(),
  bias: z.number().nullable(),
  verdict: z.enum(['overconfident', 'underconfident', 'calibrated', 'insufficient_data']),
  minSamplesPerLevel: z.number().int(),
  illusionByTopic: z.array(
    z.object({
      topicId: z.string().uuid(),
      name: z.string(),
      sure: z.number().int(),
      sureButWrong: z.number().int(),
      illusionRate: z.number(),
    }),
  ),
});
export type CalibrationDto = z.infer<typeof CalibrationDtoSchema>;
