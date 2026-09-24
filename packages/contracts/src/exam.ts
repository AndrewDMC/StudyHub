import { z } from 'zod';

export const ExamKindSchema = z.enum(['scritto', 'orale', 'parziale', 'progetto']);
export const ExamStatusSchema = z.enum(['scheduled', 'done', 'cancelled']);

export const ExamDtoSchema = z.object({
  id: z.string().uuid(),
  subjectId: z.string().uuid(),
  title: z.string(),
  kind: ExamKindSchema,
  date: z.string().datetime(),
  weight: z.number().nullable(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  status: ExamStatusSchema,
  allowedMaterials: z.string().nullable(),
  durationMin: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});
export type ExamDto = z.infer<typeof ExamDtoSchema>;

export const CreateExamRequestSchema = z.object({
  title: z.string().trim().min(1, 'Il titolo è obbligatorio').max(200),
  kind: ExamKindSchema,
  date: z.string().datetime('Data non valida'),
  weight: z.number().min(0).max(1).optional(),
  description: z.string().max(2000).optional(),
  location: z.string().max(200).optional(),
  // F5 anagrafica: "materiale ammesso, durata".
  allowedMaterials: z.string().max(500).optional(),
  durationMin: z
    .number()
    .int()
    .positive()
    .max(24 * 60)
    .optional(),
});
export type CreateExamRequest = z.infer<typeof CreateExamRequestSchema>;
