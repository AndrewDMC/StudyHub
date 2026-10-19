import { z } from 'zod';
import { FlashcardTypeSchema } from '@studyhub/ai';
import { SubjectColorSchema } from '@studyhub/core';
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
  /** A topic id, or the literal 'none' = only cards without a topic. */
  topicId: z.union([z.string().uuid(), z.literal('none')]).optional(),
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

/**
 * `sort_flashcards`: assigns a topic to flashcards that have none (cardIds omitted = every
 * unsorted card of the subject). Never creates topics.
 */
export const SortFlashcardsJobInputSchema = z.object({
  subjectId: z.string().uuid(),
  cardIds: z.array(z.string().uuid()).min(1).optional(),
});
export type SortFlashcardsJobInput = z.infer<typeof SortFlashcardsJobInputSchema>;

/** Output of a finished `sort_flashcards` job. `noTopics` = subject has no topics, AI not called. */
export const SortFlashcardsOutputSchema = z.object({
  assigned: z.number().int(),
  assignedByDocument: z.number().int(),
  assignedByAi: z.number().int(),
  unassigned: z.number().int(),
  noTopics: z.boolean(),
});
export type SortFlashcardsOutput = z.infer<typeof SortFlashcardsOutputSchema>;

/** `POST /api/subjects/:slug/flashcards/sort` response. */
export const SortFlashcardsEnqueuedSchema = z.object({ jobId: z.string() });
export type SortFlashcardsEnqueued = z.infer<typeof SortFlashcardsEnqueuedSchema>;

/** Body of the 409 from POST .../flashcards/sort: `jobId` = the sort already queued/running, to attach to. */
export const SortFlashcardsConflictSchema = z.object({
  error: z.object({
    code: z.literal('conflict'),
    message: z.string(),
    jobId: z.string().optional(),
  }),
});
export type SortFlashcardsConflict = z.infer<typeof SortFlashcardsConflictSchema>;

/** `GET /api/subjects/:slug/flashcards/sort/:jobId` (same shape as topics/extract/:jobId). */
export const SortFlashcardsStatusSchema = z.object({
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  output: SortFlashcardsOutputSchema.nullable().optional(),
  error: z.string().nullable().optional(),
});
export type SortFlashcardsStatus = z.infer<typeof SortFlashcardsStatusSchema>;

/** `GET /api/subjects/:slug/flashcards/groups`: one group per topic with cards; `topicId: null` = unsorted. */
export const DeckGroupDtoSchema = z.object({
  topicId: z.string().uuid().nullable(),
  topicName: z.string().nullable(),
  parentTopicId: z.string().uuid().nullable(),
  total: z.number().int(),
  due: z.number().int(),
  new: z.number().int(),
  suspended: z.number().int(),
});
export type DeckGroupDto = z.infer<typeof DeckGroupDtoSchema>;

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

/**
 * Ripasso rapido (docs/09-ripasso-mobile.md §B2). Counts follow the same rule as the queue:
 * not suspended, not flagged, active subject; new cards (at most `newLimit` per subject), review
 * cards due by the end of today, learning cards due by now. In a subject with an active plan a new
 * card counts only if its lesson is done or scheduled today (started cards are unaffected).
 */
export const ReviewOverviewTopicDtoSchema = z.object({
  /** null = the "Senza argomento" row: cards not tagged with any topic. */
  id: z.string().uuid().nullable(),
  name: z.string(),
  mastery: z.number().min(0).max(1).nullable(),
  due: z.number().int().nonnegative(),
  /** Reviewable cards in the topic, due or not: 0 means there is nothing to review here at all. */
  cardCount: z.number().int().nonnegative(),
});
export type ReviewOverviewTopicDto = z.infer<typeof ReviewOverviewTopicDtoSchema>;

export const ReviewOverviewSubjectDtoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  color: SubjectColorSchema,
  nextExam: z.object({ title: z.string(), date: z.string().datetime() }).nullable(),
  due: z.number().int().nonnegative(),
  /** Minuti stimati per ripassare le `due` card ("~ N min"), dai tempi reali dell'utente. */
  estimatedMinutes: z.number().int().nonnegative().default(0),
  cardCount: z.number().int().nonnegative(),
  topics: z.array(ReviewOverviewTopicDtoSchema),
});
export type ReviewOverviewSubjectDto = z.infer<typeof ReviewOverviewSubjectDtoSchema>;

export const ReviewOverviewDtoSchema = z.object({
  totalDue: z.number().int().nonnegative(),
  totalCards: z.number().int().nonnegative(),
  /** Minuti stimati per ripassare tutte le `totalDue` card. */
  estimatedMinutes: z.number().int().nonnegative().default(0),
  /** Tempo medio per card (ms) usato per la stima: dallo storico, o il default se è troppo corto. */
  avgMsPerCard: z.number().int().positive().default(20000),
  /** Earliest future due date among cards not due today, for the "niente da ripassare" state. */
  nextDueAt: z.string().datetime().nullable(),
  subjects: z.array(ReviewOverviewSubjectDtoSchema),
});
export type ReviewOverviewDto = z.infer<typeof ReviewOverviewDtoSchema>;

/** ms from now that each rating would schedule the card (Again, Hard, Good, Easy). */
export const RatingIntervalsSchema = z.object({
  1: z.number().nonnegative(),
  2: z.number().nonnegative(),
  3: z.number().nonnegative(),
  4: z.number().nonnegative(),
});
export type RatingIntervals = z.infer<typeof RatingIntervalsSchema>;

/** `GET /api/review/queue?materia=&argomento=&task=&n=`; `argomento=none` = cards without a topic. */
export const ReviewQueueQuerySchema = z.object({
  materia: z.string().min(1).optional(),
  argomento: z.union([z.string().uuid(), z.literal('none')]).optional(),
  /** A plan task (lesson): its attached reviewable cards, due or not. Wins over `argomento`. */
  task: z.string().uuid().optional(),
  n: z.coerce.number().int().positive().max(500).optional(),
});
export type ReviewQueueQuery = z.infer<typeof ReviewQueueQuerySchema>;

export const ReviewQueueItemDtoSchema = FlashcardDtoSchema.extend({
  subjectSlug: z.string(),
  subjectName: z.string(),
  subjectColor: SubjectColorSchema,
  topicName: z.string().nullable(),
  intervals: RatingIntervalsSchema,
});
export type ReviewQueueItemDto = z.infer<typeof ReviewQueueItemDtoSchema>;

/** `POST /api/subjects/:slug/review/:cardId` response. */
export const SubmitReviewResponseSchema = z.object({
  flashcard: FlashcardDtoSchema,
  /** For `DELETE /api/review/:reviewId` (undo). */
  reviewId: z.string().uuid(),
  dueAt: z.string().datetime(),
  /** Previews for the card's next review, for a card re-queued in the same session. */
  intervals: RatingIntervalsSchema,
});
export type SubmitReviewResponse = z.infer<typeof SubmitReviewResponseSchema>;
