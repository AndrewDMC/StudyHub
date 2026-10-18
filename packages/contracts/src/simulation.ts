import { z } from 'zod';
import { ExamProfileSchema, SimulationItemKindSchema } from '@studyhub/ai';
import { SIMULATION_DRILL_MAX_TOPICS } from '@studyhub/core';

/** Job: extract the exam profile from the subject's `esami` documents (or a chosen subset). */
export const ExtractExamProfileJobInputSchema = z.object({
  subjectId: z.string().uuid(),
  docIds: z.array(z.string().uuid()).optional(),
  model: z.string().optional(),
  /** Re-extract even over a user-edited profile. Default: an edited profile is never overwritten. */
  overwriteEdited: z.boolean().default(false),
  force: z.boolean().default(false),
  /**
   * Also send the past exams' pages as images (figures, graphs and layout the extracted text
   * loses — docs/fasi/F5 "Rischi"). Costs more, so it is opt-in.
   */
  useImages: z.boolean().default(false),
});
export type ExtractExamProfileJobInput = z.infer<typeof ExtractExamProfileJobInputSchema>;

export const SimulationModeSchema = z.enum(['esame_completo', 'drill_argomento']);

// Lives in @studyhub/core (browser-safe) so clients can import it; re-exported here for servers.
export { SIMULATION_DRILL_MAX_TOPICS };

/** Topics of a drill: `topicId` (legacy, single) and/or `topicIds`, deduplicated. The one place that merges them. */
export function resolveSimulationTopicIds(v: {
  topicId?: string | undefined;
  topicIds?: string[] | undefined;
}): string[] {
  return [...new Set([...(v.topicIds ?? []), ...(v.topicId ? [v.topicId] : [])])];
}

export const GenerateSimulationJobBaseSchema = z.object({
  subjectId: z.string().uuid(),
  mode: SimulationModeSchema,
  /** Study material the items come from. Omit to use every parsed non-`esami` document. */
  docIds: z.array(z.string().uuid()).optional(),
  /** Single topic of a drill (legacy). Equivalent to `topicIds: [topicId]`; see `resolveSimulationTopicIds`. */
  topicId: z.string().uuid().optional(),
  /** Topics of a drill (1..5). */
  topicIds: z.array(z.string().uuid()).min(1).max(SIMULATION_DRILL_MAX_TOPICS).optional(),
  itemCount: z.number().int().positive().max(30).optional(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  model: z.string().optional(),
  force: z.boolean().default(false),
});

/** Cross-field rule shared by the job input and the HTTP request. */
export function refineSimulationTopics<
  T extends { mode: string; topicId?: string | undefined; topicIds?: string[] | undefined },
>(v: T, ctx: z.RefinementCtx): void {
  if (v.mode !== 'drill_argomento') {
    if (v.topicIds && v.topicIds.length > 1) {
      ctx.addIssue({ code: 'custom', message: 'Più argomenti sono ammessi solo nel drill' });
    }
    return;
  }
  const ids = resolveSimulationTopicIds(v);
  if (ids.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'Il drill richiede un argomento (topicIds)' });
  } else if (ids.length > SIMULATION_DRILL_MAX_TOPICS) {
    ctx.addIssue({
      code: 'custom',
      message: `Il drill accetta al massimo ${SIMULATION_DRILL_MAX_TOPICS} argomenti`,
    });
  }
}

export const GenerateSimulationJobInputSchema =
  GenerateSimulationJobBaseSchema.superRefine(refineSimulationTopics);
export type GenerateSimulationJobInput = z.infer<typeof GenerateSimulationJobInputSchema>;

export const GradeAttemptJobInputSchema = z.object({
  attemptId: z.string().uuid(),
  model: z.string().optional(),
  force: z.boolean().default(false),
});
export type GradeAttemptJobInput = z.infer<typeof GradeAttemptJobInputSchema>;

/** "Seconda opinione con modello superiore su singolo item" (docs/fasi/F5-esami-simulazioni.md "Rischi"). */
export const GradeItemSecondOpinionJobInputSchema = z.object({
  attemptId: z.string().uuid(),
  itemId: z.string().uuid(),
  model: z.string().optional(),
  force: z.boolean().default(false),
});
export type GradeItemSecondOpinionJobInput = z.infer<typeof GradeItemSecondOpinionJobInputSchema>;

/**
 * A recurring exam topic with how many times it came up (`null` = unknown). Profiles saved
 * before counts existed hold plain strings: the preprocess turns them into `{ name, count: null }`.
 */
export const RecurringTopicSchema = z.preprocess(
  (v) => (typeof v === 'string' ? { name: v, count: null } : v),
  z.object({
    name: z.string().trim().min(1),
    count: z.number().int().positive().nullable(),
  }),
);
export type RecurringTopic = z.infer<typeof RecurringTopicSchema>;

/** The stored/edited profile: `ExamProfileSchema` with the `{ name, count }` recurring topics. */
export const ExamProfileDataSchema = ExamProfileSchema.extend({
  recurringTopics: z.array(RecurringTopicSchema),
});
export type ExamProfileData = z.infer<typeof ExamProfileDataSchema>;

export const ExamProfileDtoSchema = z.object({
  id: z.string().uuid(),
  subjectId: z.string().uuid(),
  sourceDocIds: z.array(z.string().uuid()),
  profile: ExamProfileDataSchema,
  edited: z.boolean(),
  model: z.string(),
  promptVersion: z.string(),
  updatedAt: z.string().datetime(),
});
export type ExamProfileDto = z.infer<typeof ExamProfileDtoSchema>;

/** PATCH body: the user owns the profile after extraction (docs/fasi/F5 "Editabile dall'utente"). */
export const UpdateExamProfileRequestSchema = ExamProfileDataSchema;
export type UpdateExamProfileRequest = z.infer<typeof UpdateExamProfileRequestSchema>;

export const SimulationSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  mode: SimulationModeSchema,
  topicId: z.string().uuid().nullable(),
  timeBudgetMin: z.number().int(),
  totalPoints: z.number(),
  itemCount: z.number().int(),
  createdAt: z.string().datetime(),
  /** Score of the most recent graded attempt, as a 0..1 ratio — for the trend view. */
  lastScoreRatio: z.number().nullable(),
  attemptCount: z.number().int(),
  /** Most recent in-progress attempt ("Riprendi"), null if none. */
  openAttemptId: z.string().uuid().nullable(),
  /** Most recent submitted/graded attempt ("Vedi la correzione"), null if none. */
  lastAttemptId: z.string().uuid().nullable(),
  /** When the most recent graded attempt was graded, null if none. */
  lastGradedAt: z.string().datetime().nullable().default(null),
});
export type SimulationSummaryDto = z.infer<typeof SimulationSummaryDtoSchema>;

/**
 * An item as shown *during* an attempt: no solution, no rubric, no expected
 * points — "niente aiuti AI durante" (docs/fasi/F5 Modalità Esame).
 */
export const ExamItemDtoSchema = z.object({
  id: z.string().uuid(),
  ord: z.number().int(),
  prompt: z.string(),
  kind: SimulationItemKindSchema,
  points: z.number(),
});
export type ExamItemDto = z.infer<typeof ExamItemDtoSchema>;

/** Photo of a handwritten answer attached to one exercise of an attempt. */
// Constants live in @studyhub/core (browser-safe): clients must not import runtime values from here.
export {
  ATTEMPT_PHOTO_MIMES,
  ATTEMPT_PHOTO_MAX_BYTES,
  ATTEMPT_PHOTO_MAX_PER_ITEM,
} from '@studyhub/core';

export const AttemptAnswerPhotoDtoSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  /** OCR state used by the grader: null = not transcribed yet. */
  transcriptStatus: z.enum(['ok', 'illegible', 'failed']).nullable().default(null),
  /** `GET /api/subjects/<slug>/attempts/<attemptId>/items/<itemId>/photos/<id>/file` */
  url: z.string(),
});
export type AttemptAnswerPhotoDto = z.infer<typeof AttemptAnswerPhotoDtoSchema>;

export const AttemptStatusSchema = z.enum(['in_progress', 'submitted', 'graded']);

export const AttemptDtoSchema = z.object({
  id: z.string().uuid(),
  simulationId: z.string().uuid(),
  status: AttemptStatusSchema,
  startedAt: z.string().datetime(),
  durationMin: z.number().int(),
  /** Always computed server-side from `startedAt` — the reload-safe timer. */
  remainingSeconds: z.number().int().nonnegative(),
  answers: z.record(z.string(), z.string()),
  items: z.array(ExamItemDtoSchema),
  totalAwarded: z.number().nullable(),
  totalMax: z.number().nullable(),
  weakTopics: z.array(z.string()).nullable(),
  /** itemId -> photos attached to that exercise (oldest first); items without photos are absent. */
  photos: z.record(z.string(), z.array(AttemptAnswerPhotoDtoSchema)).default({}),
});
export type AttemptDto = z.infer<typeof AttemptDtoSchema>;

export const SaveAnswersRequestSchema = z.object({
  answers: z.record(z.string().uuid(), z.string().max(20_000)),
});
export type SaveAnswersRequest = z.infer<typeof SaveAnswersRequestSchema>;

const GradedCriterionDtoSchema = z.object({
  criterion: z.string(),
  awarded: z.number(),
  max: z.number(),
  feedback: z.string(),
});

export const SecondOpinionDtoSchema = z.object({
  model: z.string(),
  awarded: z.number(),
  criteria: z.array(GradedCriterionDtoSchema),
  missing: z.array(z.string()),
  at: z.string().datetime(),
});
export type SecondOpinionDto = z.infer<typeof SecondOpinionDtoSchema>;

export const AttemptItemResultDtoSchema = z.object({
  itemId: z.string().uuid(),
  ord: z.number().int(),
  prompt: z.string(),
  answer: z.string(),
  awarded: z.number(),
  max: z.number(),
  criteria: z.array(GradedCriterionDtoSchema),
  missing: z.array(z.string()),
  solution: z.string(),
  sourceRef: z.object({ docId: z.string().uuid(), page: z.number().int(), quote: z.string() }),
  /** On-demand re-grade with a stronger model — alongside the original, never replacing it. */
  secondOpinion: SecondOpinionDtoSchema.nullable(),
  /** Photos attached to the answer (oldest first). */
  photos: z.array(AttemptAnswerPhotoDtoSchema).default([]),
});
export type AttemptItemResultDto = z.infer<typeof AttemptItemResultDtoSchema>;

/** One graded attempt's score on one topic — a point on the per-topic trend line. */
export const TopicTrendPointSchema = z.object({
  attemptId: z.string().uuid(),
  simulationId: z.string().uuid(),
  simulationTitle: z.string(),
  gradedAt: z.string().datetime(),
  awarded: z.number(),
  max: z.number(),
  /** awarded / max, 0..1. */
  ratio: z.number(),
});
export type TopicTrendPoint = z.infer<typeof TopicTrendPointSchema>;

export const TopicTrendDtoSchema = z.object({
  topicId: z.string().uuid(),
  name: z.string(),
  /** Oldest first. */
  points: z.array(TopicTrendPointSchema),
  /** Last point's ratio minus the first's; null with fewer than two points. */
  delta: z.number().nullable(),
});
export type TopicTrendDto = z.infer<typeof TopicTrendDtoSchema>;
