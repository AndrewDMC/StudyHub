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
  /** Trascrizione della chat scritta alla chiusura, relativa alla cartella della materia. */
  transcriptPath: z.string().nullable(),
});
export type StudySessionDto = z.infer<typeof StudySessionDtoSchema>;

// ---- Chat (docs/08-sessione-di-studio.md §5.3) ----

/** Il passaggio selezionato nel viewer ("Chiedi all'AI"): entra sempre nel contesto della domanda. */
export const SessionFocusSchema = z.object({
  docId: z.string().uuid(),
  page: z.number().int().positive().nullable().default(null),
  text: z.string().trim().min(1).max(4000),
});
export type SessionFocus = z.infer<typeof SessionFocusSchema>;

export const SendSessionMessageRequestSchema = z.object({
  content: z.string().trim().min(1, 'Scrivi una domanda').max(4000),
  focus: SessionFocusSchema.optional(),
  /** Modello della chat; assente = quello veloce. */
  model: z.string().min(1).max(100).optional(),
});
export type SendSessionMessageRequest = z.infer<typeof SendSessionMessageRequestSchema>;

export const SessionCitationDtoSchema = z.object({
  /** Il marcatore `[n]` nel testo della risposta. */
  ref: z.number().int().positive(),
  chunkId: z.string().uuid(),
  docId: z.string().uuid(),
  documentName: z.string(),
  page: z.number().int().positive(),
});
export type SessionCitationDto = z.infer<typeof SessionCitationDtoSchema>;

export const SessionMessageDtoSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  focus: SessionFocusSchema.nullable(),
  citations: z.array(SessionCitationDtoSchema),
  model: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type SessionMessageDto = z.infer<typeof SessionMessageDtoSchema>;

export const SessionChatDtoSchema = z.object({
  messages: z.array(SessionMessageDtoSchema),
  /** Costo cumulativo della chat in questa sessione (visibile nella testata, docs/08 §9.2). */
  costEur: z.number(),
});
export type SessionChatDto = z.infer<typeof SessionChatDtoSchema>;

/** Eventi dello stream SSE di `POST .../messages`, uno per riga `data:`. */
export type SessionChatEvent =
  | { type: 'user'; message: SessionMessageDto }
  | { type: 'delta'; text: string }
  | { type: 'done'; message: SessionMessageDto; costEur: number }
  | { type: 'error'; message: string };

// ---- Briefing: punti chiave ed esercizi (docs/08-sessione-di-studio.md §5.2, fase 3) ----

/** `all` = punti chiave + esercizi (una sola volta per sessione); `exercises` = "altri esercizi". */
export const SessionBriefingModeSchema = z.enum(['all', 'exercises']);
export type SessionBriefingMode = z.infer<typeof SessionBriefingModeSchema>;

export const PrepareSessionJobInputSchema = z.object({
  subjectId: z.string().uuid(),
  sessionId: z.string().uuid(),
  mode: SessionBriefingModeSchema.default('all'),
  model: z.string().optional(),
  /** Bypasses the daily budget cap once, with an explicit ack. */
  force: z.boolean().default(false),
});
export type PrepareSessionJobInput = z.infer<typeof PrepareSessionJobInputSchema>;

export const StartBriefingRequestSchema = z.object({
  mode: SessionBriefingModeSchema.default('all'),
  model: z.string().min(1).max(100).optional(),
  force: z.boolean().default(false),
});
export type StartBriefingRequest = z.infer<typeof StartBriefingRequestSchema>;

export const EstimateBriefingRequestSchema = z.object({
  mode: SessionBriefingModeSchema.default('all'),
  model: z.string().min(1).max(100),
});
export type EstimateBriefingRequest = z.infer<typeof EstimateBriefingRequestSchema>;

export const EstimateBriefingResponseSchema = z.object({
  model: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costEur: z.number().nonnegative(),
});
export type EstimateBriefingResponse = z.infer<typeof EstimateBriefingResponseSchema>;

/** Stato di un punto chiave (`open`/`done`) o di un esercizio (`open`/`correct`/`wrong`, autovalutato). */
export const SessionItemStateSchema = z.enum(['open', 'done', 'correct', 'wrong']);

export const UpdateSessionItemRequestSchema = z
  .object({
    state: SessionItemStateSchema.optional(),
    answer: z.string().max(8000).nullable().optional(),
  })
  .refine((v) => v.state !== undefined || v.answer !== undefined, {
    message: 'Niente da aggiornare',
  });
export type UpdateSessionItemRequest = z.infer<typeof UpdateSessionItemRequestSchema>;

export const SessionItemCitationDtoSchema = z.object({
  docId: z.string().uuid(),
  documentName: z.string(),
  page: z.number().int().positive(),
  quote: z.string(),
});
export type SessionItemCitationDto = z.infer<typeof SessionItemCitationDtoSchema>;

export const SessionItemDtoSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['key_point', 'exercise']),
  orderIndex: z.number().int(),
  /** Il punto chiave, oppure il testo dell'esercizio. */
  title: z.string(),
  /** La spiegazione, oppure la soluzione attesa. */
  body: z.string(),
  difficulty: z.number().int().min(1).max(3).nullable(),
  citations: z.array(SessionItemCitationDtoSchema),
  topicId: z.string().uuid().nullable(),
  state: SessionItemStateSchema,
  answer: z.string().nullable(),
});
export type SessionItemDto = z.infer<typeof SessionItemDtoSchema>;

export const BriefingJobDtoSchema = z.object({
  id: z.string().uuid(),
  mode: SessionBriefingModeSchema,
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  error: z.string().nullable(),
});
export type BriefingJobDto = z.infer<typeof BriefingJobDtoSchema>;

export const SessionBriefingDtoSchema = z.object({
  items: z.array(SessionItemDtoSchema),
  /** L'ultimo job di preparazione, per mostrare "in corso" o l'errore con "riprova". */
  job: BriefingJobDtoSchema.nullable(),
  /** Costo cumulativo dei job di briefing di questa sessione. */
  costEur: z.number(),
});
export type SessionBriefingDto = z.infer<typeof SessionBriefingDtoSchema>;
