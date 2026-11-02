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

// ---- Lezione (docs/10-planner-lezioni.md §3) ----

/** `lesson` = una lezione del piano (o libera); `verify` = verifica a materiale chiuso (+3 / +7 g). */
export const StudySessionKindSchema = z.enum(['lesson', 'verify']);
export type StudySessionKind = z.infer<typeof StudySessionKindSchema>;

export const SessionMethodSchema = z.enum(['standard', 'sprint']);
export type SessionMethod = z.infer<typeof SessionMethodSchema>;

/** Fasi standard e sprint (esercizi prima). */
export const STANDARD_PHASES = ['explore', 'understand', 'rework', 'apply', 'recall'] as const;
export const SPRINT_PHASES = ['exercises', 'theory', 'retry', 'recall'] as const;
export const LessonPhaseSchema = z.enum([
  'explore',
  'understand',
  'rework',
  'apply',
  'recall',
  'exercises',
  'theory',
  'retry',
]);
export type LessonPhase = z.infer<typeof LessonPhaseSchema>;

/** `activeMs` only grows on the server (a stale tab can't shrink it). */
export const UpdateSessionRequestSchema = z.object({
  topicIds: z.array(z.string().uuid()).optional(),
  activeMs: z.number().int().min(0).optional(),
  pomodoros: z.number().int().min(0).optional(),
  /** La fase in cui si è: la lezione riprende da qui. */
  phase: LessonPhaseSchema.optional(),
  blockIndex: z.number().int().min(0).optional(),
});
export type UpdateSessionRequest = z.infer<typeof UpdateSessionRequestSchema>;

/** Com'è andata la sessione, scelto dallo studente in chiusura. */
export const SessionMoodSchema = z.enum(['hard', 'ok', 'good']);
export type SessionMood = z.infer<typeof SessionMoodSchema>;

export const EndSessionRequestSchema = z.object({
  activeMs: z.number().int().min(0).optional(),
  pomodoros: z.number().int().min(0).optional(),
  mood: SessionMoodSchema.optional(),
});
export type EndSessionRequest = z.infer<typeof EndSessionRequestSchema>;

/** `null` toglie il mood già scelto. */
export const SetSessionMoodRequestSchema = z.object({ mood: SessionMoodSchema.nullable() });
export type SetSessionMoodRequest = z.infer<typeof SetSessionMoodRequestSchema>;

/** Body opzionale di «Crea flashcard dai punti chiave»: assente = tutti i punti chiave della sessione. */
export const CreateKeyPointDeckRequestSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(200).optional(),
});
export type CreateKeyPointDeckRequest = z.infer<typeof CreateKeyPointDeckRequestSchema>;

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
  /** Mazzo di flashcard creato dai punti chiave alla chiusura (fase 4), se c'è. */
  flashcardDeckId: z.string().uuid().nullable(),
  /** Drill creato dagli esercizi sbagliati alla chiusura (fase 4), se c'è. */
  drillId: z.string().uuid().nullable(),
  mood: SessionMoodSchema.nullable().default(null),
  kind: StudySessionKindSchema.default('lesson'),
  method: SessionMethodSchema.default('standard'),
  /** Null = sessione di prima delle lezioni, senza fasi. */
  phase: LessonPhaseSchema.nullable().default(null),
  blockIndex: z.number().int().min(0).default(0),
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
  /** Ricerca approfondita, autorizzata dallo studente: il tutor può cercare anche fuori dagli appunti (web). */
  deepSearch: z.boolean().optional(),
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
  /** La domanda (e la sua risposta) ha usato la ricerca approfondita fuori dagli appunti. */
  deepSearch: z.boolean(),
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
  /** How many exercises to write (default: the briefing's); a verification asks only for what it lacks. */
  exerciseCount: z.number().int().min(1).max(5).optional(),
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

/**
 * Stato di un punto chiave (`open`/`done`) o di un esercizio (`open`/`correct`/`wrong`, autovalutato);
 * negli esercizi di una lezione sprint anche `unknown` ("non so da dove partire").
 */
export const SessionItemStateSchema = z.enum(['open', 'done', 'correct', 'wrong', 'unknown']);

export const UpdateSessionItemRequestSchema = z
  .object({
    state: SessionItemStateSchema.optional(),
    answer: z.string().max(8000).nullable().optional(),
    /** Esercizi di una lezione sprint: "Mostra soluzione" prima di autovalutarsi. */
    revealSolution: z.literal(true).optional(),
  })
  .refine(
    (v) => v.state !== undefined || v.answer !== undefined || v.revealSolution !== undefined,
    { message: 'Niente da aggiornare' },
  );
export type UpdateSessionItemRequest = z.infer<typeof UpdateSessionItemRequestSchema>;

export const SessionItemCitationDtoSchema = z.object({
  docId: z.string().uuid(),
  documentName: z.string(),
  page: z.number().int().positive(),
  quote: z.string(),
});
export type SessionItemCitationDto = z.infer<typeof SessionItemCitationDtoSchema>;

/** La correzione dell'AI di una risposta (docs/08 decisione 1): `score` da 0 a 1. */
export const SessionItemFeedbackDtoSchema = z.object({
  score: z.number().min(0).max(1),
  feedback: z.string(),
  missing: z.array(z.string()),
  model: z.string(),
  gradedAt: z.string().datetime(),
});
export type SessionItemFeedbackDto = z.infer<typeof SessionItemFeedbackDtoSchema>;

export const GradeSessionItemRequestSchema = z.object({
  model: z.string().min(1).max(100).optional(),
});
export type GradeSessionItemRequest = z.infer<typeof GradeSessionItemRequestSchema>;

/**
 * `guide_question`: a cosa risponde la lezione (Esplora); `explanation`: la spiegazione dello studente
 * (Rielabora); `retry_exercise`: l'esercizio simile che una lezione sprint ripropone (Riprova).
 */
export const SessionItemKindSchema = z.enum([
  'key_point',
  'exercise',
  'guide_question',
  'explanation',
  'retry_exercise',
]);
export type SessionItemKind = z.infer<typeof SessionItemKindSchema>;

/** Un passaggio di una soluzione (esercizi sprint). */
export const SolutionStepSchema = z.object({
  text: z.string(),
  /** Formula del passaggio (LaTeX), se c'è. */
  formula: z.string().optional(),
});
export type SolutionStep = z.infer<typeof SolutionStepSchema>;

export const SessionItemDtoSchema = z.object({
  id: z.string().uuid(),
  kind: SessionItemKindSchema,
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
  feedback: SessionItemFeedbackDtoSchema.nullable(),
  /** Esercizi sprint: i blocchi di teoria che servono a risolverli. */
  linkedBlockIds: z.array(z.string().uuid()).default([]),
  /** Esercizi sprint: i titoli dei concetti di teoria che servono (1-3). */
  concepts: z.array(z.string()).default([]),
  /** Esercizi sprint e riprove: la soluzione a passaggi (vuota finché `solutionVisible` è false). */
  solutionSteps: z.array(SolutionStepSchema).default([]),
  /**
   * Esercizi sprint e riprove: false finché lo studente non si autovaluta o chiede "Mostra soluzione";
   * allora `body` e `solutionSteps` sono vuoti. Sempre true per gli altri item.
   */
  solutionVisible: z.boolean().default(true),
  /** Riprove: l'esercizio che ripropongono. */
  parentItemId: z.string().uuid().nullable().default(null),
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
  /** Costo cumulativo di briefing e correzioni AI di questa sessione. */
  costEur: z.number(),
});
export type SessionBriefingDto = z.infer<typeof SessionBriefingDtoSchema>;

// ---- Chiusura: flashcard dai punti chiave e drill dagli esercizi sbagliati (fase 4) ----

export const SessionDeckResultSchema = z.object({
  deckId: z.string().uuid(),
  title: z.string(),
  cardCount: z.number().int().nonnegative(),
  /** false = esisteva già: la richiesta ripetuta restituisce lo stesso mazzo. */
  created: z.boolean(),
});
export type SessionDeckResult = z.infer<typeof SessionDeckResultSchema>;

export const SessionDrillResultSchema = z.object({
  simulationId: z.string().uuid(),
  title: z.string(),
  itemCount: z.number().int().nonnegative(),
  created: z.boolean(),
});
export type SessionDrillResult = z.infer<typeof SessionDrillResultSchema>;

// ---- Lezione guidata a blocchi (docs/10-planner-lezioni.md §3.2, fase Studia) ----

export const LessonExampleStepSchema = z.object({
  text: z.string(),
  /** Formula del passaggio (LaTeX), se c'è. */
  formula: z.string().optional(),
});
export type LessonExampleStep = z.infer<typeof LessonExampleStepSchema>;

/** `locked` finché non si risponde al controllo del blocco prima; `done` dopo il proprio. */
export const LessonBlockStateSchema = z.enum(['locked', 'open', 'done']);
export type LessonBlockState = z.infer<typeof LessonBlockStateSchema>;

export const LessonHintSchema = z.enum(['simpler', 'another_example', 'why']);
export type LessonHint = z.infer<typeof LessonHintSchema>;

export const LessonBlockDtoSchema = z.object({
  id: z.string().uuid(),
  orderIndex: z.number().int().min(0),
  title: z.string(),
  /** Spiegazione discorsiva, in markdown. */
  body: z.string(),
  /** Formula o enunciato (LaTeX). */
  formula: z.string().nullable(),
  exampleSteps: z.array(LessonExampleStepSchema),
  /** L'errore tipico all'esame. */
  trap: z.string().nullable(),
  /** "Prima di andare avanti". */
  checkQuestion: z.string().nullable(),
  /** La risposta attesa: null finché il blocco non è `done`. */
  checkAnswer: z.string().nullable(),
  citations: z.array(SessionItemCitationDtoSchema),
  state: LessonBlockStateSchema,
  studentAnswer: z.string().nullable(),
});
export type LessonBlockDto = z.infer<typeof LessonBlockDtoSchema>;

export const LessonDtoSchema = z.object({
  blocks: z.array(LessonBlockDtoSchema),
  /** Blocchi previsti in tutto: null finché non è pronto il primo. */
  blockCount: z.number().int().min(1).nullable(),
  /** L'ultimo job di generazione di un blocco, per "in preparazione" o l'errore con "riprova". */
  job: z
    .object({
      id: z.string().uuid(),
      blockIndex: z.number().int().min(0),
      status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
      error: z.string().nullable(),
    })
    .nullable(),
  /** Costo cumulativo della lezione generata finora. */
  costEur: z.number(),
});
export type LessonDto = z.infer<typeof LessonDtoSchema>;

/** Risposta con una frase alla domanda di controllo: l'esito sblocca il blocco dopo. */
export const CheckLessonBlockRequestSchema = z.object({
  answer: z.string().trim().min(1, 'Scrivi una risposta').max(4000),
});
export type CheckLessonBlockRequest = z.infer<typeof CheckLessonBlockRequestSchema>;

export const CheckLessonBlockResponseSchema = z.object({
  block: LessonBlockDtoSchema,
  /** `ok` = ci sei; `partial` = manca qualcosa; `wrong` = da rivedere. */
  verdict: z.enum(['ok', 'partial', 'wrong']),
  feedback: z.string(),
  nextBlock: LessonBlockDtoSchema.nullable(),
});
export type CheckLessonBlockResponse = z.infer<typeof CheckLessonBlockResponseSchema>;

/** "Rispiegamelo in un altro modo". */
export const RegenerateLessonBlockRequestSchema = z.object({
  hint: LessonHintSchema.optional(),
  model: z.string().min(1).max(100).optional(),
});
export type RegenerateLessonBlockRequest = z.infer<typeof RegenerateLessonBlockRequestSchema>;

export const GenerateLessonBlockJobInputSchema = z.object({
  subjectId: z.string().uuid(),
  sessionId: z.string().uuid(),
  blockIndex: z.number().int().min(0),
  /** true = rigenera un blocco già esistente ("in un altro modo"). */
  regenerate: z.boolean().default(false),
  hint: LessonHintSchema.optional(),
  model: z.string().optional(),
  force: z.boolean().default(false),
  /**
   * Lezione sprint: il blocco spiega solo `concept`, per l'esercizio `exercise` (il suo testo); è più
   * corto e non ha domande guida. Assente = blocco di una lezione standard.
   */
  focus: z.object({ concept: z.string().min(1), exercise: z.string() }).optional(),
});
export type GenerateLessonBlockJobInput = z.infer<typeof GenerateLessonBlockJobInputSchema>;

// ---- Rielabora: spiegazione con parole proprie (docs/10 §3.2) ----

export const SubmitExplanationRequestSchema = z.object({
  text: z.string().trim().min(20, 'Spiega con qualche frase in più').max(8000),
  model: z.string().min(1).max(100).optional(),
});
export type SubmitExplanationRequest = z.infer<typeof SubmitExplanationRequestSchema>;

const ExplanationPointSchema = z.object({
  text: z.string(),
  citation: SessionItemCitationDtoSchema.nullable(),
});

/** Confronto fra la spiegazione e il materiale: giusto · manca · attento. */
export const ExplanationFeedbackDtoSchema = z.object({
  correct: z.array(ExplanationPointSchema),
  missing: z.array(ExplanationPointSchema),
  wrong: z.array(ExplanationPointSchema),
  model: z.string(),
  gradedAt: z.string().datetime(),
});
export type ExplanationFeedbackDto = z.infer<typeof ExplanationFeedbackDtoSchema>;

/** Una spiegazione inviata, con il confronto quando il job ha finito (`null` finché è in attesa o fallito). */
export const ExplanationDtoSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  createdAt: z.string().datetime(),
  feedback: ExplanationFeedbackDtoSchema.nullable(),
});
export type ExplanationDto = z.infer<typeof ExplanationDtoSchema>;

/** L'ultima spiegazione e lo stato del job di confronto più recente. */
export const ExplanationStateDtoSchema = z.object({
  latest: ExplanationDtoSchema.nullable(),
  job: z
    .object({
      id: z.string().uuid(),
      status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
      error: z.string().nullable(),
    })
    .nullable(),
});
export type ExplanationStateDto = z.infer<typeof ExplanationStateDtoSchema>;

export const ExplainFeedbackJobInputSchema = z.object({
  subjectId: z.string().uuid(),
  sessionId: z.string().uuid(),
  /** La riga `session_items` di tipo `explanation`. */
  itemId: z.string().uuid(),
  model: z.string().optional(),
  force: z.boolean().default(false),
});
export type ExplainFeedbackJobInput = z.infer<typeof ExplainFeedbackJobInputSchema>;

// ---- Lezione sprint: esercizi, teoria, riprova, ricorda (docs/10-planner-lezioni.md §3.3) ----

export const GenerateSprintExercisesJobInputSchema = z.object({
  subjectId: z.string().uuid(),
  sessionId: z.string().uuid(),
  model: z.string().optional(),
  /** Bypasses the daily budget cap once, with an explicit ack. */
  force: z.boolean().default(false),
});
export type GenerateSprintExercisesJobInput = z.infer<typeof GenerateSprintExercisesJobInputSchema>;

/** Body di `POST .../sprint`: la generazione dei 3 esercizi (un solo costo, visibile). */
export const StartSprintRequestSchema = z.object({
  model: z.string().min(1).max(100).optional(),
  force: z.boolean().default(false),
});
export type StartSprintRequest = z.infer<typeof StartSprintRequestSchema>;

/** Body di `POST .../sprint/theory`: i blocchi dei concetti degli esercizi sbagliati. */
export const StartSprintTheoryRequestSchema = z.object({
  model: z.string().min(1).max(100).optional(),
  force: z.boolean().default(false),
});
export type StartSprintTheoryRequest = z.infer<typeof StartSprintTheoryRequestSchema>;

/**
 * Un concetto di teoria da rivedere. `blockId` è null finché il blocco non è pronto;
 * `exerciseIds` sono gli esercizi sbagliati (o "non so") che lo richiedono.
 */
export const SprintConceptDtoSchema = z.object({
  title: z.string(),
  exerciseIds: z.array(z.string().uuid()),
  blockId: z.string().uuid().nullable(),
});
export type SprintConceptDto = z.infer<typeof SprintConceptDtoSchema>;

/**
 * `idle` = i blocchi non sono ancora stati richiesti (o non c'è nulla di segnato); `generating`;
 * `ready` = tutti i blocchi dei concetti ci sono; `failed` = l'ultimo job è fallito;
 * `empty` = ogni esercizio è giusto: "Nessuna teoria da rivedere".
 */
export const SprintTheoryStateSchema = z.enum(['idle', 'generating', 'ready', 'failed', 'empty']);
export type SprintTheoryState = z.infer<typeof SprintTheoryStateSchema>;

export const SprintExerciseDtoSchema = SessionItemDtoSchema.extend({
  /** La riprova di questo esercizio, se è già stata generata. */
  retryId: z.string().uuid().nullable(),
});
export type SprintExerciseDto = z.infer<typeof SprintExerciseDtoSchema>;

export const SprintDtoSchema = z.object({
  /** I 3 esercizi (vuoto finché non sono generati), in ordine. */
  exercises: z.array(SprintExerciseDtoSchema),
  /**
   * Le riprove da fare: quelle degli esercizi sbagliati o "non so"; se nessuno lo è, solo quella del
   * primo esercizio. Ognuna ha `parentItemId`.
   */
  retries: z.array(SessionItemDtoSchema),
  theory: z.object({
    state: SprintTheoryStateSchema,
    /** Concetti degli esercizi sbagliati o "non so", deduplicati, nell'ordine degli esercizi. */
    concepts: z.array(SprintConceptDtoSchema),
    error: z.string().nullable(),
  }),
  /** L'ultimo job di generazione degli esercizi, per "in preparazione" o l'errore con "riprova". */
  job: z
    .object({
      id: z.string().uuid(),
      status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
      error: z.string().nullable(),
    })
    .nullable(),
  /** Costo cumulativo di esercizi, blocchi di teoria e correzioni di questa lezione. */
  costEur: z.number(),
});
export type SprintDto = z.infer<typeof SprintDtoSchema>;

/** Risposta di `POST .../sprint/theory`: i job accodati (vuoto = nulla da fare, idempotente). */
export const StartSprintTheoryResponseSchema = z.object({
  jobIds: z.array(z.string().uuid()),
  /** Quanti blocchi di teoria ha la lezione in tutto, dopo la richiesta. */
  blockCount: z.number().int().min(0),
});
export type StartSprintTheoryResponse = z.infer<typeof StartSprintTheoryResponseSchema>;

/** Per confrontare i concetti: minuscole, spazi compressi, senza punteggiatura finale. */
export function normalizeConcept(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.,;:!?]+$/u, '')
    .trim();
}

// ---- Verifica a materiale chiuso (+3 / +7 giorni, docs/10-planner-lezioni.md §3.5) ----

/** `partial` = la correzione l'ha giudicata a metà (vale 0.5 nella padronanza). */
export const VerifyVerdictSchema = z.enum(['correct', 'partial', 'wrong']);
export type VerifyDtoVerdict = z.infer<typeof VerifyVerdictSchema>;

/** Il punto chiave da riaprire: solo se l'esito non è giusto (mai per `correct` né per le domande ancora aperte). */
export const VerifyKeyPointDtoSchema = z.object({
  title: z.string(),
  /** Markdown. */
  body: z.string(),
  citation: SessionItemCitationDtoSchema.nullable(),
});
export type VerifyKeyPointDto = z.infer<typeof VerifyKeyPointDtoSchema>;

export const VerifyItemDtoSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['exercise', 'retry_exercise', 'guide_question']),
  orderIndex: z.number().int(),
  question: z.string(),
  /** `open` finché non c'è un esito; poi `correct`, `wrong` o `unknown` ("Non me lo ricordo"). */
  state: z.enum(['open', 'correct', 'wrong', 'unknown']),
  studentAnswer: z.string().nullable(),
  /** La correzione (verdetto + testo); `null` finché non corretta e per "Non me lo ricordo". */
  feedback: z.object({ verdict: VerifyVerdictSchema, text: z.string() }).nullable(),
  keyPoint: VerifyKeyPointDtoSchema.nullable(),
  /** La lezione da cui viene la domanda; `null` per le domande nuove. */
  originLessonTitle: z.string().nullable(),
});
export type VerifyItemDto = z.infer<typeof VerifyItemDtoSchema>;

export const VerifySummaryDtoSchema = z.object({
  /** Domande giuste (`correct`); `partial`, `wrong` e `unknown` non contano. */
  correct: z.number().int().min(0),
  total: z.number().int().min(0),
  /** Titolo del blocco di lezione o della domanda, per ogni punto non giusto. */
  unstable: z.array(z.string()),
  /** Data (YYYY-MM-DD) della prossima verifica dello stesso argomento nel piano. */
  nextVerifyDate: z.string().nullable(),
  /** Padronanza (0..1, come `topics.mastery`) all'avvio della verifica e ora. */
  masteryBefore: z.number().min(0).max(1).nullable(),
  masteryNow: z.number().min(0).max(1).nullable(),
});
export type VerifySummaryDto = z.infer<typeof VerifySummaryDtoSchema>;

export const VerifyStateDtoSchema = z.object({
  /** false = verifica di prima di questa funzione: il client tiene il layout di prima. */
  prepared: z.boolean(),
  ended: z.boolean(),
  subjectName: z.string(),
  topicName: z.string().nullable(),
  /** 3 o 7, dalla chiave `rev:*:02|03` della task; `null` se non deducibile. */
  daysOffset: z.union([z.literal(3), z.literal(7)]).nullable(),
  items: z.array(VerifyItemDtoSchema),
  /** La generazione di domande nuove (quando la lezione non ne ha abbastanza). */
  job: z
    .object({
      id: z.string().uuid(),
      status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
      error: z.string().nullable(),
    })
    .nullable(),
  /** Presente quando ogni domanda ha un esito. */
  summary: VerifySummaryDtoSchema.nullable(),
  /** Costo cumulativo di generazione e correzioni. */
  costEur: z.number(),
});
export type VerifyStateDto = z.infer<typeof VerifyStateDtoSchema>;

/** Body (opzionale) di `POST .../verify`: riprova a preparare le domande. */
export const StartVerifyRequestSchema = z.object({
  model: z.string().min(1).max(100).optional(),
  force: z.boolean().default(false),
});
export type StartVerifyRequest = z.infer<typeof StartVerifyRequestSchema>;
