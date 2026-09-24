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
  verificationStatus: VerificationStatusSchema,
  createdAt: z.string().datetime(),
});
export type DocumentDto = z.infer<typeof DocumentDtoSchema>;

export const UploadDocumentResponseSchema = z.object({
  document: DocumentDtoSchema,
  duplicate: z.boolean(),
});
export type UploadDocumentResponse = z.infer<typeof UploadDocumentResponseSchema>;
