import { randomUUID, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { eq, and, inArray } from 'drizzle-orm';
import { documentTopics, documents, subjects, type Document } from '@studyhub/db';
import {
  generateStoredFilename,
  resolveDocumentSourcePath,
  sniffUploadMime,
  type DocumentType,
} from '@studyhub/core';
import type { DocumentDto } from '@studyhub/contracts';
import { DocumentNotFoundError } from './documentTopics';

export const MAX_UPLOAD_BYTES = Number(process.env.STUDYHUB_MAX_UPLOAD_BYTES ?? 100 * 1024 * 1024);

export class UploadError extends Error {
  constructor(
    readonly code: 'unsupported_file_type' | 'subject_not_found' | 'file_too_large' | 'empty_file',
    message: string,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

function toDto(row: Document, topicIds: string[] = []): DocumentDto {
  return {
    id: row.id,
    subjectId: row.subjectId,
    type: row.type,
    originalName: row.originalName,
    mime: row.mime,
    bytes: row.bytes,
    sha256: row.sha256,
    pages: row.pages,
    status: row.status,
    mdPath: row.mdPath,
    mdEdited: row.mdEdited,
    mdConflict: row.mdConflict,
    verificationStatus: row.verificationStatus,
    blockedBlocks: row.blockedBlocks,
    typeSuggested: row.typeSuggested,
    typeConfidence: row.typeConfidence,
    createdAt: row.createdAt.toISOString(),
    topicIds,
  };
}

export interface UploadDocumentInput {
  type: DocumentType;
  originalName: string;
  bytes: Uint8Array;
}

export interface UploadDocumentResult {
  document: DocumentDto;
  duplicate: boolean;
}

/**
 * Upload flow (docs/fasi/F1-ingest.md + docs/01-architettura.md §5): sniff
 * the real MIME from bytes (never trust the declared one), dedup by sha256
 * within the subject, store as `<uuid>.<ext>` under `sources/<type>/`, index
 * in `documents`. Never enqueues a job — that's the caller's job (the route
 * handler), so this stays testable without a Redis connection.
 */
export async function uploadDocument(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  subjectSlug: string,
  input: UploadDocumentInput,
): Promise<UploadDocumentResult> {
  if (input.bytes.byteLength === 0) {
    throw new UploadError('empty_file', 'Il file è vuoto');
  }
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadError(
      'file_too_large',
      `Il file supera il limite di ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB`,
    );
  }

  const mime = sniffUploadMime(input.bytes);
  if (!mime) {
    throw new UploadError(
      'unsupported_file_type',
      'Tipo di file non riconosciuto o non supportato (ammessi: PDF, JPEG, PNG, WEBP)',
    );
  }

  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) {
    throw new UploadError('subject_not_found', `Materia non trovata: ${subjectSlug}`);
  }

  const sha256 = createHash('sha256').update(input.bytes).digest('hex');

  const [existing] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.subjectId, subject.id), eq(documents.sha256, sha256)));
  if (existing) {
    return {
      document: toDto(existing, await getDocumentTopicIds(db, existing.id)),
      duplicate: true,
    };
  }

  const storedFilename = generateStoredFilename(mime);
  const storedPath = resolveDocumentSourcePath(subject.slug, input.type, storedFilename, dataRoot);
  await fs.writeFile(storedPath, input.bytes);

  const [row] = await db
    .insert(documents)
    .values({
      id: randomUUID(),
      subjectId: subject.id,
      type: input.type,
      originalName: input.originalName,
      storedPath,
      mime,
      bytes: input.bytes.byteLength,
      sha256,
    })
    .returning();

  return { document: toDto(row), duplicate: false };
}

export async function getDocument(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subjectSlug: string,
  documentId: string,
): Promise<DocumentDto> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new UploadError('subject_not_found', `Materia non trovata: ${subjectSlug}`);

  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.subjectId, subject.id)));
  if (!row) throw new DocumentNotFoundError(documentId);

  return toDto(row, await getDocumentTopicIds(db, documentId));
}

/**
 * Applies or dismisses the AI's suggested type (`documents.typeSuggested`,
 * set by `classify_document_type`) — always a one-click, explicit user
 * decision, never automatic (docs/fasi/F1-ingest.md "Pagina di Triage").
 */
export async function resolveDocumentType(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subjectSlug: string,
  documentId: string,
  accept: boolean,
): Promise<DocumentDto> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new UploadError('subject_not_found', `Materia non trovata: ${subjectSlug}`);

  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.subjectId, subject.id)));
  if (!row) throw new DocumentNotFoundError(documentId);

  const [updated] = await db
    .update(documents)
    .set({
      type: accept && row.typeSuggested ? row.typeSuggested : row.type,
      typeSuggested: null,
    })
    .where(eq(documents.id, documentId))
    .returning();

  return toDto(updated, await getDocumentTopicIds(db, documentId));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDocumentTopicIds(db: any, documentId: string): Promise<string[]> {
  const rows: { topicId: string }[] = await db
    .select({ topicId: documentTopics.topicId })
    .from(documentTopics)
    .where(eq(documentTopics.documentId, documentId));
  return rows.map((r) => r.topicId);
}

export async function listDocuments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subjectSlug: string,
): Promise<DocumentDto[]> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) {
    throw new UploadError('subject_not_found', `Materia non trovata: ${subjectSlug}`);
  }
  const rows: Document[] = await db
    .select()
    .from(documents)
    .where(eq(documents.subjectId, subject.id))
    .orderBy(documents.createdAt);
  if (rows.length === 0) return [];

  const linkRows: { documentId: string; topicId: string }[] = await db
    .select({ documentId: documentTopics.documentId, topicId: documentTopics.topicId })
    .from(documentTopics)
    .where(
      inArray(
        documentTopics.documentId,
        rows.map((r) => r.id),
      ),
    );
  const topicsByDoc = new Map<string, string[]>();
  for (const link of linkRows)
    topicsByDoc.set(link.documentId, [...(topicsByDoc.get(link.documentId) ?? []), link.topicId]);

  return rows.map((r) => toDto(r, topicsByDoc.get(r.id) ?? []));
}
