import { z } from 'zod';

export const SchemaNodeKindSchema = z.enum([
  'concetto',
  'definizione',
  'formula',
  'principio',
  'grandezza',
  'caso',
  'esempio',
  'condizione',
  'conseguenza',
  'domanda',
]);
export const SchemaEdgeTypeSchema = z.enum([
  'implica',
  'causa',
  'composto-da',
  'esempio-di',
  'opposto-a',
  'precede',
  'dipende-da',
  'annota',
]);
export const SchemaNodeConfidenceSchema = z.enum(['ok', 'uncertain', 'unreadable']);

export const SchemaNodeDtoSchema = z.object({
  id: z.string().uuid(),
  nodeKey: z.string(),
  label: z.string(),
  kind: SchemaNodeKindSchema,
  crop: z
    .object({ page: z.number(), x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    .nullable(),
  confidence: SchemaNodeConfidenceSchema,
  verifiedAt: z.string().datetime().nullable(),
  topicId: z.string().uuid().nullable(),
});
export type SchemaNodeDto = z.infer<typeof SchemaNodeDtoSchema>;

export const SchemaEdgeDtoSchema = z.object({
  id: z.string().uuid(),
  from: z.string(),
  to: z.string(),
  type: SchemaEdgeTypeSchema,
  label: z.string().nullable(),
});
export type SchemaEdgeDto = z.infer<typeof SchemaEdgeDtoSchema>;

export const SchemaGroupDtoSchema = z.object({
  id: z.string().uuid(),
  groupKey: z.string(),
  label: z.string(),
  nodeKeys: z.array(z.string()),
});
export type SchemaGroupDto = z.infer<typeof SchemaGroupDtoSchema>;

export const SchemaGraphDtoSchema = z.object({
  nodes: z.array(SchemaNodeDtoSchema),
  edges: z.array(SchemaEdgeDtoSchema),
  groups: z.array(SchemaGroupDtoSchema),
});
export type SchemaGraphDto = z.infer<typeof SchemaGraphDtoSchema>;

/** PATCH body for one node — label/kind corrections and confirm/exclude. */
export const UpdateSchemaNodeRequestSchema = z.object({
  label: z.string().min(1).optional(),
  kind: SchemaNodeKindSchema.optional(),
  confidence: SchemaNodeConfidenceSchema.optional(),
  verified: z.boolean().optional(),
});
export type UpdateSchemaNodeRequest = z.infer<typeof UpdateSchemaNodeRequestSchema>;
