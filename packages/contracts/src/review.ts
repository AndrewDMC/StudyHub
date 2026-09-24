import { z } from 'zod';

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
