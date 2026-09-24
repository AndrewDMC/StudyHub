import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { artifactSources, artifacts, flashcards, subjects } from '@studyhub/db';
import { resolveSubjectSubpath } from '@studyhub/core';
import {
  resolveProvider,
  estimateCostEur,
  FLASHCARDS_PROMPT_VERSION,
  type AiProvider,
  type GeneratedFlashcard,
} from '@studyhub/ai';
import type { GenerateFlashcardsJobInput } from '@studyhub/contracts';
import {
  checkBudget,
  computeJobKey,
  findIdempotentArtifactId,
  resolveScopeChunks,
} from './shared.js';

const MODEL_ROUTING_FLASHCARDS = 'claude-sonnet-5'; // docs/03-ai-e-worker.md §4

export interface GenerateFlashcardsResult {
  artifactId: string;
  cardCount: number;
  discardedCount: number;
  idempotent: boolean;
  jobKey: string;
  costEur: number;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * `generate_flashcards` (docs/03-ai-e-worker.md §3.1, docs/fasi/F3-ai-core.md).
 * Anti-hallucination gate: a card survives only if `sourceRef.quote` is a
 * verbatim substring of the chunk it cites — checked here, never trusted
 * from the model (real or fake).
 */
export async function processGenerateFlashcards(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  input: GenerateFlashcardsJobInput,
  /** Injectable for tests (e.g. to exercise citation rejection/dedup deterministically). */
  provider: AiProvider = resolveProvider(),
): Promise<GenerateFlashcardsResult> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, input.subjectId));
  if (!subject) throw new Error(`subject not found: ${input.subjectId}`);

  const model = input.model ?? MODEL_ROUTING_FLASHCARDS;
  const scopeChunks = await resolveScopeChunks(db, input.subjectId, input.scope);

  const jobKey = computeJobKey({
    type: 'generate_flashcards',
    subjectId: input.subjectId,
    docIds: [...(input.scope.docIds ?? [])].sort(),
    promptVersion: FLASHCARDS_PROMPT_VERSION,
    model,
    count: input.count,
    types: [...input.types].sort(),
    difficulty: input.difficulty,
    lang: input.lang,
  });

  const existingArtifactId = await findIdempotentArtifactId(db, jobKey);
  if (existingArtifactId) {
    const existingCards: { id: string }[] = await db
      .select({ id: flashcards.id })
      .from(flashcards)
      .where(eq(flashcards.deckId, existingArtifactId));
    return {
      artifactId: existingArtifactId,
      cardCount: existingCards.length,
      discardedCount: 0,
      idempotent: true,
      jobKey,
      costEur: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const result = await provider.generateFlashcards(
    {
      subjectName: subject.name,
      chunks: scopeChunks,
      count: input.count,
      types: input.types,
      difficulty: input.difficulty,
      lang: input.lang,
    },
    model,
  );

  const chunkTextByDocPage = new Map(scopeChunks.map((c) => [`${c.docId}:${c.page}`, c.text]));
  let discarded = 0;
  const cited: GeneratedFlashcard[] = [];
  for (const card of result.data.cards) {
    const chunkText = chunkTextByDocPage.get(`${card.sourceRef.docId}:${card.sourceRef.page}`);
    if (!chunkText || !chunkText.includes(card.sourceRef.quote)) {
      discarded += 1;
      continue;
    }
    cited.push(card);
  }

  // Exact-text dedup (docs/03 §3.1 wants semantic/cosine dedup against
  // embeddings, which aren't wired in yet — reduced to exact-match here,
  // see docs/fasi/F3-ai-core.md "Stato" addendum).
  const seenFronts = new Set<string>();
  const deduped = cited.filter((c) => {
    const key = c.front.trim().toLowerCase();
    if (seenFronts.has(key)) return false;
    seenFronts.add(key);
    return true;
  });

  const costEur = estimateCostEur(
    result.model,
    result.usage.inputTokens,
    result.usage.outputTokens,
  );
  await checkBudget(db, costEur, input.force);

  const deckId = randomUUID();
  const uniqueDocIds = [...new Set(scopeChunks.map((c) => c.docId))];
  const artifactDir = resolveSubjectSubpath(subject.slug, ['artifacts', 'flashcards'], dataRoot);
  await fs.mkdir(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, `${deckId}.json`);

  await fs.writeFile(
    artifactPath,
    JSON.stringify(
      {
        generatedBy: 'studyhub-worker',
        model: result.model,
        promptVersion: result.promptVersion,
        sourceDocIds: uniqueDocIds,
        approvedAt: null,
        createdAt: new Date().toISOString(),
        cards: deduped,
      },
      null,
      2,
    ),
    'utf-8',
  );

  await db.insert(artifacts).values({
    id: deckId,
    subjectId: input.subjectId,
    kind: 'flashcard_deck',
    title: `Flashcard — ${deduped.length} carte`,
    path: artifactPath,
    model: result.model,
    promptVersion: result.promptVersion,
    costEur,
  });

  if (deduped.length > 0) {
    await db.insert(flashcards).values(
      deduped.map((c) => ({
        id: randomUUID(),
        deckId,
        type: c.type,
        front: c.front,
        back: c.back,
        hint: c.hint ?? null,
        sourceRef: c.sourceRef,
      })),
    );
  }
  if (uniqueDocIds.length > 0) {
    await db
      .insert(artifactSources)
      .values(uniqueDocIds.map((documentId) => ({ artifactId: deckId, documentId })));
  }

  return {
    artifactId: deckId,
    cardCount: deduped.length,
    discardedCount: discarded,
    idempotent: false,
    jobKey,
    costEur,
    usage: result.usage,
  };
}

// Re-exported so callers (jobRunner tests, CLI --dry-run) can build the
// prompt-facing view without duplicating the scope-resolution logic.
export { resolveScopeChunks };
