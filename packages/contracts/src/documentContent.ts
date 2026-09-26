import { z } from 'zod';

export const DocumentContentDtoSchema = z.object({
  markdown: z.string(),
  edited: z.boolean(),
  conflict: z.object({ newMarkdown: z.string() }).nullable(),
});
export type DocumentContentDto = z.infer<typeof DocumentContentDtoSchema>;

export const SaveDocumentContentRequestSchema = z.object({ markdown: z.string() });
export type SaveDocumentContentRequest = z.infer<typeof SaveDocumentContentRequestSchema>;

export const ResolveDocumentContentConflictRequestSchema = z.object({
  keep: z.enum(['mine', 'new']),
});
export type ResolveDocumentContentConflictRequest = z.infer<
  typeof ResolveDocumentContentConflictRequestSchema
>;
