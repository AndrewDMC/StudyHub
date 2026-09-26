import { and, eq } from 'drizzle-orm';
import { documents, schemaBlocks, subjects, type SchemaBlock } from '@studyhub/db';
import type { SchemaBlockDto, UpdateSchemaBlockRequest } from '@studyhub/contracts';
import { SubjectNotFoundError } from './errors';
import { DocumentNotFoundError } from './documentTopics';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export class SchemaBlockNotFoundError extends Error {
  constructor(id: string) {
    super(`Blocco non trovato: ${id}`);
    this.name = 'SchemaBlockNotFoundError';
  }
}

function toDto(row: SchemaBlock): SchemaBlockDto {
  return {
    id: row.id,
    documentId: row.documentId,
    ord: row.ord,
    text: row.text,
    confidence: row.confidence,
    note: row.note,
    verified: row.verified,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function requireDocument(db: AnyDb, subjectSlug: string, documentId: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);

  const [document] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.subjectId, subject.id)));
  if (!document) throw new DocumentNotFoundError(documentId);
  return document;
}

export async function listSchemaBlocks(
  db: AnyDb,
  subjectSlug: string,
  documentId: string,
): Promise<SchemaBlockDto[]> {
  await requireDocument(db, subjectSlug, documentId);
  const rows: SchemaBlock[] = await db
    .select()
    .from(schemaBlocks)
    .where(eq(schemaBlocks.documentId, documentId))
    .orderBy(schemaBlocks.ord);
  return rows.map(toDto);
}

/**
 * Edits one block and keeps `documents.verificationStatus`/`blockedBlocks`
 * (docs/fasi/F1-ingest.md "Stato": schermata di verifica) in sync —
 * `blockedBlocks` is a live count of `verified = false` rows, not something
 * the UI has to recompute from a full block list.
 */
export async function updateSchemaBlock(
  db: AnyDb,
  subjectSlug: string,
  documentId: string,
  blockId: string,
  patch: UpdateSchemaBlockRequest,
): Promise<SchemaBlockDto> {
  await requireDocument(db, subjectSlug, documentId);

  const [existing] = await db
    .select()
    .from(schemaBlocks)
    .where(and(eq(schemaBlocks.id, blockId), eq(schemaBlocks.documentId, documentId)));
  if (!existing) throw new SchemaBlockNotFoundError(blockId);

  const [updated] = await db
    .update(schemaBlocks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schemaBlocks.id, blockId))
    .returning();

  const remaining: { verified: boolean }[] = await db
    .select({ verified: schemaBlocks.verified })
    .from(schemaBlocks)
    .where(eq(schemaBlocks.documentId, documentId));
  const blockedBlocks = remaining.filter((b) => !b.verified).length;
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

  return toDto(updated);
}
