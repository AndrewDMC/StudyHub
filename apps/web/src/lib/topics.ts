import { randomUUID } from 'node:crypto';
import { and, eq, inArray, ne } from 'drizzle-orm';
import {
  documentTopics,
  flashcards,
  recomputeTopicMastery,
  simulationItems,
  subjects,
  tasks,
  topics,
  type Topic,
} from '@studyhub/db';
import { disambiguateSlug, slugify } from '@studyhub/core';
import type {
  CreateTopicRequest,
  ExtractTopicsJobInput,
  TopicDto,
  UpdateTopicRequest,
} from '@studyhub/contracts';
import type { Queue } from 'bullmq';
import { SubjectNotFoundError } from './errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export class TopicNotFoundError extends Error {
  constructor(id: string) {
    super(`Argomento non trovato: ${id}`);
    this.name = 'TopicNotFoundError';
  }
}

function toDto(row: Topic): TopicDto {
  return {
    id: row.id,
    subjectId: row.subjectId,
    parentId: row.parentId,
    name: row.name,
    slug: row.slug,
    orderIndex: row.orderIndex,
    confidence: row.confidence,
    source: row.source,
    mastery: row.mastery,
    createdAt: row.createdAt.toISOString(),
  };
}

async function requireSubject(db: AnyDb, subjectSlug: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);
  return subject;
}

export async function listTopics(db: AnyDb, subjectSlug: string): Promise<TopicDto[]> {
  const subject = await requireSubject(db, subjectSlug);
  const rows: Topic[] = await db
    .select()
    .from(topics)
    .where(eq(topics.subjectId, subject.id))
    .orderBy(topics.orderIndex, topics.name);
  return rows.map(toDto);
}

export async function createTopic(
  db: AnyDb,
  subjectSlug: string,
  input: CreateTopicRequest,
): Promise<TopicDto> {
  const subject = await requireSubject(db, subjectSlug);

  if (input.parentId) {
    const [parent] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, input.parentId), eq(topics.subjectId, subject.id)));
    if (!parent) throw new TopicNotFoundError(input.parentId);
  }

  const existingRows: { slug: string }[] = await db
    .select({ slug: topics.slug })
    .from(topics)
    .where(eq(topics.subjectId, subject.id));
  const slug = disambiguateSlug(slugify(input.name), new Set(existingRows.map((r) => r.slug)));

  const [row] = await db
    .insert(topics)
    .values({
      id: randomUUID(),
      subjectId: subject.id,
      parentId: input.parentId ?? null,
      name: input.name,
      slug,
      source: 'user',
    })
    .returning();
  return toDto(row);
}

export async function updateTopic(
  db: AnyDb,
  subjectSlug: string,
  topicId: string,
  input: UpdateTopicRequest,
): Promise<TopicDto> {
  const subject = await requireSubject(db, subjectSlug);

  if (input.parentId) {
    if (input.parentId === topicId) {
      throw new Error('Un argomento non può essere genitore di sé stesso');
    }
    const [parent] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, input.parentId), eq(topics.subjectId, subject.id)));
    if (!parent) throw new TopicNotFoundError(input.parentId);
  }

  const patch: Partial<typeof topics.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.parentId !== undefined) patch.parentId = input.parentId;

  const [row] = await db
    .update(topics)
    .set(patch)
    .where(and(eq(topics.id, topicId), eq(topics.subjectId, subject.id)))
    .returning();
  if (!row) throw new TopicNotFoundError(topicId);
  return toDto(row);
}

/**
 * Merges `sourceTopicId` into `targetTopicId` and deletes the source
 * (docs/fasi/F2-materie.md, criterio di accettazione: "unisco due argomenti
 * duplicati: flashcard e chunk si riattaccano correttamente" — chunks have
 * no topic of their own, they reach one through `document_topics`, so
 * reattaching that is the "chunk" half of the criterion).
 *
 * Everything is reassigned before the source row is deleted, so its
 * `ON DELETE CASCADE` children never fire: `flashcards.topicId`,
 * `document_topics` (skipping a link the target already has, since the
 * composite primary key forbids a duplicate), `simulation_items.topicId`,
 * `tasks.topicId`, and the source's own child topics (reparented to the
 * target — except the target itself, if it was a direct child of the
 * source, which instead moves up to the source's own parent, so it never
 * becomes its own parent).
 */
export async function mergeTopics(
  db: AnyDb,
  subjectSlug: string,
  sourceTopicId: string,
  targetTopicId: string,
): Promise<TopicDto> {
  const subject = await requireSubject(db, subjectSlug);
  if (sourceTopicId === targetTopicId) {
    throw new Error('Un argomento non può essere unito a sé stesso');
  }

  const rows: Topic[] = await db
    .select()
    .from(topics)
    .where(
      and(eq(topics.subjectId, subject.id), inArray(topics.id, [sourceTopicId, targetTopicId])),
    );
  const source = rows.find((t) => t.id === sourceTopicId);
  const target = rows.find((t) => t.id === targetTopicId);
  if (!source) throw new TopicNotFoundError(sourceTopicId);
  if (!target) throw new TopicNotFoundError(targetTopicId);

  await db.transaction(async (tx: AnyDb) => {
    if (target.parentId === sourceTopicId) {
      await tx
        .update(topics)
        .set({ parentId: source.parentId })
        .where(eq(topics.id, targetTopicId));
    }
    await tx
      .update(topics)
      .set({ parentId: targetTopicId })
      .where(and(eq(topics.parentId, sourceTopicId), ne(topics.id, targetTopicId)));

    await tx
      .update(flashcards)
      .set({ topicId: targetTopicId })
      .where(eq(flashcards.topicId, sourceTopicId));
    await tx
      .update(simulationItems)
      .set({ topicId: targetTopicId })
      .where(eq(simulationItems.topicId, sourceTopicId));
    await tx.update(tasks).set({ topicId: targetTopicId }).where(eq(tasks.topicId, sourceTopicId));

    const sourceLinks: { documentId: string }[] = await tx
      .select({ documentId: documentTopics.documentId })
      .from(documentTopics)
      .where(eq(documentTopics.topicId, sourceTopicId));
    const targetLinks: { documentId: string }[] = await tx
      .select({ documentId: documentTopics.documentId })
      .from(documentTopics)
      .where(eq(documentTopics.topicId, targetTopicId));
    const alreadyTagged = new Set(targetLinks.map((r) => r.documentId));
    const toMove = sourceLinks.filter((r) => !alreadyTagged.has(r.documentId));
    await tx.delete(documentTopics).where(eq(documentTopics.topicId, sourceTopicId));
    if (toMove.length > 0) {
      await tx
        .insert(documentTopics)
        .values(toMove.map((r) => ({ documentId: r.documentId, topicId: targetTopicId })));
    }

    await tx.delete(topics).where(eq(topics.id, sourceTopicId));
  });

  await recomputeTopicMastery(db, targetTopicId);

  const [merged] = await db.select().from(topics).where(eq(topics.id, targetTopicId));
  return toDto(merged);
}

export async function deleteTopic(db: AnyDb, subjectSlug: string, topicId: string): Promise<void> {
  const subject = await requireSubject(db, subjectSlug);
  const deleted = await db
    .delete(topics)
    .where(and(eq(topics.id, topicId), eq(topics.subjectId, subject.id)))
    .returning();
  if (deleted.length === 0) throw new TopicNotFoundError(topicId);
}

/** Enqueues `extract_topics`; returns the BullMQ job id the caller can poll via `jobs`. */
export async function enqueueExtractTopics(
  db: AnyDb,
  queue: Pick<Queue, 'add'>,
  subjectSlug: string,
  input: Omit<ExtractTopicsJobInput, 'subjectId'>,
): Promise<{ jobId: string }> {
  const subject = await requireSubject(db, subjectSlug);
  const jobId = randomUUID();
  await queue.add('extract_topics', { ...input, subjectId: subject.id }, { jobId });
  return { jobId };
}
