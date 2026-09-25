import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import {
  artifacts,
  chunks,
  documentTopics,
  documents,
  flashcards,
  subjects,
  topics,
  type Artifact,
  type Flashcard,
} from '@studyhub/db';
import { estimateCostEur, estimateTokens } from '@studyhub/ai';
import type {
  ArtifactDto,
  EstimateGenerationCostRequest,
  EstimateGenerationCostResponse,
  FlashcardDto,
  GenerateFlashcardsJobInput,
  GenerateSchemaJobInput,
  GenerateSummaryJobInput,
  GenerationKind,
  ReviewFlashcardRequest,
} from '@studyhub/contracts';
import type { Queue } from 'bullmq';
import { SubjectNotFoundError } from './errors';

/**
 * Output/input token ratio per function, used only for the UI's pre-flight cost estimate
 * (docs/03-ai-e-worker.md §4). Rough and declared as such — flashcards/schema/summary all
 * *compress* the input, never expand it, so a fraction of the input token count is a reasonable
 * order-of-magnitude guess before the job actually runs. Real cost (from the model's own usage
 * reporting) is what `artifacts.costEur` shows after generation.
 */
const OUTPUT_TOKEN_RATIO: Record<GenerationKind, number> = {
  flashcards: 0.3,
  schema: 0.25,
  summary: 0.3,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export class ArtifactNotFoundError extends Error {
  constructor(id: string) {
    super(`Artefatto non trovato: ${id}`);
    this.name = 'ArtifactNotFoundError';
  }
}

export class FlashcardNotFoundError extends Error {
  constructor(id: string) {
    super(`Flashcard non trovata: ${id}`);
    this.name = 'FlashcardNotFoundError';
  }
}

function toArtifactDto(row: Artifact): ArtifactDto {
  return {
    id: row.id,
    subjectId: row.subjectId,
    kind: row.kind,
    title: row.title,
    path: row.path,
    status: row.status,
    model: row.model,
    promptVersion: row.promptVersion,
    costEur: row.costEur,
    createdAt: row.createdAt.toISOString(),
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
  };
}

function toFlashcardDto(row: Flashcard): FlashcardDto {
  return {
    id: row.id,
    deckId: row.deckId,
    topicId: row.topicId,
    type: row.type,
    front: row.front,
    back: row.back,
    hint: row.hint,
    sourceRef: row.sourceRef,
    state: row.state,
    suspended: row.suspended,
    createdAt: row.createdAt.toISOString(),
  };
}

async function requireSubject(db: AnyDb, subjectSlug: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);
  return subject;
}

/** Enqueues `generate_flashcards`; returns the BullMQ job id the caller can poll via `jobs`. */
export async function enqueueFlashcardsGeneration(
  db: AnyDb,
  queue: Pick<Queue, 'add'>,
  subjectSlug: string,
  input: Omit<GenerateFlashcardsJobInput, 'subjectId'>,
): Promise<{ jobId: string }> {
  const subject = await requireSubject(db, subjectSlug);
  const jobId = randomUUID();
  await queue.add('generate_flashcards', { ...input, subjectId: subject.id }, { jobId });
  return { jobId };
}

export async function enqueueSummaryGeneration(
  db: AnyDb,
  queue: Pick<Queue, 'add'>,
  subjectSlug: string,
  input: Omit<GenerateSummaryJobInput, 'subjectId'>,
): Promise<{ jobId: string }> {
  const subject = await requireSubject(db, subjectSlug);
  const jobId = randomUUID();
  await queue.add('generate_summary', { ...input, subjectId: subject.id }, { jobId });
  return { jobId };
}

export async function enqueueSchemaGeneration(
  db: AnyDb,
  queue: Pick<Queue, 'add'>,
  subjectSlug: string,
  input: Omit<GenerateSchemaJobInput, 'subjectId'>,
): Promise<{ jobId: string }> {
  const subject = await requireSubject(db, subjectSlug);
  const jobId = randomUUID();
  await queue.add('generate_schema', { ...input, subjectId: subject.id }, { jobId });
  return { jobId };
}

export async function listArtifacts(db: AnyDb, subjectSlug: string): Promise<ArtifactDto[]> {
  const subject = await requireSubject(db, subjectSlug);
  const rows: Artifact[] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.subjectId, subject.id))
    .orderBy(artifacts.createdAt);
  return rows.map(toArtifactDto);
}

export async function getArtifact(
  db: AnyDb,
  subjectSlug: string,
  artifactId: string,
): Promise<ArtifactDto> {
  const subject = await requireSubject(db, subjectSlug);
  const [row] = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.id, artifactId), eq(artifacts.subjectId, subject.id)));
  if (!row) throw new ArtifactNotFoundError(artifactId);
  return toArtifactDto(row);
}

export async function listDeckFlashcards(
  db: AnyDb,
  subjectSlug: string,
  deckId: string,
): Promise<FlashcardDto[]> {
  await getArtifact(db, subjectSlug, deckId); // 404s if the deck doesn't belong to this subject
  const rows: Flashcard[] = await db.select().from(flashcards).where(eq(flashcards.deckId, deckId));
  return rows.map(toFlashcardDto);
}

/**
 * Review queue action for one card (docs/fasi/F3-ai-core.md: "accetta/modifica/scarta card per
 * card"). `approve` promotes the card's deck to `approved` once every card in it has been
 * reviewed (no card left in the implicit "pending" bucket — anything not yet approved/edited is
 * pending; `discard` deletes the card outright).
 */
export async function reviewFlashcard(
  db: AnyDb,
  subjectSlug: string,
  deckId: string,
  cardId: string,
  request: ReviewFlashcardRequest,
): Promise<FlashcardDto | null> {
  await getArtifact(db, subjectSlug, deckId);

  if (request.action === 'discard') {
    const deleted = await db
      .delete(flashcards)
      .where(and(eq(flashcards.id, cardId), eq(flashcards.deckId, deckId)))
      .returning();
    if (deleted.length === 0) throw new FlashcardNotFoundError(cardId);
    return null;
  }

  if (request.action === 'approve') {
    // Nothing to persist per-card today (no "reviewed" column yet) — just
    // confirm it exists and hand back its current state.
    const [row] = await db
      .select()
      .from(flashcards)
      .where(and(eq(flashcards.id, cardId), eq(flashcards.deckId, deckId)));
    if (!row) throw new FlashcardNotFoundError(cardId);
    return toFlashcardDto(row);
  }

  const patch: Partial<typeof flashcards.$inferInsert> = {};
  if (request.front !== undefined) patch.front = request.front;
  if (request.back !== undefined) patch.back = request.back;
  if (Object.keys(patch).length === 0) {
    const [row] = await db
      .select()
      .from(flashcards)
      .where(and(eq(flashcards.id, cardId), eq(flashcards.deckId, deckId)));
    if (!row) throw new FlashcardNotFoundError(cardId);
    return toFlashcardDto(row);
  }

  const [row] = await db
    .update(flashcards)
    .set(patch)
    .where(and(eq(flashcards.id, cardId), eq(flashcards.deckId, deckId)))
    .returning();
  if (!row) throw new FlashcardNotFoundError(cardId);
  return toFlashcardDto(row);
}

export async function approveDeck(
  db: AnyDb,
  subjectSlug: string,
  deckId: string,
): Promise<ArtifactDto> {
  const subject = await requireSubject(db, subjectSlug);
  const [row] = await db
    .update(artifacts)
    .set({ status: 'approved', approvedAt: new Date() })
    .where(and(eq(artifacts.id, deckId), eq(artifacts.subjectId, subject.id)))
    .returning();
  if (!row) throw new ArtifactNotFoundError(deckId);
  return toArtifactDto(row);
}

/**
 * Resolves a generation scope to input token count and, per function, a rough pre-flight cost
 * for the given model — never calls a provider (docs/fasi/F3-ai-core.md "Stato": "la stima esiste
 * ed è usata dal budget guard, solo non mostrata prima del click" — this is what shows it).
 */
export async function estimateGenerationCost(
  db: AnyDb,
  subjectSlug: string,
  input: EstimateGenerationCostRequest,
): Promise<EstimateGenerationCostResponse> {
  const subject = await requireSubject(db, subjectSlug);

  let docIds = input.scope.docIds ?? [];
  if (docIds.length === 0 && input.scope.topicIds && input.scope.topicIds.length > 0) {
    const linkRows: { documentId: string }[] = await db
      .select({ documentId: documentTopics.documentId })
      .from(documentTopics)
      .innerJoin(topics, eq(documentTopics.topicId, topics.id))
      .where(and(eq(topics.subjectId, subject.id), inArray(documentTopics.topicId, input.scope.topicIds)));
    docIds = [...new Set(linkRows.map((r) => r.documentId))];
  }

  const docRows: { id: string }[] =
    docIds.length === 0
      ? []
      : await db
          .select({ id: documents.id })
          .from(documents)
          .where(and(eq(documents.subjectId, subject.id), inArray(documents.id, docIds)));
  const scopedDocIds = docRows.map((d) => d.id);

  const chunkRows: { text: string }[] =
    scopedDocIds.length === 0
      ? []
      : await db
          .select({ text: chunks.text })
          .from(chunks)
          .where(inArray(chunks.documentId, scopedDocIds));

  const inputTokens = chunkRows.reduce((sum, c) => sum + estimateTokens(c.text), 0);

  const perKind = Object.fromEntries(
    (Object.keys(OUTPUT_TOKEN_RATIO) as GenerationKind[]).map((kind) => {
      const outputTokens = Math.round(inputTokens * OUTPUT_TOKEN_RATIO[kind]);
      return [kind, { outputTokens, costEur: estimateCostEur(input.model, inputTokens, outputTokens) }];
    }),
  ) as EstimateGenerationCostResponse['perKind'];

  return { model: input.model, inputTokens, perKind };
}
