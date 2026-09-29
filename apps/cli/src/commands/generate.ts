import { eq } from 'drizzle-orm';
import { subjects } from '@studyhub/db';
import {
  estimateCostEur,
  estimateTokens,
  loadPrompt,
  renderFlashcardsUserPrompt,
  renderSchemaUserPrompt,
  renderSummaryUserPrompt,
  type FlashcardType,
} from '@studyhub/ai';
import { resolveScopeChunks } from '@studyhub/worker/lib';
import type { GenerationScope } from '@studyhub/contracts';

export class SubjectNotFoundCliError extends Error {
  constructor(slug: string) {
    super(`Materia non trovata: ${slug}`);
    this.name = 'SubjectNotFoundCliError';
  }
}

export type GenerationDryRunKind = 'flashcards' | 'schema' | 'summary';

// Same model routing default as the worker processors (docs/03-ai-e-worker.md §4) — a dry run
// should estimate against the model that would actually run, absent an explicit --model.
const MODEL_ROUTING: Record<GenerationDryRunKind, string> = {
  flashcards: 'claude-sonnet-5-5',
  schema: 'claude-sonnet-5-5',
  summary: 'claude-sonnet-5-5',
};

// Same order-of-magnitude output/input ratio as apps/web/src/lib/generation.ts's
// OUTPUT_TOKEN_RATIO (docs/03-ai-e-worker.md §4 pre-flight estimate) — duplicated rather than
// imported because apps/web isn't a dependency of apps/cli (docs/01-architettura.md layering: cli
// mirrors the worker, not the web app). Keep the two in sync if you touch either.
const OUTPUT_TOKEN_RATIO: Record<GenerationDryRunKind, number> = {
  flashcards: 0.3,
  schema: 0.25,
  summary: 0.3,
};

export interface GenerationDryRunInput {
  subjectSlug: string;
  kind: GenerationDryRunKind;
  scope: GenerationScope;
  model?: string;
  // flashcards
  count?: 'auto' | number;
  types?: FlashcardType[];
  difficulty?: 1 | 2 | 3;
  lang?: string;
  // schema
  depth?: 1 | 2 | 3 | 4;
  style?: 'gerarchico' | 'mappa' | 'timeline' | 'confronto';
  // summary
  length?: 'flash' | 'standard' | 'esteso';
}

export interface GenerationDryRunResult {
  kind: GenerationDryRunKind;
  model: string;
  promptVersion: string;
  system: string;
  userPrompt: string;
  docCount: number;
  chunkCount: number;
  inputTokens: number;
  outputTokens: number;
  costEur: number;
}

/**
 * `studyhub generate <kind> <subjectSlug> --dry-run` (docs/fasi/F3-ai-core.md "Non implementato":
 * "CLI ... non implementato in questa sessione"). Never calls a provider — resolves the same scope
 * the worker would (`resolveScopeChunks`), renders the exact system+user prompt the real job would
 * send (`loadPrompt`/`render*UserPrompt`, the same functions `AnthropicProvider`/`ClaudeCliProvider`
 * call), and estimates cost with the same `estimateCostEur` the budget guard and the web UI's
 * pre-flight estimate use. There is no "wet" mode here on purpose: actually enqueuing
 * `generate_flashcards`/`generate_schema`/`generate_summary` needs a running worker (BullMQ), which
 * is exactly what the web UI and worker already cover end to end — this command is preview-only.
 */
export async function buildGenerationDryRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: GenerationDryRunInput,
): Promise<GenerationDryRunResult> {
  const [subject] = await db
    .select({ id: subjects.id, name: subjects.name })
    .from(subjects)
    .where(eq(subjects.slug, input.subjectSlug));
  if (!subject) throw new SubjectNotFoundCliError(input.subjectSlug);

  const docIds = input.scope.docIds ?? [];
  const topicIds = input.scope.topicIds ?? [];
  if (docIds.length === 0 && topicIds.length === 0) {
    throw new Error('Specifica almeno un documento (--docs) o un argomento (--topics)');
  }

  const model = input.model ?? MODEL_ROUTING[input.kind];
  const scopeChunks = await resolveScopeChunks(db, subject.id, input.scope);
  const docCount = new Set(scopeChunks.map((c) => c.docId)).size;

  let system: string;
  let promptVersion: string;
  let userPrompt: string;
  if (input.kind === 'flashcards') {
    ({ text: system, promptVersion } = loadPrompt('flashcards', 1));
    userPrompt = renderFlashcardsUserPrompt({
      subjectName: subject.name,
      chunks: scopeChunks,
      count: input.count ?? 'auto',
      types: input.types ?? ['basic'],
      difficulty: input.difficulty ?? 2,
      lang: input.lang ?? 'it',
    });
  } else if (input.kind === 'schema') {
    ({ text: system, promptVersion } = loadPrompt('schema', 1));
    userPrompt = renderSchemaUserPrompt({
      subjectName: subject.name,
      chunks: scopeChunks,
      depth: input.depth ?? 2,
      style: input.style ?? 'gerarchico',
    });
  } else {
    ({ text: system, promptVersion } = loadPrompt('summary', 1));
    userPrompt = renderSummaryUserPrompt({
      subjectName: subject.name,
      chunks: scopeChunks,
      length: input.length ?? 'standard',
    });
  }

  // Unlike the web UI's pre-flight estimate (chunk text only), the dry run already has the exact
  // rendered prompt in hand — counting it directly is strictly more accurate than the UI's
  // pre-generation approximation.
  const inputTokens = estimateTokens(system) + estimateTokens(userPrompt);
  const outputTokens = Math.round(inputTokens * OUTPUT_TOKEN_RATIO[input.kind]);
  const costEur = estimateCostEur(model, inputTokens, outputTokens);

  return {
    kind: input.kind,
    model,
    promptVersion,
    system,
    userPrompt,
    docCount,
    chunkCount: scopeChunks.length,
    inputTokens,
    outputTokens,
    costEur,
  };
}
