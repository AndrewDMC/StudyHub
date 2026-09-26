import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { documents, schemaBlocks } from '@studyhub/db';
import { estimateCostEur, resolveProvider, type AiProvider } from '@studyhub/ai';
import type { TranscribeSchemaJobInput } from '@studyhub/contracts';

const MODEL_ROUTING_SCHEMA_TRANSCRIPTION = 'claude-sonnet-5'; // vision needs a capable model

export interface TranscribeSchemaResult {
  documentId: string;
  blockCount: number;
  blockedCount: number;
  costEur: number;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * `transcribe_schema` (docs/fasi/F1-ingest.md "Stato": schermata di
 * verifica). Replaces this document's `schema_blocks` with a fresh
 * transcription — re-running (e.g. "Ritrascrivi") discards the previous
 * read rather than merging with it, since there's no meaningful diff
 * between two independent vision passes. A block the model was confident
 * about (`confidence: 'ok'`) starts pre-verified; anything else needs a
 * human to confirm before `documents.verificationStatus` reaches `verified`.
 */
export async function processTranscribeSchema(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: TranscribeSchemaJobInput,
  provider: AiProvider = resolveProvider(),
): Promise<TranscribeSchemaResult> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, input.documentId));
  if (!doc) throw new Error(`document not found: ${input.documentId}`);

  const model = input.model ?? MODEL_ROUTING_SCHEMA_TRANSCRIPTION;

  await db.update(documents).set({ status: 'parsing' }).where(eq(documents.id, doc.id));

  try {
    const result = await provider.transcribeSchema(
      { imagePath: doc.storedPath, mime: doc.mime },
      model,
    );

    const costEur = estimateCostEur(result.model, result.usage.inputTokens, result.usage.outputTokens);

    await db.delete(schemaBlocks).where(eq(schemaBlocks.documentId, doc.id));
    if (result.data.blocks.length > 0) {
      await db.insert(schemaBlocks).values(
        result.data.blocks.map((b, i) => ({
          id: randomUUID(),
          documentId: doc.id,
          ord: i,
          text: b.text,
          confidence: b.confidence,
          note: b.note,
          verified: b.confidence === 'ok',
        })),
      );
    }

    const blockedCount = result.data.blocks.filter((b) => b.confidence !== 'ok').length;
    await db
      .update(documents)
      .set({
        status: 'parsed',
        pages: 1,
        verificationStatus:
          result.data.blocks.length === 0
            ? 'not_required'
            : blockedCount === 0
              ? 'verified'
              : 'pending',
        blockedBlocks: blockedCount,
        ingestedAt: new Date(),
      })
      .where(eq(documents.id, doc.id));

    return {
      documentId: doc.id,
      blockCount: result.data.blocks.length,
      blockedCount,
      costEur,
      usage: result.usage,
    };
  } catch (err) {
    await db.update(documents).set({ status: 'failed' }).where(eq(documents.id, doc.id));
    throw err;
  }
}
