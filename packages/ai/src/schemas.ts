import { z } from 'zod';

/** docs/03-ai-e-worker.md §3.1. `quote` must be verbatim from the cited chunk — validated
 * programmatically in `functions/generateFlashcards.ts`, not trusted from the model. */
export const FlashcardTypeSchema = z.enum(['basic', 'cloze', 'qa', 'formula']);
export type FlashcardType = z.infer<typeof FlashcardTypeSchema>;

export const AiSourceRefSchema = z.object({
  docId: z.string().uuid(),
  page: z.number().int().positive(),
  quote: z.string().min(1),
});
export type AiSourceRef = z.infer<typeof AiSourceRefSchema>;

export const GeneratedFlashcardSchema = z.object({
  type: FlashcardTypeSchema,
  front: z.string().min(1),
  back: z.string().min(1),
  hint: z.string().optional(),
  sourceRef: AiSourceRefSchema,
});
export type GeneratedFlashcard = z.infer<typeof GeneratedFlashcardSchema>;

export const FlashcardsOutputSchema = z.object({
  cards: z.array(GeneratedFlashcardSchema),
});
export type FlashcardsOutput = z.infer<typeof FlashcardsOutputSchema>;

/**
 * `generate_schema` (docs/03-ai-e-worker.md §3.2). One node of the schema —
 * `nodeId` is whatever short id the model assigns it (referenced from
 * `mermaid` and from `markdown`'s own headings/list items), `sourceRef.quote`
 * is validated verbatim against the cited chunk just like a flashcard's, so
 * a schema can't invent structure the material doesn't support.
 */
export const SchemaNodeSchema = z.object({
  nodeId: z.string().min(1),
  label: z.string().min(1),
  sourceRef: AiSourceRefSchema,
});
export type SchemaNode = z.infer<typeof SchemaNodeSchema>;

export const SchemaOutputSchema = z.object({
  markdown: z.string().min(1),
  /** Mermaid diagram body (no ```mermaid fence) — optional, e.g. a 'confronto' style may be prose-only. */
  mermaid: z.string().optional(),
  nodes: z.array(SchemaNodeSchema).min(1),
});
export type SchemaOutput = z.infer<typeof SchemaOutputSchema>;

/** docs/03-ai-e-worker.md §3.3. */
export const SummaryOutputSchema = z.object({
  markdown: z.string().min(1),
  glossary: z.array(z.object({ term: z.string().min(1), definition: z.string().min(1) })),
});
export type SummaryOutput = z.infer<typeof SummaryOutputSchema>;

/** docs/03-ai-e-worker.md §2 "esami" + §3.4: `kind` is a closed taxonomy. */
export const SimulationItemKindSchema = z.enum(['open', 'mcq', 'numeric', 'proof']);
export type SimulationItemKind = z.infer<typeof SimulationItemKindSchema>;

/**
 * `exam_profile` (docs/03-ai-e-worker.md §2, docs/fasi/F5-esami-simulazioni.md):
 * how *this* course examines — structure, item kinds, weights, timing.
 * User-editable after extraction, so every field is plain data.
 */
export const ExamProfileSchema = z.object({
  itemCount: z.number().int().positive(),
  durationMin: z.number().int().positive(),
  totalPoints: z.number().positive(),
  kindDistribution: z.record(SimulationItemKindSchema, z.number().min(0).max(1)),
  avgMinutesPerItem: z.number().positive(),
  verbosity: z.enum(['breve', 'media', 'estesa']),
  recurringTopics: z.array(z.string().min(1)),
  notes: z.string(),
});
export type ExamProfile = z.infer<typeof ExamProfileSchema>;

export const RubricCriterionSchema = z.object({
  criterion: z.string().min(1),
  points: z.number().positive(),
});
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

/**
 * One simulation item. The rubric is generated *with* the item, not after
 * (docs/fasi/F5 "Decisioni") — so what's asked and what's graded can't drift.
 * Rubric points must sum to `points`; validated in the worker, not trusted.
 */
export const SimulationItemSchema = z.object({
  prompt: z.string().min(1),
  kind: SimulationItemKindSchema,
  points: z.number().positive(),
  expectedPoints: z.array(z.string().min(1)).min(1),
  rubric: z.array(RubricCriterionSchema).min(1),
  solution: z.string().min(1),
  sourceRef: AiSourceRefSchema,
});
export type SimulationItem = z.infer<typeof SimulationItemSchema>;

export const SimulationOutputSchema = z.object({
  items: z.array(SimulationItemSchema).min(1),
  timeBudgetMin: z.number().int().positive(),
});
export type SimulationOutput = z.infer<typeof SimulationOutputSchema>;

/**
 * Formative grading (docs/fasi/F5 "Decisioni": "niente voto secco"): a score
 * per rubric criterion, what was missing, and where to re-study.
 */
/**
 * `estimate_topics` (docs/04-planner.md §3 "Fase A — Analisi AI"): per-unit
 * study-load estimate the Planner's Fase B (pure scheduling, `packages/core/src/planner`)
 * consumes as `PlannerTopic.{estimatedMinutes,difficulty,examWeight,prerequisites}`.
 * `key` echoes back the caller's own identifier for the unit (a document id in
 * this slice — see docs/fasi/F6 "Stato") so the response can be matched
 * without relying on array order.
 */
export const TopicEstimateSchema = z.object({
  key: z.string().min(1),
  estimatedMinutes: z.number().int().positive(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  examWeight: z.number().min(0).max(1),
  prerequisites: z.array(z.string()),
});
export type TopicEstimate = z.infer<typeof TopicEstimateSchema>;

export const EstimateTopicsOutputSchema = z.object({
  topics: z.array(TopicEstimateSchema),
});
export type EstimateTopicsOutput = z.infer<typeof EstimateTopicsOutputSchema>;

export const GradeOutputSchema = z.object({
  criteria: z.array(
    z.object({
      criterion: z.string().min(1),
      awarded: z.number().min(0),
      max: z.number().positive(),
      feedback: z.string().min(1),
    }),
  ),
  missing: z.array(z.string()),
});
export type GradeOutput = z.infer<typeof GradeOutputSchema>;
