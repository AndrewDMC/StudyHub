import { z } from 'zod';

/** docs/fasi/F1-ingest.md "Stato": schermata di verifica per gli schemi trascritti da foto. */
export const SchemaBlockConfidenceSchema = z.enum(['ok', 'uncertain', 'illegible']);
export type SchemaBlockConfidence = z.infer<typeof SchemaBlockConfidenceSchema>;

export const SchemaBlockDtoSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  ord: z.number().int().nonnegative(),
  text: z.string(),
  confidence: SchemaBlockConfidenceSchema,
  note: z.string().nullable(),
  verified: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SchemaBlockDto = z.infer<typeof SchemaBlockDtoSchema>;

/** PATCH body: any subset. Editing `text` without also confirming leaves `verified` untouched. */
export const UpdateSchemaBlockRequestSchema = z.object({
  text: z.string().min(1).optional(),
  confidence: SchemaBlockConfidenceSchema.optional(),
  verified: z.boolean().optional(),
});
export type UpdateSchemaBlockRequest = z.infer<typeof UpdateSchemaBlockRequestSchema>;
