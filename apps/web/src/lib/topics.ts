import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { subjects, topics, type Topic } from '@studyhub/db';
import { disambiguateSlug, slugify } from '@studyhub/core';
import type { CreateTopicRequest, TopicDto, UpdateTopicRequest } from '@studyhub/contracts';
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

export async function deleteTopic(db: AnyDb, subjectSlug: string, topicId: string): Promise<void> {
  const subject = await requireSubject(db, subjectSlug);
  const deleted = await db
    .delete(topics)
    .where(and(eq(topics.id, topicId), eq(topics.subjectId, subject.id)))
    .returning();
  if (deleted.length === 0) throw new TopicNotFoundError(topicId);
}
