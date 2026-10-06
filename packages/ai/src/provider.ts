import type {
  ClassifyDocumentTypeOutput,
  DistillHandwritingProfileOutput,
  EstimateTopicsOutput,
  ExamProfile,
  ExtractTopicsOutput,
  FlashcardType,
  FlashcardsOutput,
  GradeOutput,
  OcrTextOutput,
  SchemaGraphOutput,
  SchemaOutput,
  SessionBriefingOutput,
  SimulationItem,
  SimulationOutput,
  SummaryOutput,
} from './schemas.js';

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GeneratedWithMeta<T> {
  data: T;
  usage: AiUsage;
  model: string;
  promptVersion: string;
}

export interface ChunkRef {
  docId: string;
  page: number;
  text: string;
}

export interface FlashcardsPromptInput {
  subjectName: string;
  chunks: ChunkRef[];
  count: number | 'auto';
  types: FlashcardType[];
  difficulty: 1 | 2 | 3;
  lang: string;
}

export interface SummaryPromptInput {
  subjectName: string;
  chunks: ChunkRef[];
  length: 'flash' | 'standard' | 'esteso';
}

/** docs/03-ai-e-worker.md §3.2. */
export interface SchemaPromptInput {
  subjectName: string;
  chunks: ChunkRef[];
  depth: 1 | 2 | 3 | 4;
  style: 'gerarchico' | 'mappa' | 'timeline' | 'confronto';
}

/** A printed page/photo to OCR — no interpretation, plain text out. */
export interface OcrTextPromptInput {
  imagePath: string;
  mime: string;
}

/** A document to suggest a type for — whichever sample is available (text extract or photo). */
export interface ClassifyDocumentTypePromptInput {
  textSample?: string;
  imagePath?: string;
  mime?: string;
}

export interface DistillHandwritingProfilePromptInput {
  corrections: { before: string | null; after: string | null; kind: string | null }[];
}

/**
 * The absolute path (host/container filesystem) of the schema photo to
 * transcribe, plus the two free "levers" from docs/07-markdown-layer.md
 * §5.4 that don't need a second model call: `contextVocabulary` (terms
 * likely to appear, built by keyword retrieval over the subject's existing
 * chunks/topics — apps/worker/src/processors/schemaGraph/contextVocabulary.ts)
 * and `handwritingProfile` (accumulated conventions for this user/subject,
 * read from `handwriting-profile.md` if it exists).
 */
export interface SchemaTranscriptionPromptInput {
  imagePath: string;
  mime: string;
  contextVocabulary?: string[];
  handwritingProfile?: string;
}

/** Chunks come from documents of type `esami` (docs/03-ai-e-worker.md §2). */
export interface ExamProfilePromptInput {
  subjectName: string;
  chunks: ChunkRef[];
  /**
   * Pages of the past exams as images (figures, graphs, layout that the extracted text loses).
   * Optional and opt-in — each image costs input tokens. `label` names the source ("doc · p. N").
   */
  pageImages?: { path: string; mime: string; label: string }[];
}

export interface SimulationPromptInput {
  subjectName: string;
  /** Study material the items are drawn from (appunti, slide…) — never the past exams verbatim. */
  chunks: ChunkRef[];
  profile: ExamProfile;
  mode: 'esame_completo' | 'drill_argomento';
  itemCount: number;
  difficulty: 1 | 2 | 3;
  /** Only for `drill_argomento`. */
  topicName?: string | undefined;
  /**
   * Every topic in the subject, for `esame_completo` per-item tagging — the
   * model must pick `topicName` from these names (or `null`), never invent
   * one. Empty when the subject has no topics yet.
   */
  topics: { id: string; name: string }[];
}

export interface GradePromptInput {
  item: SimulationItem;
  answer: string;
}

/** One material unit to estimate — a document in this slice (docs/fasi/F6 "Stato": no document->topic link yet). */
export interface TopicEstimateUnit {
  /** Echoed back verbatim in the response so results can be matched without relying on order. */
  key: string;
  name: string;
  /** A sample of the unit's content — not the whole document, to keep the call cheap. */
  excerpt: string;
  pages: number;
}

export interface EstimateTopicsPromptInput {
  subjectName: string;
  units: TopicEstimateUnit[];
}

/** One document to consider for `extract_topics` — id echoed back so proposals can cite it. */
export interface TopicExtractionDocument {
  docId: string;
  /** A sample of the document's content, not the whole thing (keeps the call cheap). */
  excerpt: string;
}

export interface ExtractTopicsPromptInput {
  subjectName: string;
  documents: TopicExtractionDocument[];
  /** Topics already in the subject, given as candidate parents for a proposed sub-topic. */
  existingTopics?: { name: string }[];
}

/** docs/08-sessione-di-studio.md §5.2: key points + exercises on the session's material. */
export interface SessionBriefingPromptInput {
  subjectName: string;
  /** The session's topic names, for orientation only. */
  topicNames: string[];
  chunks: ChunkRef[];
  /** How many key points to produce (0 when only more exercises are wanted). */
  keyPointCount: number;
  exerciseCount: number;
  /** Prompts of the exercises the student already has, so new ones don't repeat them. */
  existingExercises: string[];
  /** One-line summary of how the course's exams are written, when an exam profile exists. */
  examStyle?: string | undefined;
}

/** One numbered source block of the study-session chat; the model cites it as `[n]`. */
export interface SessionChatSource {
  /** 1-based number the model must cite. */
  ref: number;
  docId: string;
  documentName: string;
  page: number;
  text: string;
}

export interface SessionChatPromptInput {
  subjectName: string;
  /** The session's topic names, for orientation only. */
  topicNames: string[];
  sources: SessionChatSource[];
  /** Earlier turns (already windowed), oldest first — without the question being asked now. */
  history: { role: 'user' | 'assistant'; content: string }[];
  /** The passage the student selected ("Chiedi all'AI"), when there is one. */
  focus?: { documentName: string; page: number | null; text: string } | undefined;
  question: string;
}

/** What `AiProvider.chatStream` yields: text pieces, then exactly one `done` with the usage. */
export type ChatDelta =
  | { type: 'text'; text: string }
  | { type: 'done'; usage: AiUsage; model: string; promptVersion: string };

/**
 * `packages/core` and other model-agnostic code never talk to a provider
 * directly — they go through this interface. `AnthropicProvider` is the
 * real thing; `FakeProvider` is a deterministic, offline stand-in that
 * generates schema-valid, genuinely-cited output by extraction (no network,
 * no cost) so the whole pipeline — job orchestration, citation validation,
 * artifact persistence, review queue — is exercised for real before anyone
 * configures a paid API key (docs/fasi/F3-ai-core.md "Stato" addendum).
 */
export interface AiProvider {
  readonly name: string;
  generateFlashcards(
    input: FlashcardsPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<FlashcardsOutput>>;
  generateSummary(
    input: SummaryPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<SummaryOutput>>;
  generateSchema(input: SchemaPromptInput, model: string): Promise<GeneratedWithMeta<SchemaOutput>>;
  transcribeSchema(
    input: SchemaTranscriptionPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<SchemaGraphOutput>>;
  ocrText(input: OcrTextPromptInput, model: string): Promise<GeneratedWithMeta<OcrTextOutput>>;
  classifyDocumentType(
    input: ClassifyDocumentTypePromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<ClassifyDocumentTypeOutput>>;
  distillHandwritingProfile(
    input: DistillHandwritingProfilePromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<DistillHandwritingProfileOutput>>;
  extractExamProfile(
    input: ExamProfilePromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<ExamProfile>>;
  generateSimulation(
    input: SimulationPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<SimulationOutput>>;
  gradeAnswer(input: GradePromptInput, model: string): Promise<GeneratedWithMeta<GradeOutput>>;
  estimateTopics(
    input: EstimateTopicsPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<EstimateTopicsOutput>>;
  extractTopics(
    input: ExtractTopicsPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<ExtractTopicsOutput>>;
  generateSessionBriefing(
    input: SessionBriefingPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<SessionBriefingOutput>>;
  /** Streaming, free-text answer for the study-session chat (docs/08-sessione-di-studio.md §5.3). */
  chatStream(input: SessionChatPromptInput, model: string): AsyncIterable<ChatDelta>;
}
