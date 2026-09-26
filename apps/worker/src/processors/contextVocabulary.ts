import { and, eq, inArray, ne } from 'drizzle-orm';
import { chunks, documents, topics } from '@studyhub/db';
import { keywords } from '@studyhub/ai';

const MAX_TERMS = 30;

/**
 * Free "context vocabulary" lever (docs/07-markdown-layer.md §5.4a): terms
 * likely to appear in a schema photo, built by keyword-frequency retrieval
 * over the subject's own already-indexed material — no embeddings, no AI
 * call, genuinely free. Topic names count double (they're curated, more
 * reliable signal than raw word frequency).
 */
export async function buildContextVocabulary(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subjectId: string,
  excludeDocumentId?: string,
): Promise<string[]> {
  const topicRows: { name: string }[] = await db
    .select({ name: topics.name })
    .from(topics)
    .where(eq(topics.subjectId, subjectId));

  const docRows: { id: string }[] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.subjectId, subjectId));
  const docIds = docRows.map((d) => d.id).filter((id) => id !== excludeDocumentId);

  const counts = new Map<string, number>();
  for (const name of topicRows.map((t) => t.name)) {
    counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) ?? 0) + 5);
  }

  if (docIds.length > 0) {
    const chunkRows: { text: string }[] = await db
      .select({ text: chunks.text })
      .from(chunks)
      .where(
        and(inArray(chunks.documentId, docIds), ne(chunks.documentId, excludeDocumentId ?? '')),
      );
    for (const row of chunkRows) {
      for (const word of keywords(row.text)) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TERMS)
    .map(([term]) => term);
}
