import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  artifactSources,
  artifacts,
  autoAttachFlashcards,
  flashcards,
  resolvePrimaryTopics,
  subjects,
  topics,
} from '@studyhub/db';
import { resolveSubjectSubpath, toIsoDate } from '@studyhub/core';
import { embedTexts } from '@studyhub/ai/embeddings';
import {
  buildTopicNameIndex,
  matchTopicId,
  resolveProvider,
  estimateCostEur,
  FLASHCARDS_PROMPT_VERSION,
  type AiProvider,
  type GeneratedFlashcard,
  resolveModel,
} from '@studyhub/ai';
import type { GenerateFlashcardsJobInput } from '@studyhub/contracts';
import {
  checkBudget,
  computeJobKey,
  dedupeSemanticFlashcards,
  findIdempotentArtifactId,
  resolveScopeChunks,
} from './shared.js';

const MODEL_ROUTING_FLASHCARDS = 'claude-sonnet-5-5'; // docs/03-ai-e-worker.md §4

export interface GenerateFlashcardsResult {
  artifactId: string;
  cardCount: number;
  discardedCount: number;
  semanticDuplicateCount: number;
  idempotent: boolean;
  jobKey: string;
  costEur: number;
  usage: { inputTokens: number; outputTokens: number };
}

export interface FlashcardTopicContext {
  /** The subject's topics by normalized name (`buildTopicNameIndex`). */
  topicIndex: ReadonlyMap<string, { id: string }>;
  /** The scope's only `topicId` when it names exactly one topic of this subject, else null. */
  scopeTopicId: string | null;
  /** Primary topic of each cited document (`resolvePrimaryTopics`); untagged documents are absent. */
  primaryTopicByDoc: ReadonlyMap<string, { topicId: string }>;
}

/**
 * Which topic a freshly generated card is filed under, first hit wins:
 * (a) the model's `topicName`, matched to a topic of the subject (a name outside the list is a
 * miss, not an error); (b) the scope's single topic; (c) the primary topic of the cited document;
 * (d) none. Never invents a topic.
 */
export function resolveFlashcardTopicId(
  card: { topicName?: string | null | undefined; sourceRef: { docId: string } },
  ctx: FlashcardTopicContext,
): string | null {
  return (
    matchTopicId(card.topicName, ctx.topicIndex) ??
    ctx.scopeTopicId ??
    ctx.primaryTopicByDoc.get(card.sourceRef.docId)?.topicId ??
    null
  );
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
  /** Injectable for tests — the real one loads an ONNX model, far too slow/heavy for unit tests. */
  embed: (texts: string[]) => Promise<number[][]> = embedTexts,
): Promise<GenerateFlashcardsResult> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, input.subjectId));
  if (!subject) throw new Error(`subject not found: ${input.subjectId}`);

  const model = input.model ?? resolveModel(MODEL_ROUTING_FLASHCARDS);
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
      semanticDuplicateCount: 0,
      idempotent: true,
      jobKey,
      costEur: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const subjectTopics: { id: string; name: string }[] = await db
    .select({ id: topics.id, name: topics.name })
    .from(topics)
    .where(eq(topics.subjectId, input.subjectId))
    .orderBy(topics.orderIndex, topics.name);

  const result = await provider.generateFlashcards(
    {
      subjectName: subject.name,
      chunks: scopeChunks,
      count: input.count,
      types: input.types,
      difficulty: input.difficulty,
      lang: input.lang,
      ...(subjectTopics.length > 0 ? { topics: subjectTopics.map((t) => ({ name: t.name })) } : {}),
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

  // Exact-text dedup first — cheap, catches literal repeats within this batch.
  const seenFronts = new Set<string>();
  const deduped = cited.filter((c) => {
    const key = c.front.trim().toLowerCase();
    if (seenFronts.has(key)) return false;
    seenFronts.add(key);
    return true;
  });

  // Semantic dedup second (docs/fasi/F3-ai-core.md "Stato"): catches a paraphrase of a fact
  // already covered, either earlier in this same batch or by an existing card in the subject.
  const { accepted: deduplicated, duplicateCount: semanticDuplicateCount } =
    await dedupeSemanticFlashcards(db, input.subjectId, deduped, embed);

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
        // `embedding` is internal (semantic dedup only) — never leaks into the artifact file.
        cards: deduplicated.map((c) => ({
          type: c.type,
          front: c.front,
          back: c.back,
          hint: c.hint,
          sourceRef: c.sourceRef,
        })),
      },
      null,
      2,
    ),
    'utf-8',
  );

  const scopeTopicIds = input.scope.topicIds ?? [];
  const scopeTopicId =
    scopeTopicIds.length === 1 && subjectTopics.some((t) => t.id === scopeTopicIds[0])
      ? scopeTopicIds[0]!
      : null;
  const topicContext: FlashcardTopicContext | null =
    deduplicated.length > 0
      ? {
          topicIndex: buildTopicNameIndex(subjectTopics),
          scopeTopicId,
          primaryTopicByDoc: await resolvePrimaryTopics(db, input.subjectId, [
            ...new Set(deduplicated.map((c) => c.sourceRef.docId)),
          ]),
        }
      : null;

  // Deck, cards, sources and lesson links land together: a failing attach must not leave an
  // orphan deck behind (a retry would otherwise duplicate it).
  await db.transaction(async (tx: typeof db) => {
    await tx.insert(artifacts).values({
      id: deckId,
      subjectId: input.subjectId,
      kind: 'flashcard_deck',
      title: `Flashcard — ${deduplicated.length} carte`,
      path: artifactPath,
      model: result.model,
      promptVersion: result.promptVersion,
      costEur,
    });

    if (topicContext) {
      const newCards = deduplicated.map((c) => ({
        id: randomUUID(),
        deckId,
        topicId: resolveFlashcardTopicId(c, topicContext),
        type: c.type,
        front: c.front,
        back: c.back,
        hint: c.hint ?? null,
        sourceRef: c.sourceRef,
        embedding: c.embedding,
      }));
      await tx.insert(flashcards).values(newCards);
    }
    if (uniqueDocIds.length > 0) {
      await tx
        .insert(artifactSources)
        .values(uniqueDocIds.map((documentId) => ({ artifactId: deckId, documentId })));
    }
    if (topicContext) {
      // Lessons: attach the new cards (those with a topic) to the nearest lesson of their topic.
      const rows: { id: string }[] = await tx
        .select({ id: flashcards.id })
        .from(flashcards)
        .where(eq(flashcards.deckId, deckId));
      await autoAttachFlashcards(tx, {
        subjectId: input.subjectId,
        cardIds: rows.map((r) => r.id),
        today: toIsoDate(new Date()),
      });
    }
  });

  return {
    artifactId: deckId,
    cardCount: deduplicated.length,
    discardedCount: discarded,
    semanticDuplicateCount,
    idempotent: false,
    jobKey,
    costEur,
    usage: result.usage,
  };
}

// Re-exported so callers (jobRunner tests, CLI --dry-run) can build the
// prompt-facing view without duplicating the scope-resolution logic.
export { resolveScopeChunks };
