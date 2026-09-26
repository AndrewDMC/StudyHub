import { and, eq, isNull } from 'drizzle-orm';
import { chunks } from '@studyhub/db';
import { embedText } from '@studyhub/ai/embeddings';
import type { EmbedChunksJobInput } from '@studyhub/contracts';

export interface EmbedChunksResult {
  embedded: number;
  skipped: number;
}

/**
 * Local, free embedding (packages/ai/src/embeddings.ts) for every chunk of a
 * document that doesn't have one yet — enqueued by `extract_text` right
 * after it (re)writes a document's chunks. Idempotent: only touches rows
 * with `embedding IS NULL`, so re-running after a partial failure just picks
 * up where it left off instead of re-embedding everything.
 */
export async function processEmbedChunks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: EmbedChunksJobInput,
): Promise<EmbedChunksResult> {
  const rows: { id: string; text: string }[] = await db
    .select({ id: chunks.id, text: chunks.text })
    .from(chunks)
    .where(and(eq(chunks.documentId, input.documentId), isNull(chunks.embedding)));

  let embedded = 0;
  for (const row of rows) {
    if (!row.text.trim()) continue;
    const vector = await embedText(row.text);
    await db.update(chunks).set({ embedding: vector }).where(eq(chunks.id, row.id));
    embedded += 1;
  }
  return { embedded, skipped: rows.length - embedded };
}
