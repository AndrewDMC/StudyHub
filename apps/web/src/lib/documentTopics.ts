import { and, eq, inArray } from 'drizzle-orm';
import { documentTopics, documents, subjects, topics } from '@studyhub/db';
import { SubjectNotFoundError } from './errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export class DocumentNotFoundError extends Error {
  constructor(id: string) {
    super(`Documento non trovato: ${id}`);
    this.name = 'DocumentNotFoundError';
  }
}

export class TopicsNotFoundError extends Error {
  constructor(ids: string[]) {
    super(`Argomenti non trovati: ${ids.join(', ')}`);
    this.name = 'TopicsNotFoundError';
  }
}

async function requireSubject(db: AnyDb, subjectSlug: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);
  return subject;
}

/**
 * Replaces the full set of topics a document is tagged with (docs/fasi/F2-materie.md
 * "Stato": `document_topics` was deferred since F2 — this is it). Many-to-many:
 * a document can carry several topics at once. Unblocks `resolveScopeChunks`
 * (F3's `topicIds` generation scope) and the Planner's per-topic material.
 */
export async function setDocumentTopics(
  db: AnyDb,
  subjectSlug: string,
  documentId: string,
  topicIds: string[],
): Promise<string[]> {
  const subject = await requireSubject(db, subjectSlug);

  const [document] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.subjectId, subject.id)));
  if (!document) throw new DocumentNotFoundError(documentId);

  const uniqueTopicIds = [...new Set(topicIds)];
  if (uniqueTopicIds.length > 0) {
    const topicRows: { id: string }[] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(and(eq(topics.subjectId, subject.id), inArray(topics.id, uniqueTopicIds)));
    const found = new Set(topicRows.map((t) => t.id));
    const missing = uniqueTopicIds.filter((id) => !found.has(id));
    if (missing.length > 0) throw new TopicsNotFoundError(missing);
  }

  await db.transaction(async (tx: AnyDb) => {
    await tx.delete(documentTopics).where(eq(documentTopics.documentId, documentId));
    if (uniqueTopicIds.length > 0) {
      await tx
        .insert(documentTopics)
        .values(
          uniqueTopicIds.map((topicId) => ({ documentId, topicId, source: 'user' as const })),
        );
    }
  });

  return uniqueTopicIds;
}
