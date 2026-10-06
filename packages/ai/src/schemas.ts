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

/**
 * `transcribe_schema` — vision transcription of a hand-drawn schema photo
 * into a flat, ordered list of blocks (docs/fasi/F1-ingest.md "Stato":
 * "schermata di verifica"). Deliberately no nodes/edges/coordinates: just
 * the transcribed text and how confident the model is, so a human can
 * review and correct it before it's trusted for anything downstream.
 */
export const SchemaBlockConfidenceSchema = z.enum(['ok', 'uncertain', 'illegible']);
export type SchemaBlockConfidence = z.infer<typeof SchemaBlockConfidenceSchema>;

export const TranscribedSchemaBlockSchema = z.object({
  text: z.string().min(1),
  confidence: SchemaBlockConfidenceSchema,
  /** Why it's uncertain/illegible — null for 'ok'. */
  note: z.string().nullable(),
});
export type TranscribedSchemaBlock = z.infer<typeof TranscribedSchemaBlockSchema>;

export const SchemaTranscriptionOutputSchema = z.object({
  blocks: z.array(TranscribedSchemaBlockSchema),
});
export type SchemaTranscriptionOutput = z.infer<typeof SchemaTranscriptionOutputSchema>;

/** docs/03-ai-e-worker.md §3.3. */
export const SummaryOutputSchema = z.object({
  markdown: z.string().min(1),
  glossary: z.array(z.object({ term: z.string().min(1), definition: z.string().min(1) })),
});
export type SummaryOutput = z.infer<typeof SummaryOutputSchema>;

/**
 * `prepare_session` (docs/08-sessione-di-studio.md §5.2): the key points to understand and the
 * exercises to practise on the session's material. Each item carries a `sourceRef` whose `quote`
 * is validated verbatim against the cited chunk in the worker, never trusted from the model.
 */
export const SessionKeyPointSchema = z.object({
  title: z.string().min(1),
  explanation: z.string().min(1),
  sourceRef: AiSourceRefSchema,
});
export type SessionKeyPoint = z.infer<typeof SessionKeyPointSchema>;

export const SessionExerciseSchema = z.object({
  prompt: z.string().min(1),
  solution: z.string().min(1),
  difficulty: z.number().int().min(1).max(3),
  sourceRef: AiSourceRefSchema,
});
export type SessionExercise = z.infer<typeof SessionExerciseSchema>;

export const SessionBriefingOutputSchema = z.object({
  keyPoints: z.array(SessionKeyPointSchema),
  exercises: z.array(SessionExerciseSchema),
});
export type SessionBriefingOutput = z.infer<typeof SessionBriefingOutputSchema>;

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
  /**
   * The subject topic this item belongs to, verbatim from the `topics` list
   * given in the prompt — `null` when none fits (docs/fasi/F5-esami-simulazioni.md
   * "Non implementato": tag dell'argomento sugli esercizi di una simulazione
   * completa). Matched to a `topicId` in the worker, not trusted as-is — a
   * name outside the given list is treated as no match, not rejected.
   */
  topicName: z.string().min(1).nullable(),
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

/**
 * `extract_topics` (docs/03-ai-e-worker.md §1, docs/fasi/F3-ai-core.md). One
 * proposed topic, grouping the documents (by their `docId`, echoed back from
 * the caller's input) it covers — validated against the requested scope in
 * the worker, never trusted verbatim (a hallucinated docId would otherwise
 * tag a document never sent to the model).
 */
export const ExtractedTopicSchema = z.object({
  name: z.string().min(1),
  docIds: z.array(z.string().uuid()).min(1),
  confidence: z.number().min(0).max(1),
  /**
   * Name of the parent topic, if this one is a sub-topic — either an existing
   * topic in the subject or another topic proposed in the same batch. `null`
   * (or omitted) means top-level. Validated against the caller's known names
   * in the worker, same "never trust verbatim" gate as `docIds`: a name that
   * doesn't resolve to a known topic is dropped, not trusted.
   */
  parentName: z.string().min(1).nullable().optional(),
});
export type ExtractedTopic = z.infer<typeof ExtractedTopicSchema>;

export const ExtractTopicsOutputSchema = z.object({
  topics: z.array(ExtractedTopicSchema),
});
export type ExtractTopicsOutput = z.infer<typeof ExtractTopicsOutputSchema>;

/**
 * `ocr_text` — plain-text reading of a printed (not hand-drawn) page image:
 * a scanned PDF page with no text layer, or an uploaded photo/scan. One
 * block per page/image, never structured/interpreted — same "mark it,
 * don't guess it" discipline as `transcribe_schema`.
 */
export const OcrConfidenceSchema = z.enum(['ok', 'uncertain', 'illegible']);
export type OcrConfidence = z.infer<typeof OcrConfidenceSchema>;

export const OcrTextOutputSchema = z.object({
  text: z.string(),
  confidence: OcrConfidenceSchema,
});
export type OcrTextOutput = z.infer<typeof OcrTextOutputSchema>;

/**
 * `classify_document_type` — a suggestion only (apps/worker/src/processors/
 * classifyDocumentType.ts never overrides a user-picked type), so low
 * confidence is expected and fine; the UI shows it as "AI: schemi (62%)"
 * with a one-click correction, not a silent auto-apply.
 */
export const DocumentTypeGuessSchema = z.enum(['appunti', 'schemi', 'esami', 'slide', 'altro']);
export type DocumentTypeGuess = z.infer<typeof DocumentTypeGuessSchema>;

export const ClassifyDocumentTypeOutputSchema = z.object({
  type: DocumentTypeGuessSchema,
  confidence: z.number().min(0).max(1),
});
export type ClassifyDocumentTypeOutput = z.infer<typeof ClassifyDocumentTypeOutputSchema>;

/**
 * `transcribe_schema` (v2, graph) — docs/07-markdown-layer.md §5.2. Replaces
 * the flat `SchemaTranscriptionOutput` above for newly (re)transcribed
 * documents (apps/worker/src/processors/transcribeSchema.ts); kept alongside
 * it, not instead of it, so a document transcribed under the old shape stays
 * readable until it's re-transcribed. Node/edge kinds are a **closed**
 * taxonomy on purpose (docs/07 §5.2: "altrimenti il modello si inventa i
 * tipi") — the worker generates `content.md`'s front-matter deterministically
 * from this structured output, never trusting raw markdown from the model.
 */
export const SchemaNodeKindSchema = z.enum([
  'concetto',
  'definizione',
  'formula',
  'principio',
  'grandezza',
  'caso',
  'esempio',
  'condizione',
  'conseguenza',
  'domanda',
]);
export type SchemaNodeKindGuess = z.infer<typeof SchemaNodeKindSchema>;

export const SchemaEdgeTypeSchema = z.enum([
  'implica',
  'causa',
  'composto-da',
  'esempio-di',
  'opposto-a',
  'precede',
  'dipende-da',
  'annota',
]);
export type SchemaEdgeTypeGuess = z.infer<typeof SchemaEdgeTypeSchema>;

export const SchemaGraphNodeConfidenceSchema = z.enum(['ok', 'uncertain', 'unreadable']);
export type SchemaGraphNodeConfidence = z.infer<typeof SchemaGraphNodeConfidenceSchema>;

/** `crop` is page-relative, normalized 0..1 (works regardless of the source image's pixel size). */
export const SchemaGraphNodeSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  kind: SchemaNodeKindSchema,
  crop: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      w: z.number().min(0).max(1),
      h: z.number().min(0).max(1),
    })
    .nullable(),
  confidence: SchemaGraphNodeConfidenceSchema,
});
export type SchemaGraphNode = z.infer<typeof SchemaGraphNodeSchema>;

export const SchemaGraphEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: SchemaEdgeTypeSchema,
  label: z.string().nullable(),
});
export type SchemaGraphEdge = z.infer<typeof SchemaGraphEdgeSchema>;

export const SchemaGraphGroupSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  nodeKeys: z.array(z.string().min(1)).min(1),
});
export type SchemaGraphGroup = z.infer<typeof SchemaGraphGroupSchema>;

export const SchemaGraphOutputSchema = z.object({
  nodes: z.array(SchemaGraphNodeSchema),
  edges: z.array(SchemaGraphEdgeSchema),
  groups: z.array(SchemaGraphGroupSchema),
});
export type SchemaGraphOutput = z.infer<typeof SchemaGraphOutputSchema>;

/**
 * `distill_handwriting_profile` — turns a batch of verification-screen
 * corrections into a handful of durable convention lines
 * (docs/07-markdown-layer.md §5.4b), e.g. "l'utente scrive Δ come una
 * lambda capovolta" — not a transcript of the corrections themselves.
 */
export const DistillHandwritingProfileOutputSchema = z.object({
  lines: z.array(z.string().min(1)),
});
export type DistillHandwritingProfileOutput = z.infer<typeof DistillHandwritingProfileOutputSchema>;

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
