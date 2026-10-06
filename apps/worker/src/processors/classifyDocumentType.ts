import { promises as fs } from 'node:fs';
import { eq } from 'drizzle-orm';
import { chunks, documents } from '@studyhub/db';
import { estimateCostEur, resolveProvider, type AiProvider, resolveModel } from '@studyhub/ai';
import type { ClassifyDocumentTypeJobInput } from '@studyhub/contracts';

const MODEL_ROUTING_CLASSIFY_DOCUMENT_TYPE = 'claude-haiku-4-5-20251001'; // cheap, low-stakes suggestion

export interface ClassifyDocumentTypeResult {
  documentId: string;
  type: string;
  confidence: number;
  costEur: number;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * `classify_document_type` — a suggestion only, enqueued right after upload
 * (apps/web/src/app/api/subjects/[slug]/documents/route.ts). Never changes
 * `documents.type` itself: writes `typeSource='ai'`/`typeConfidence` so the
 * UI can show "AI: schemi (86%)" with a one-click correction
 * (docs/fasi/F1-ingest.md "Pagina di Triage" — pre-classificazione, qui solo
 * per singolo documento, non la triage a selezione multipla).
 */
export async function processClassifyDocumentType(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: ClassifyDocumentTypeJobInput,
  provider: AiProvider = resolveProvider(),
): Promise<ClassifyDocumentTypeResult> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, input.documentId));
  if (!doc) throw new Error(`document not found: ${input.documentId}`);

  const model = input.model ?? resolveModel(MODEL_ROUTING_CLASSIFY_DOCUMENT_TYPE);

  const isImage = doc.mime.startsWith('image/');
  let textSample: string | undefined;
  if (!isImage) {
    const [chunk] = await db
      .select({ text: chunks.text })
      .from(chunks)
      .where(eq(chunks.documentId, doc.id))
      .limit(1);
    textSample = chunk?.text?.slice(0, 2000);
  }

  const result = await provider.classifyDocumentType(
    isImage
      ? { imagePath: doc.storedPath, mime: doc.mime }
      : {
          textSample:
            textSample ??
            (await fs.readFile(doc.storedPath, 'utf-8').catch(() => '')).slice(0, 2000),
        },
    model,
  );

  const costEur = estimateCostEur(
    result.model,
    result.usage.inputTokens,
    result.usage.outputTokens,
  );

  await db
    .update(documents)
    .set({
      typeSource: 'ai',
      typeConfidence: result.data.confidence,
      // Only recorded as a "suggestion" when it disagrees with what the user
      // picked — matching `doc.type` means nothing to show in the UI.
      typeSuggested: result.data.type === doc.type ? null : result.data.type,
    })
    .where(eq(documents.id, doc.id));

  return {
    documentId: doc.id,
    type: result.data.type,
    confidence: result.data.confidence,
    costEur,
    usage: result.usage,
  };
}
