import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * pgvector's `vector(n)` type — drizzle-orm has no built-in column for it.
 * Stored/read as a plain number[] on the JS side; `toDriver` formats it as
 * pgvector's literal syntax (`[0.1,0.2,...]`), `fromDriver` parses it back.
 * Dimension fixed at 384 (`Xenova/all-MiniLM-L6-v2`, packages/ai/src/embeddings.ts).
 */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(384)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(',').map(Number);
  },
});

/**
 * F0 scope only: `subjects`, `jobs`, `settings` (docs/fasi/F0-fondamenta.md).
 * The DB is an index over the filesystem, not the source of truth for file
 * existence (docs/01-architettura.md §1, "Ordine di verità").
 */
export const subjects = pgTable('subjects', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  professor: text('professor'),
  cfu: integer('cfu'),
  folderPath: text('folder_path').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  // User-controlled display order in the Materie grid (docs/fasi/F2-materie.md "riordina").
  // Assigned max+1 at creation, reassigned wholesale by `reorderSubjects`; ties break on `name`.
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobCost {
  inputTokens: number;
  outputTokens: number;
  eur: number;
}

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey(),
    type: text('type').notNull(),
    // Nullable: some F0 jobs (e.g. a full reconcile) are not scoped to one subject.
    subjectId: uuid('subject_id').references(() => subjects.id, { onDelete: 'cascade' }),
    status: text('status').$type<JobStatus>().notNull().default('queued'),
    input: jsonb('input'),
    output: jsonb('output'),
    progressPct: integer('progress_pct').notNull().default(0),
    progressStep: text('progress_step'),
    error: jsonb('error'),
    cost: jsonb('cost').$type<JobCost>(),
    // hash(type + scope + promptVersion + model) — F3 idempotency
    // (docs/fasi/F3-ai-core.md "Decisioni"): re-running the same job returns
    // the existing artifact instead of re-spending. Null for non-AI job types.
    jobKey: text('job_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [index('jobs_job_key_idx').on(table.jobKey)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

/**
 * F1 scope (docs/fasi/F1-ingest.md), deterministic slice only: upload, dedup,
 * text extraction for text-layer PDFs, page-based chunking, Italian FTS.
 * NOT implemented here (needs an AI provider or a local embedding model —
 * see docs/fasi/F1-ingest.md "Stato" addendum): OCR, vision transcription,
 * AI type pre-classification, topics/mastery, vector embeddings.
 */
export type DocumentType = 'appunti' | 'schemi' | 'esami' | 'slide' | 'altro';
export type DocumentStatus = 'uploaded' | 'parsing' | 'parsed' | 'failed' | 'missing';
export type VerificationStatus = 'not_required' | 'pending' | 'partial' | 'verified';
export type DocumentTypeSource = 'user' | 'ai';

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey(),
  subjectId: uuid('subject_id')
    .notNull()
    .references(() => subjects.id, { onDelete: 'cascade' }),
  type: text('type').$type<DocumentType>().notNull(),
  // Set by `classify_document_type` right after upload — never overrides a
  // type the user picked explicitly, only annotates confidence in it/a
  // suggestion (apps/worker/src/processors/classifyDocumentType.ts).
  typeSource: text('type_source').$type<DocumentTypeSource>().notNull().default('user'),
  typeConfidence: real('type_confidence'),
  // The AI's own guess, kept separate from `type` (the user's actual choice)
  // so a disagreement can be shown as a one-click suggestion, never applied
  // automatically (apps/worker/src/processors/classifyDocumentType.ts).
  typeSuggested: text('type_suggested').$type<DocumentType>(),
  originalName: text('original_name').notNull(),
  storedPath: text('stored_path').notNull(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  sha256: text('sha256').notNull(),
  pages: integer('pages'),
  status: text('status').$type<DocumentStatus>().notNull().default('uploaded'),
  lang: text('lang'),
  // Markdown-layer tracking (docs/02-filesystem-e-dati.md §6.2).
  mdPath: text('md_path'),
  mdEdited: boolean('md_edited').notNull().default(false),
  mdConfidence: real('md_confidence'),
  // Set when a re-ingest finds `mdEdited=true`: the fresh output was written
  // to `content.new.md` instead of overwriting the user's edit
  // (apps/web/src/lib/documentContent.ts "stickiness").
  mdConflict: boolean('md_conflict').notNull().default(false),
  verificationStatus: text('verification_status')
    .$type<VerificationStatus>()
    .notNull()
    .default('not_required'),
  blockedBlocks: integer('blocked_blocks').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  ingestedAt: timestamp('ingested_at', { withTimezone: true }),
});

/**
 * `transcribe_schema` output (docs/fasi/F1-ingest.md "Stato": schermata di
 * verifica) — one row per transcribed block of a `schemi`-type document's
 * photo. `verified` is the human decision (independent from the model's own
 * `confidence`): a block starts pre-verified only when the model was
 * confident (`confidence = 'ok'`); `documents.blockedBlocks` counts
 * `verified = false` rows so the UI never has to recompute it from scratch.
 * Re-running the transcription (`transcribe` again) replaces every row for
 * that document — there's no history to reconcile, just a fresh read.
 */
export type SchemaBlockConfidence = 'ok' | 'uncertain' | 'illegible';

export const schemaBlocks = pgTable('schema_blocks', {
  id: uuid('id').primaryKey(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  ord: integer('ord').notNull(),
  text: text('text').notNull(),
  confidence: text('confidence').$type<SchemaBlockConfidence>().notNull(),
  note: text('note'),
  verified: boolean('verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    pageFrom: integer('page_from').notNull(),
    pageTo: integer('page_to').notNull(),
    ord: integer('ord').notNull(),
    text: text('text').notNull(),
    tokens: integer('tokens').notNull(),
    // Local, free embedding (Xenova/all-MiniLM-L6-v2, 384 dims) — computed by
    // the `embed_chunks` job right after extraction. Null until embedded;
    // hybrid search (apps/web/src/lib/search.ts) falls back to FTS-only rows.
    embedding: vector('embedding'),
  },
  (table) => [
    index('chunks_text_fts_idx').using('gin', sql`to_tsvector('italian', ${table.text})`),
  ],
);

/**
 * Node/edge graph for a `schemi`-type document (docs/07-markdown-layer.md
 * §5.2), replacing the flat `schemaBlocks` for newly (re)transcribed
 * documents — see apps/worker/src/processors/transcribeSchema.ts. Documents
 * transcribed before this existed keep their `schemaBlocks` rows and the old
 * flat verification view until re-transcribed; both can coexist per document,
 * the UI picks whichever table has rows.
 */
export type SchemaNodeKind =
  | 'concetto'
  | 'definizione'
  | 'formula'
  | 'principio'
  | 'grandezza'
  | 'caso'
  | 'esempio'
  | 'condizione'
  | 'conseguenza'
  | 'domanda';
export type SchemaEdgeType =
  | 'implica'
  | 'causa'
  | 'composto-da'
  | 'esempio-di'
  | 'opposto-a'
  | 'precede'
  | 'dipende-da'
  | 'annota';
export type SchemaNodeConfidence = 'ok' | 'uncertain' | 'unreadable';

export interface SchemaNodeCrop {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const schemaNodes = pgTable(
  'schema_nodes',
  {
    id: uuid('id').primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    nodeKey: text('node_key').notNull(), // e.g. "n7", model/us-assigned, unique within a document
    label: text('label').notNull(),
    kind: text('kind').$type<SchemaNodeKind>().notNull(),
    crop: jsonb('crop').$type<SchemaNodeCrop>(),
    confidence: text('confidence').$type<SchemaNodeConfidence>().notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: text('verified_by'),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    mdAnchor: text('md_anchor'), // "^n7" — links this row back to content.md
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('schema_nodes_document_confidence_idx').on(table.documentId, table.confidence)],
);

export const schemaEdges = pgTable(
  'schema_edges',
  {
    id: uuid('id').primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    fromNode: text('from_node').notNull(), // node_key, not a FK (nodes are replaced as a batch)
    toNode: text('to_node').notNull(),
    type: text('type').$type<SchemaEdgeType>().notNull(),
    label: text('label'),
    confidence: text('confidence').$type<SchemaNodeConfidence>(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('schema_edges_from_node_idx').on(table.fromNode),
    index('schema_edges_to_node_idx').on(table.toNode),
  ],
);

export const schemaGroups = pgTable('schema_groups', {
  id: uuid('id').primaryKey(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  groupKey: text('group_key').notNull(),
  label: text('label').notNull(),
  nodeKeys: jsonb('node_keys').$type<string[]>().notNull(),
});

/**
 * One row per user correction made on the verification screen — the raw
 * material `distill_handwriting_profile` reads to write
 * `handwriting-profile.md` lines (docs/07-markdown-layer.md §5.4b).
 */
export const transcriptionCorrections = pgTable('transcription_corrections', {
  id: uuid('id').primaryKey(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  nodeKey: text('node_key').notNull(),
  before: text('before'),
  after: text('after'),
  kind: text('kind'), // 'label' | 'kind' | 'edge' | 'merge' | 'exclude'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * F2 scope (docs/fasi/F2-materie.md), non-AI slice only: user-managed exams
 * and a user-editable topic tree. NOT implemented (needs F4/F5 data or AI —
 * see docs/fasi/F2-materie.md "Stato" addendum): mastery calculation,
 * AI-suggested topics, document_topics tagging, the contextual AI panel.
 */
export type ExamKind = 'scritto' | 'orale' | 'parziale' | 'progetto';
export type ExamStatus = 'scheduled' | 'done' | 'cancelled';

export const exams = pgTable('exams', {
  id: uuid('id').primaryKey(),
  subjectId: uuid('subject_id')
    .notNull()
    .references(() => subjects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  kind: text('kind').$type<ExamKind>().notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  weight: real('weight'),
  description: text('description'),
  location: text('location'),
  status: text('status').$type<ExamStatus>().notNull().default('scheduled'),
  // F5 anagrafica (docs/fasi/F5-esami-simulazioni.md): "materiale ammesso, durata".
  allowedMaterials: text('allowed_materials'),
  durationMin: integer('duration_min'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TopicSource = 'ai' | 'user';

export const topics = pgTable('topics', {
  id: uuid('id').primaryKey(),
  subjectId: uuid('subject_id')
    .notNull()
    .references(() => subjects.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id').references((): AnyPgColumn => topics.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  orderIndex: integer('order_index').notNull().default(0),
  confidence: real('confidence'),
  source: text('source').$type<TopicSource>().notNull().default('user'),
  // 0..1, computed from FSRS retrievability + simulation accuracy + coverage
  // (docs/02-filesystem-e-dati.md §5) by `recomputeTopicMastery`
  // (packages/db/src/mastery.ts) — null only for a topic with none of the
  // three yet (no reviewed cards, no simulation, no material assigned).
  mastery: real('mastery'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Document→topic tagging (docs/fasi/F2-materie.md / F3-ai-core.md "Stato":
 * deferred since F2). Many-to-many on purpose — a chapter can genuinely
 * belong to more than one topic — but consumers that need one material set
 * per topic (the Planner's Fase A) treat a document's *first* linked topic
 * as primary; see `apps/worker/src/processors/planner/generatePlan.ts`.
 */
export const documentTopics = pgTable(
  'document_topics',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    source: text('source').$type<TopicSource>().notNull().default('user'),
    confidence: real('confidence'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.topicId] }),
    index('document_topics_topic_idx').on(table.topicId),
  ],
);

/**
 * F3 scope (docs/fasi/F3-ai-core.md), simulated-provider slice: generation
 * pipeline, artifacts, flashcards with citation refs. Real generation via
 * `packages/ai`'s `FakeProvider` (deterministic, no network/cost) or the
 * real `AnthropicProvider` when `ANTHROPIC_API_KEY` is set — see
 * docs/fasi/F3-ai-core.md "Stato" addendum for what's simulated vs real.
 */
export type ArtifactKind = 'flashcard_deck' | 'schema' | 'summary' | 'simulation' | 'drill';
export type ArtifactStatus = 'draft' | 'approved' | 'archived';

export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey(),
  subjectId: uuid('subject_id')
    .notNull()
    .references(() => subjects.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<ArtifactKind>().notNull(),
  title: text('title').notNull(),
  path: text('path').notNull(),
  status: text('status').$type<ArtifactStatus>().notNull().default('draft'),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  costEur: real('cost_eur'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
});

export const artifactSources = pgTable('artifact_sources', {
  artifactId: uuid('artifact_id')
    .notNull()
    .references(() => artifacts.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
});

export type FlashcardType = 'basic' | 'cloze' | 'qa' | 'formula';
export type FlashcardState = 'new' | 'learning' | 'review' | 'relearning';

export interface SourceRef {
  docId: string;
  page: number;
  quote: string;
}

export const flashcards = pgTable(
  'flashcards',
  {
    id: uuid('id').primaryKey(),
    deckId: uuid('deck_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    type: text('type').$type<FlashcardType>().notNull(),
    front: text('front').notNull(),
    back: text('back').notNull(),
    hint: text('hint'),
    // null = card created by hand in the deck editor (docs/fasi/F4-flashcard.md), no source to cite.
    sourceRef: jsonb('source_ref').$type<SourceRef>(),
    // Embedding of `front` (same model/dims as chunks.embedding), used only for semantic dedup
    // against the subject's other cards at generation time (docs/fasi/F3-ai-core.md "Stato") —
    // null until a generation run computes it, never backfilled in bulk.
    embedding: vector('embedding'),
    // FSRS-5 state (docs/02-filesystem-e-dati.md §4, docs/fasi/F4-flashcard.md).
    stability: real('stability'),
    difficulty: real('difficulty'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    lastReviewAt: timestamp('last_review_at', { withTimezone: true }),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    state: text('state').$type<FlashcardState>().notNull().default('new'),
    suspended: boolean('suspended').notNull().default(false),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // "Segnala card scadente" during review (docs/fasi/F4-flashcard.md "Rischi"): excluded from
    // the queue, kept in the deck so the reports can be collected to improve the prompt.
    flaggedAt: timestamp('flagged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // docs/02-filesystem-e-dati.md §3 "Indici": the daily queue's core lookup.
    index('flashcards_due_at_idx')
      .on(table.dueAt)
      .where(sql`not ${table.suspended}`),
  ],
);

/**
 * F4 scope (docs/fasi/F4-flashcard.md): one row per FSRS review. "Ogni
 * review è registrata (rating + tempo di risposta): dataset per
 * l'ottimizzazione dei parametri FSRS e segnale di difficoltà reale per il
 * Planner." `prevStability`/`newStability` mirror `ReviewResult` from
 * `packages/core/src/fsrs.ts` for later parameter-fitting.
 */
export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey(),
  flashcardId: uuid('flashcard_id')
    .notNull()
    .references(() => flashcards.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(), // 1..4 (Again|Hard|Good|Easy)
  elapsedMs: integer('elapsed_ms').notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
  prevStability: real('prev_stability'),
  newStability: real('new_stability').notNull(),
});

/**
 * F5 scope (docs/fasi/F5-esami-simulazioni.md): exam profile, simulations,
 * attempts and formative grading. Generation/grading run through
 * `packages/ai` (simulated `FakeProvider` without an API key).
 */
export interface ExamProfileData {
  itemCount: number;
  durationMin: number;
  totalPoints: number;
  kindDistribution: Partial<Record<'open' | 'mcq' | 'numeric' | 'proof', number>>;
  avgMinutesPerItem: number;
  verbosity: 'breve' | 'media' | 'estesa';
  recurringTopics: string[];
  notes: string;
}

/** One profile per subject: re-extracting overwrites it unless the user has edited it. */
export const examProfiles = pgTable('exam_profiles', {
  id: uuid('id').primaryKey(),
  subjectId: uuid('subject_id')
    .notNull()
    .unique()
    .references(() => subjects.id, { onDelete: 'cascade' }),
  sourceDocIds: jsonb('source_doc_ids').$type<string[]>().notNull(),
  profile: jsonb('profile').$type<ExamProfileData>().notNull(),
  edited: boolean('edited').notNull().default(false),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  // hash(inputs + requested model + prompt version) of the extraction that
  // produced this profile — lets a rerun with identical inputs skip the
  // provider call. `model` above is what actually ran, which can differ.
  jobKey: text('job_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SimulationMode = 'esame_completo' | 'drill_argomento';

/** Simulation-specific metadata for an `artifacts` row of kind `simulation`. */
export const simulations = pgTable('simulations', {
  artifactId: uuid('artifact_id')
    .primaryKey()
    .references(() => artifacts.id, { onDelete: 'cascade' }),
  mode: text('mode').$type<SimulationMode>().notNull(),
  topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'set null' }),
  timeBudgetMin: integer('time_budget_min').notNull(),
  totalPoints: real('total_points').notNull(),
});

export interface RubricCriterionData {
  criterion: string;
  points: number;
}

export const simulationItems = pgTable('simulation_items', {
  id: uuid('id').primaryKey(),
  simulationId: uuid('simulation_id')
    .notNull()
    .references(() => artifacts.id, { onDelete: 'cascade' }),
  ord: integer('ord').notNull(),
  topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'set null' }),
  prompt: text('prompt').notNull(),
  kind: text('kind').$type<'open' | 'mcq' | 'numeric' | 'proof'>().notNull(),
  points: real('points').notNull(),
  expectedPoints: jsonb('expected_points').$type<string[]>().notNull(),
  rubric: jsonb('rubric').$type<RubricCriterionData[]>().notNull(),
  solution: text('solution').notNull(),
  sourceRef: jsonb('source_ref').$type<SourceRef>().notNull(),
});

export type AttemptStatus = 'in_progress' | 'submitted' | 'graded';

export const simulationAttempts = pgTable('simulation_attempts', {
  id: uuid('id').primaryKey(),
  simulationId: uuid('simulation_id')
    .notNull()
    .references(() => artifacts.id, { onDelete: 'cascade' }),
  status: text('status').$type<AttemptStatus>().notNull().default('in_progress'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  durationMin: integer('duration_min').notNull(),
  // itemId -> answer text; overwritten on every autosave.
  answers: jsonb('answers').$type<Record<string, string>>().notNull().default({}),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  gradedAt: timestamp('graded_at', { withTimezone: true }),
  totalAwarded: real('total_awarded'),
  totalMax: real('total_max'),
  // Read by the Planner on its next recalculation (docs/fasi/F5 "Decisioni").
  weakTopics: jsonb('weak_topics').$type<string[]>(),
});

export interface GradedCriterionData {
  criterion: string;
  awarded: number;
  max: number;
  feedback: string;
}

export const attemptItemResults = pgTable('attempt_item_results', {
  id: uuid('id').primaryKey(),
  attemptId: uuid('attempt_id')
    .notNull()
    .references(() => simulationAttempts.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id')
    .notNull()
    .references(() => simulationItems.id, { onDelete: 'cascade' }),
  awarded: real('awarded').notNull(),
  max: real('max').notNull(),
  criteria: jsonb('criteria').$type<GradedCriterionData[]>().notNull(),
  missing: jsonb('missing').$type<string[]>().notNull(),
  // Always the item's own citation, attached by the worker — not trusted from
  // the grading model — so "la correzione cita sempre il materiale" holds by construction.
  sourceRef: jsonb('source_ref').$type<SourceRef>().notNull(),
  // "Seconda opinione con modello superiore su singolo item" (docs/fasi/F5-esami-simulazioni.md
  // "Rischi"): an optional, on-demand re-grade with a stronger model — shown *alongside* the
  // original, never overwriting it, since the two can legitimately disagree.
  secondOpinionModel: text('second_opinion_model'),
  secondOpinionAwarded: real('second_opinion_awarded'),
  secondOpinionCriteria: jsonb('second_opinion_criteria').$type<GradedCriterionData[]>(),
  secondOpinionMissing: jsonb('second_opinion_missing').$type<string[]>(),
  secondOpinionAt: timestamp('second_opinion_at', { withTimezone: true }),
});

/**
 * F6 scope (docs/fasi/F6-planner-calendario.md, docs/04-planner.md §9): the
 * Planner's proposal/commit lifecycle. `study_plans.status=draft` and its
 * `tasks.status=proposed` are invisible to the rest of the app (Dashboard,
 * Daily Task, load-per-day) until `commit` flips them — see
 * apps/web/src/lib/plan.ts. "Tasks *are* the calendar events" (§9.4): no
 * separate `calendar_events` table exists yet — this slice has no external
 * constraints (imported ICS, lectures) to hold in one, see "Stato".
 */
export type PlanStatus = 'draft' | 'active' | 'superseded';

export interface PlannerAvailabilityData {
  perWeekday: number[];
  blackoutDates: string[];
}

export interface PlannerPrefsData {
  sessionLength: number;
  intensity: 'sostenibile' | 'standard' | 'sprint';
  simulationCount: number | 'auto';
  simulationMinutes: number;
  reviewMinutesPerCard: number;
}

export interface PlannerStrategyData {
  id: 'copertura_superficiale' | 'focus_80' | 'estendi_data';
  label: string;
  description: string;
}

export interface PlannerFeasibilityData {
  feasible: boolean;
  requiredMinutes: number;
  availableMinutes: number;
  shortfallMinutes: number;
  unscheduledTopicKeys: string[];
  strategies: PlannerStrategyData[];
}

export const studyPlans = pgTable('study_plans', {
  id: uuid('id').primaryKey(),
  subjectId: uuid('subject_id')
    .notNull()
    .references(() => subjects.id, { onDelete: 'cascade' }),
  examId: uuid('exam_id').references(() => exams.id, { onDelete: 'set null' }),
  status: text('status').$type<PlanStatus>().notNull().default('draft'),
  // IsoDate ('YYYY-MM-DD') strings throughout, never a timestamp — a plan is
  // a list of days, not instants (packages/core/src/planner/dates.ts).
  startDate: text('start_date').notNull(),
  targetDate: text('target_date').notNull(),
  availability: jsonb('availability').$type<PlannerAvailabilityData>().notNull(),
  prefs: jsonb('prefs').$type<PlannerPrefsData>().notNull(),
  feasibility: jsonb('feasibility').$type<PlannerFeasibilityData>().notNull(),
  warnings: jsonb('warnings').$type<string[]>().notNull(),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  jobKey: text('job_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  committedAt: timestamp('committed_at', { withTimezone: true }),
});

export type TaskKind =
  'read' | 'flashcards' | 'schema' | 'simulation' | 'drill' | 'rest' | 'review';
export type TaskStatus = 'proposed' | 'todo' | 'doing' | 'done' | 'skipped' | 'moved';
export type TaskOrigin = 'planner' | 'manual';

export interface TaskMaterialRefData {
  docId: string;
  pageFrom: number;
  pageTo: number;
}

export interface TaskPayloadData {
  action: 'read' | 'generate_flashcards' | 'review_session' | 'simulation' | 'manual';
  material?: TaskMaterialRefData[];
  topicId?: string | null;
}

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => studyPlans.id, { onDelete: 'cascade' }),
    // Deterministic key from packages/core/src/planner (e.g. "read:doc-1:001")
    // — the identity `moveTask`/`diffPlans` key off, unique within one plan.
    taskKey: text('task_key').notNull(),
    date: text('date').notNull(),
    kind: text('kind').$type<TaskKind>().notNull(),
    // The planner's own unit key (a document id in this slice — no
    // document->topic link exists yet, see docs/fasi/F6 "Stato"), kept
    // distinct from `topicId` (a real `topics` row, unused until that link
    // exists) so grouping/validation logic has something stable to key on.
    topicKey: text('topic_key'),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    minutes: integer('minutes').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    payload: jsonb('payload').$type<TaskPayloadData>().notNull(),
    pinned: boolean('pinned').notNull().default(false),
    origin: text('origin').$type<TaskOrigin>().notNull().default('planner'),
    status: text('status').$type<TaskStatus>().notNull().default('proposed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tasks_plan_key_idx').on(table.planId, table.taskKey),
    // Daily Task / load-per-day / cross-subject busy-minutes queries all filter by subject + date.
    index('tasks_subject_date_idx').on(table.subjectId, table.date),
  ],
);

/**
 * "Import ICS" (docs/fasi/F6-planner-calendario.md "Non implementato"; the concept is spec'd in
 * docs/04-planner.md §9.4: "esami, lezioni, impegni importati da ICS esterno... vincoli in
 * ingresso per lo scheduler, non suoi output" — distinct from `tasks`, which *are* the calendar
 * events the Planner produces). Global, not per-subject: an imported calendar (lectures, personal
 * commitments) constrains every subject's availability alike. `uid` is unique per import source so
 * re-importing the same file updates existing rows instead of duplicating them — see
 * docs/fasi/F6-planner-calendario.md "Stato" for what this slice does and doesn't wire up yet
 * (display only; not yet subtracted from the Planner's capacity).
 */
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').primaryKey(),
    source: text('source').notNull().default('ics_import'),
    uid: text('uid').notNull(),
    date: text('date').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('calendar_events_source_uid_idx').on(table.source, table.uid),
    index('calendar_events_date_idx').on(table.date),
  ],
);

export type Subject = typeof subjects.$inferSelect;
export type NewSubject = typeof subjects.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type SchemaBlock = typeof schemaBlocks.$inferSelect;
export type NewSchemaBlock = typeof schemaBlocks.$inferInsert;
export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;
export type Exam = typeof exams.$inferSelect;
export type NewExam = typeof exams.$inferInsert;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type NewCalendarEvent = typeof calendarEvents.$inferInsert;
export type Topic = typeof topics.$inferSelect;
export type NewTopic = typeof topics.$inferInsert;
export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
export type Flashcard = typeof flashcards.$inferSelect;
export type NewFlashcard = typeof flashcards.$inferInsert;
export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type ExamProfileRow = typeof examProfiles.$inferSelect;
export type Simulation = typeof simulations.$inferSelect;
export type SimulationItemRow = typeof simulationItems.$inferSelect;
export type SimulationAttempt = typeof simulationAttempts.$inferSelect;
export type AttemptItemResult = typeof attemptItemResults.$inferSelect;
export type StudyPlan = typeof studyPlans.$inferSelect;
export type NewStudyPlan = typeof studyPlans.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type DocumentTopic = typeof documentTopics.$inferSelect;
export type NewDocumentTopic = typeof documentTopics.$inferInsert;
export type SchemaNode = typeof schemaNodes.$inferSelect;
export type NewSchemaNode = typeof schemaNodes.$inferInsert;
export type SchemaEdge = typeof schemaEdges.$inferSelect;
export type NewSchemaEdge = typeof schemaEdges.$inferInsert;
export type SchemaGroup = typeof schemaGroups.$inferSelect;
export type NewSchemaGroup = typeof schemaGroups.$inferInsert;
export type TranscriptionCorrection = typeof transcriptionCorrections.$inferSelect;
export type NewTranscriptionCorrection = typeof transcriptionCorrections.$inferInsert;
