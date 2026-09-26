import { z } from 'zod';
import { ExamProfileSchema, SimulationItemKindSchema } from '@studyhub/ai';

/** Job: extract the exam profile from the subject's `esami` documents (or a chosen subset). */
export const ExtractExamProfileJobInputSchema = z.object({
  subjectId: z.string().uuid(),
  docIds: z.array(z.string().uuid()).optional(),
  model: z.string().optional(),
  /** Re-extract even over a user-edited profile. Default: an edited profile is never overwritten. */
  overwriteEdited: z.boolean().default(false),
  force: z.boolean().default(false),
});
export type ExtractExamProfileJobInput = z.infer<typeof ExtractExamProfileJobInputSchema>;

export const SimulationModeSchema = z.enum(['esame_completo', 'drill_argomento']);

export const GenerateSimulationJobInputSchema = z
  .object({
    subjectId: z.string().uuid(),
    mode: SimulationModeSchema,
    /** Study material the items come from. Omit to use every parsed non-`esami` document. */
    docIds: z.array(z.string().uuid()).optional(),
    topicId: z.string().uuid().optional(),
    itemCount: z.number().int().positive().max(30).optional(),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
    model: z.string().optional(),
    force: z.boolean().default(false),
  })
  .refine((v) => v.mode !== 'drill_argomento' || !!v.topicId, {
    message: 'Il drill richiede un argomento (topicId)',
  });
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

export const ExamProfileDtoSchema = z.object({
  id: z.string().uuid(),
  subjectId: z.string().uuid(),
  sourceDocIds: z.array(z.string().uuid()),
  profile: ExamProfileSchema,
  edited: z.boolean(),
  model: z.string(),
  promptVersion: z.string(),
  updatedAt: z.string().datetime(),
});
export type ExamProfileDto = z.infer<typeof ExamProfileDtoSchema>;

/** PATCH body: the user owns the profile after extraction (docs/fasi/F5 "Editabile dall'utente"). */
export const UpdateExamProfileRequestSchema = ExamProfileSchema;
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
  /** Best graded score so far, as a 0..1 ratio — for the trend view. */
  lastScoreRatio: z.number().nullable(),
  attemptCount: z.number().int(),
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
});
export type AttemptItemResultDto = z.infer<typeof AttemptItemResultDtoSchema>;
