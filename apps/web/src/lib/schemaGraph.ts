import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  documents,
  schemaEdges,
  schemaGroups,
  schemaNodes,
  subjects,
  transcriptionCorrections,
  type SchemaNode,
} from '@studyhub/db';
import type {
  SchemaEdgeDto,
  SchemaGraphDto,
  SchemaNodeDto,
  UpdateSchemaNodeRequest,
} from '@studyhub/contracts';
import { SubjectNotFoundError } from './errors';
import { DocumentNotFoundError } from './documentTopics';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export class SchemaNodeNotFoundError extends Error {
  constructor(id: string) {
    super(`Nodo non trovato: ${id}`);
    this.name = 'SchemaNodeNotFoundError';
  }
}

function nodeToDto(row: SchemaNode): SchemaNodeDto {
  return {
    id: row.id,
    nodeKey: row.nodeKey,
    label: row.label,
    kind: row.kind,
    crop: row.crop,
    confidence: row.confidence,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    topicId: row.topicId,
  };
}

export async function requireDocumentForGraph(db: AnyDb, subjectSlug: string, documentId: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);

  const [document] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.subjectId, subject.id)));
  if (!document) throw new DocumentNotFoundError(documentId);
  return document;
}

export async function getSchemaGraph(
  db: AnyDb,
  subjectSlug: string,
  documentId: string,
): Promise<SchemaGraphDto> {
  await requireDocumentForGraph(db, subjectSlug, documentId);

  const nodes: SchemaNode[] = await db
    .select()
    .from(schemaNodes)
    .where(eq(schemaNodes.documentId, documentId))
    .orderBy(schemaNodes.nodeKey);
  const edgeRows = await db
    .select()
    .from(schemaEdges)
    .where(eq(schemaEdges.documentId, documentId));
  const groupRows = await db
    .select()
    .from(schemaGroups)
    .where(eq(schemaGroups.documentId, documentId));

  const edges: SchemaEdgeDto[] = edgeRows.map(
    (e: { id: string; fromNode: string; toNode: string; type: string; label: string | null }) => ({
      id: e.id,
      from: e.fromNode,
      to: e.toNode,
      type: e.type as SchemaEdgeDto['type'],
      label: e.label,
    }),
  );

  return {
    nodes: nodes.map(nodeToDto),
    edges,
    groups: groupRows.map(
      (g: { id: string; groupKey: string; label: string; nodeKeys: string[] }) => ({
        id: g.id,
        groupKey: g.groupKey,
        label: g.label,
        nodeKeys: g.nodeKeys,
      }),
    ),
  };
}

/**
 * Edits one node — label/kind corrections and confirm/exclude — logging a
 * `transcription_corrections` row when the label actually changes (the raw
 * material for `distill_handwriting_profile`), and keeping
 * `documents.blockedBlocks`/`verificationStatus` in sync, same pattern as
 * `schemaBlocks.ts`'s `updateSchemaBlock`.
 */
export async function updateSchemaNode(
  db: AnyDb,
  subjectSlug: string,
  documentId: string,
  nodeId: string,
  patch: UpdateSchemaNodeRequest,
): Promise<SchemaNodeDto> {
  await requireDocumentForGraph(db, subjectSlug, documentId);

  const [existing] = await db
    .select()
    .from(schemaNodes)
    .where(and(eq(schemaNodes.id, nodeId), eq(schemaNodes.documentId, documentId)));
  if (!existing) throw new SchemaNodeNotFoundError(nodeId);

  const { verified, ...rest } = patch;
  const [updated] = await db
    .update(schemaNodes)
    .set({
      ...rest,
      ...(verified !== undefined
        ? {
            verifiedAt: verified ? new Date() : null,
            confidence: verified ? 'ok' : existing.confidence,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(schemaNodes.id, nodeId))
    .returning();

  if (patch.label !== undefined && patch.label !== existing.label) {
    await db.insert(transcriptionCorrections).values({
      id: randomUUID(),
      documentId,
      nodeKey: existing.nodeKey,
      before: existing.label,
      after: patch.label,
      kind: 'label',
    });
  }

  const remaining: { verifiedAt: Date | null }[] = await db
    .select({ verifiedAt: schemaNodes.verifiedAt })
    .from(schemaNodes)
    .where(eq(schemaNodes.documentId, documentId));
  const blockedBlocks = remaining.filter((n) => n.verifiedAt === null).length;
  await db
    .update(documents)
    .set({
      blockedBlocks,
      verificationStatus:
        remaining.length === 0
          ? 'not_required'
          : blockedBlocks === 0
            ? 'verified'
            : blockedBlocks === remaining.length
              ? 'pending'
              : 'partial',
    })
    .where(eq(documents.id, documentId));

  return nodeToDto(updated);
}
