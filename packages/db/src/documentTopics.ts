import { and, eq, inArray } from 'drizzle-orm';
import { documentTopics, topics } from './schema.js';

export interface PrimaryTopicLink {
  documentId: string;
  topicId: string;
  topicName: string;
  mastery: number | null;
}

/**
 * Resolves each document's *primary* topic: among the topics it's tagged
 * with (`document_topics`, many-to-many), the one with the lowest
 * `orderIndex` (ties broken by id) — docs/fasi/F2-materie.md "Stato": a
 * document tagged to more than one topic is never double-planned by the
 * Planner (`apps/worker/src/processors/planner/generatePlan.ts`) nor
 * double-counted in a topic's mastery coverage (`recomputeTopicMastery`
 * below) — it belongs to exactly one topic for both purposes. An untagged
 * document has no entry in the returned map.
 */
export async function resolvePrimaryTopics(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subjectId: string,
  docIds: string[],
): Promise<Map<string, PrimaryTopicLink>> {
  if (docIds.length === 0) return new Map();

  const linkRows: {
    documentId: string;
    topicId: string;
    topicName: string;
    orderIndex: number;
    mastery: number | null;
  }[] = await db
    .select({
      documentId: documentTopics.documentId,
      topicId: topics.id,
      topicName: topics.name,
      orderIndex: topics.orderIndex,
      mastery: topics.mastery,
    })
    .from(documentTopics)
    .innerJoin(topics, eq(documentTopics.topicId, topics.id))
    .where(and(eq(topics.subjectId, subjectId), inArray(documentTopics.documentId, docIds)));

  const byDoc = new Map<string, typeof linkRows>();
  for (const link of linkRows)
    byDoc.set(link.documentId, [...(byDoc.get(link.documentId) ?? []), link]);

  const result = new Map<string, PrimaryTopicLink>();
  for (const [documentId, links] of byDoc) {
    const primary = [...links].sort(
      (a, b) => a.orderIndex - b.orderIndex || a.topicId.localeCompare(b.topicId),
    )[0]!;
    result.set(documentId, {
      documentId,
      topicId: primary.topicId,
      topicName: primary.topicName,
      mastery: primary.mastery,
    });
  }
  return result;
}
