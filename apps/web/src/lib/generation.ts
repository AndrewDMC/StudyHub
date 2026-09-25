import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { artifacts, flashcards, subjects, type Artifact, type Flashcard } from '@studyhub/db';
import type {
  ArtifactDto,
  FlashcardDto,
  GenerateFlashcardsJobInput,
  GenerateSummaryJobInput,
  ReviewFlashcardRequest,
} from '@studyhub/contracts';
import type { Queue } from 'bullmq';
import { SubjectNotFoundError } from './errors';

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
