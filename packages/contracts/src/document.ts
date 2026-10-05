import { z } from 'zod';
import { ALLOWED_UPLOAD_MIME_TYPES, DOCUMENT_TYPES } from '@studyhub/core/browser';

export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES);
export const DocumentStatusSchema = z.enum(['uploaded', 'parsing', 'parsed', 'failed', 'missing']);
export const VerificationStatusSchema = z.enum(['not_required', 'pending', 'partial', 'verified']);
export const AllowedUploadMimeSchema = z.enum(ALLOWED_UPLOAD_MIME_TYPES);

export const DocumentDtoSchema = z.object({
  id: z.string().uuid(),
  subjectId: z.string().uuid(),
  type: DocumentTypeSchema,
  originalName: z.string(),
  mime: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string(),
  pages: z.number().int().nonnegative().nullable(),
  status: DocumentStatusSchema,
  mdPath: z.string().nullable(),
  mdEdited: z.boolean(),
  mdConflict: z.boolean(),
  verificationStatus: VerificationStatusSchema,
  blockedBlocks: z.number().int().nonnegative(),
  /** Set by `classify_document_type` only when it disagrees with `type` — never applied automatically. */
  typeSuggested: DocumentTypeSchema.nullable(),
  typeConfidence: z.number().min(0).max(1).nullable(),
  createdAt: z.string().datetime(),
  /** Argomenti a cui il documento è collegato (docs/fasi/F2-materie.md "Stato": document_topics). */
  topicIds: z.array(z.string().uuid()),
});
export type DocumentDto = z.infer<typeof DocumentDtoSchema>;

/** PATCH body: applies the AI's suggested type, or dismisses it. */
export const ResolveDocumentTypeRequestSchema = z.object({ accept: z.boolean() });
export type ResolveDocumentTypeRequest = z.infer<typeof ResolveDocumentTypeRequestSchema>;

export const UploadDocumentResponseSchema = z.object({
  document: DocumentDtoSchema,
  duplicate: z.boolean(),
});
export type UploadDocumentResponse = z.infer<typeof UploadDocumentResponseSchema>;

/**
 * What deleting a document touches, shown before the confirm. Flashcards and
 * artifacts built from it are kept (they carry review history); only their link
 * to this source breaks. `blockedReason` is set while a job is still working on it.
 */
export const DocumentDeletionImpactSchema = z.object({
  documentId: z.string().uuid(),
  name: z.string(),
  deletable: z.boolean(),
  blockedReason: z.string().nullable(),
  chunks: z.number().int(),
  topics: z.array(z.string()),
  artifacts: z.array(z.object({ id: z.string().uuid(), title: z.string(), kind: z.string() })),
  flashcardsCiting: z.number().int(),
  openTasks: z.number().int(),
});
export type DocumentDeletionImpact = z.infer<typeof DocumentDeletionImpactSchema>;

/** PUT body: replaces the full set of topics a document is tagged with. */
export const SetDocumentTopicsRequestSchema = z.object({
  topicIds: z.array(z.string().uuid()),
});
export type SetDocumentTopicsRequest = z.infer<typeof SetDocumentTopicsRequestSchema>;
