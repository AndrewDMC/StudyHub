import { z } from 'zod';

/** docs/08-sessione-di-studio.md — "Inizia" su una task apre una sessione di studio. */
export const StartSessionRequestSchema = z
  .object({
    taskId: z.string().uuid().optional(),
    topicIds: z.array(z.string().uuid()).optional(),
  })
  .refine((v) => v.taskId !== undefined || (v.topicIds?.length ?? 0) > 0, {
    message: 'Serve una task o almeno un argomento',
  });
export type StartSessionRequest = z.infer<typeof StartSessionRequestSchema>;

/** `activeMs` only grows on the server (a stale tab can't shrink it). */
export const UpdateSessionRequestSchema = z.object({
  topicIds: z.array(z.string().uuid()).optional(),
  activeMs: z.number().int().min(0).optional(),
  pomodoros: z.number().int().min(0).optional(),
});
export type UpdateSessionRequest = z.infer<typeof UpdateSessionRequestSchema>;

export const EndSessionRequestSchema = z.object({
  activeMs: z.number().int().min(0).optional(),
  pomodoros: z.number().int().min(0).optional(),
});
export type EndSessionRequest = z.infer<typeof EndSessionRequestSchema>;

export const SessionDocumentDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  pages: z.number().int().nullable(),
  /** Documento indicato dalla task: va in evidenza, con le pagine pianificate. */
  highlighted: z.boolean(),
  pageRanges: z.array(z.object({ pageFrom: z.number().int(), pageTo: z.number().int() })),
  /** Argomenti della sessione a cui il documento appartiene (vuoto = solo dalla task). */
  topicIds: z.array(z.string().uuid()),
  hasContent: z.boolean(),
});
export type SessionDocumentDto = z.infer<typeof SessionDocumentDtoSchema>;

export const StudySessionDtoSchema = z.object({
  id: z.string().uuid(),
  subjectId: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  taskTitle: z.string().nullable(),
  taskMinutes: z.number().int().nullable(),
  status: z.enum(['active', 'ended']),
  topics: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  documents: z.array(SessionDocumentDtoSchema),
  activeMs: z.number().int(),
  pomodoros: z.number().int(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
});
export type StudySessionDto = z.infer<typeof StudySessionDtoSchema>;
