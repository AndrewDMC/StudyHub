import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { documents, schemaEdges, schemaGroups, schemaNodes, subjects } from '@studyhub/db';
import { estimateCostEur, resolveProvider, type AiProvider } from '@studyhub/ai';
import { resolveDocumentDerivedDir } from '@studyhub/core';
import type { TranscribeSchemaJobInput } from '@studyhub/contracts';
import { buildContextVocabulary } from './contextVocabulary.js';
import { readHandwritingProfile } from './handwritingProfile.js';
import { renderSchemaMarkdown } from './schemaGraphRender.js';
import { writeCanonicalMarkdown } from './writeCanonicalMarkdown.js';

const MODEL_ROUTING_SCHEMA_TRANSCRIPTION = 'claude-sonnet-5'; // vision needs a capable model

export interface TranscribeSchemaResult {
  documentId: string;
  nodeCount: number;
  blockedCount: number;
  mdPath: string;
  costEur: number;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * `transcribe_schema` v2 — graph transcription (docs/07-markdown-layer.md
 * §5.2/§5.4). Replaces this document's `schema_nodes`/`schema_edges`/
 * `schema_groups` with a fresh transcription (re-running discards the
 * previous read, same as v1's flat blocks) and writes `content.md` with the
 * graph's front-matter. A document transcribed under the old flat-block
 * shape keeps its `schema_blocks` rows and the old verification view until
 * re-transcribed under this job — see `apps/web/src/lib/schemaGraph.ts`.
 */
export async function processTranscribeSchema(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  input: TranscribeSchemaJobInput,
  provider: AiProvider = resolveProvider(),
): Promise<TranscribeSchemaResult> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, input.documentId));
  if (!doc) throw new Error(`document not found: ${input.documentId}`);

  const [subject] = await db.select().from(subjects).where(eq(subjects.id, doc.subjectId));
  if (!subject) throw new Error(`subject not found for document ${input.documentId}`);

  const model = input.model ?? MODEL_ROUTING_SCHEMA_TRANSCRIPTION;

  await db.update(documents).set({ status: 'parsing' }).where(eq(documents.id, doc.id));

  try {
    const [contextVocabulary, handwritingProfile] = await Promise.all([
      buildContextVocabulary(db, doc.subjectId, doc.id),
      readHandwritingProfile(subject.slug, dataRoot),
    ]);

    const result = await provider.transcribeSchema(
      {
        imagePath: doc.storedPath,
        mime: doc.mime,
        ...(contextVocabulary.length > 0 ? { contextVocabulary } : {}),
        ...(handwritingProfile ? { handwritingProfile } : {}),
      },
      model,
    );

    const costEur = estimateCostEur(
      result.model,
      result.usage.inputTokens,
      result.usage.outputTokens,
    );
    const { nodes, edges, groups } = result.data;

    await db.delete(schemaNodes).where(eq(schemaNodes.documentId, doc.id));
    await db.delete(schemaEdges).where(eq(schemaEdges.documentId, doc.id));
    await db.delete(schemaGroups).where(eq(schemaGroups.documentId, doc.id));

    if (nodes.length > 0) {
      await db.insert(schemaNodes).values(
        nodes.map((n) => ({
          id: randomUUID(),
          documentId: doc.id,
          nodeKey: n.key,
          label: n.label,
          kind: n.kind,
          crop: n.crop,
          confidence: n.confidence,
          verifiedAt: n.confidence === 'ok' ? new Date() : null,
          mdAnchor: `^${n.key}`,
        })),
      );
    }
    if (edges.length > 0) {
      await db.insert(schemaEdges).values(
        edges.map((e) => ({
          id: randomUUID(),
          documentId: doc.id,
          fromNode: e.from,
          toNode: e.to,
          type: e.type,
          label: e.label,
        })),
      );
    }
    if (groups.length > 0) {
      await db.insert(schemaGroups).values(
        groups.map((g) => ({
          id: randomUUID(),
          documentId: doc.id,
          groupKey: g.key,
          label: g.label,
          nodeKeys: g.nodeKeys,
        })),
      );
    }

    const derivedDir = resolveDocumentDerivedDir(subject.slug, doc.id, dataRoot);
    const markdown = renderSchemaMarkdown({ originalName: doc.originalName, nodes, edges, groups });
    const { mdPath } = await writeCanonicalMarkdown(db, doc, derivedDir, markdown);

    const blockedCount = nodes.filter((n) => n.confidence !== 'ok').length;
    await db
      .update(documents)
      .set({
        status: 'parsed',
        pages: 1,
        mdPath,
        verificationStatus:
          nodes.length === 0 ? 'not_required' : blockedCount === 0 ? 'verified' : 'pending',
        blockedBlocks: blockedCount,
        ingestedAt: new Date(),
      })
      .where(eq(documents.id, doc.id));

    return {
      documentId: doc.id,
      nodeCount: nodes.length,
      blockedCount,
      mdPath,
      costEur,
      usage: result.usage,
    };
  } catch (err) {
    await db.update(documents).set({ status: 'failed' }).where(eq(documents.id, doc.id));
    throw err;
  }
}
