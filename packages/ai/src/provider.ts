import type {
  EstimateTopicsOutput,
  ExamProfile,
  FlashcardType,
  FlashcardsOutput,
  GradeOutput,
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

/** Chunks come from documents of type `esami` (docs/03-ai-e-worker.md §2). */
export interface ExamProfilePromptInput {
  subjectName: string;
  chunks: ChunkRef[];
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
}
