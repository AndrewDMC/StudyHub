import { z } from 'zod';
import { FlashcardDtoSchema } from './generation.js';

export const FsrsRatingSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type FsrsRatingInput = z.infer<typeof FsrsRatingSchema>;

export const SubmitReviewRequestSchema = z.object({
  rating: FsrsRatingSchema,
  elapsedMs: z.number().int().nonnegative(),
});
export type SubmitReviewRequest = z.infer<typeof SubmitReviewRequestSchema>;

export const SuspendFlashcardRequestSchema = z.object({ suspended: z.boolean() });
export type SuspendFlashcardRequest = z.infer<typeof SuspendFlashcardRequestSchema>;

export const FsrsCardStateSchema = z.enum(['new', 'learning', 'review', 'relearning']);

export const FlashcardStatsDtoSchema = z.object({
  countsByState: z.record(FsrsCardStateSchema, z.number().int().nonnegative()),
  suspendedCount: z.number().int().nonnegative(),
  forecast: z.array(z.object({ date: z.string(), count: z.number().int().nonnegative() })),
  atRiskForNextExam: z
    .object({
      examTitle: z.string(),
      examDate: z.string().datetime(),
      atRiskCount: z.number().int().nonnegative(),
      totalCount: z.number().int().nonnegative(),
    })
    .nullable(),
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
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(200).default(50),
});
export type ListFlashcardsQuery = z.infer<typeof ListFlashcardsQuerySchema>;

export const FlashcardPageDtoSchema = z.object({
  items: z.array(FlashcardDtoSchema),
  nextCursor: z.string().nullable(),
});
export type FlashcardPageDto = z.infer<typeof FlashcardPageDtoSchema>;
