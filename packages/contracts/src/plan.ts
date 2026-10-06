import { z } from 'zod';

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida (atteso YYYY-MM-DD)');

export const IntensitySchema = z.enum(['sostenibile', 'standard', 'sprint']);
export type Intensity = z.infer<typeof IntensitySchema>;

export const AvailabilitySchema = z.object({
  /** Minutes per weekday, index 0 = Sunday … 6 = Saturday. */
  perWeekday: z
    .array(
      z
        .number()
        .int()
        .min(0)
        .max(24 * 60),
    )
    .length(7),
  blackoutDates: z.array(IsoDateSchema),
});

export const PlannerPrefsSchema = z.object({
  sessionLength: z.number().int().min(10).max(180).default(50),
  intensity: IntensitySchema.default('standard'),
  simulationCount: z.union([z.literal('auto'), z.number().int().min(0).max(10)]).default('auto'),
  simulationMinutes: z.number().int().min(15).max(240).default(90),
  reviewMinutesPerCard: z.number().min(0.1).max(5).default(0.5),
});

/**
 * `generate_plan` (docs/04-planner.md §1-3): Fase A (AI estimate, per document
 * in this slice — see docs/fasi/F6-planner-calendario.md "Stato") + Fase B
 * (pure scheduling, `packages/core/src/planner/schedule.ts`) in one job.
 * Always produces a fresh `draft` plan — regenerating from the wizard before
 * committing is expected, not an error, so this is not idempotent like the
 * F3/F5 generation jobs (docs/04-planner.md §9.1: a draft has no effect on
 * the rest of the app until committed).
 */
export const GeneratePlanJobInputSchema = z.object({
  subjectId: z.string().uuid(),
  /** The exam or partial this plan prepares for; plans of different exams of one subject coexist. */
  examId: z.string().uuid().optional(),
  /** Topics the plan covers (a partial's syllabus). Absent = the whole subject. */
  topicIds: z.array(z.string().uuid()).min(1).max(500).optional(),
  /** The student's description of the exam, sent to the estimating model. Saved on the exam when `examId` is set. */
  notes: z.string().trim().max(2000).optional(),
  startDate: IsoDateSchema,
  targetDate: IsoDateSchema,
  availability: AvailabilitySchema,
  prefs: PlannerPrefsSchema,
  model: z.string().optional(),
  force: z.boolean().default(false),
});
export type GeneratePlanJobInput = z.infer<typeof GeneratePlanJobInputSchema>;

/** Wizard request body: same as the job input, minus the server-resolved `subjectId`. */
export const GeneratePlanRequestSchema = GeneratePlanJobInputSchema.omit({ subjectId: true });
export type GeneratePlanRequest = z.infer<typeof GeneratePlanRequestSchema>;

export const TaskKindSchema = z.enum([
  'read',
  'flashcards',
  'schema',
  'simulation',
  'drill',
  'rest',
  'review',
]);
export const TaskStatusSchema = z.enum(['proposed', 'todo', 'doing', 'done', 'skipped', 'moved']);
export const TaskOriginSchema = z.enum(['planner', 'manual']);

export const TaskPayloadSchema = z.object({
  action: z.enum(['read', 'generate_flashcards', 'review_session', 'simulation', 'manual']),
  material: z
    .array(
      z.object({ docId: z.string().uuid(), pageFrom: z.number().int(), pageTo: z.number().int() }),
    )
    .optional(),
  topicId: z.string().uuid().nullable().optional(),
});

export const TaskDtoSchema = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid(),
  taskKey: z.string(),
  date: IsoDateSchema,
  kind: TaskKindSchema,
  topicKey: z.string().nullable(),
  topicId: z.string().uuid().nullable(),
  minutes: z.number().int(),
  title: z.string(),
  description: z.string(),
  payload: TaskPayloadSchema,
  pinned: z.boolean(),
  origin: TaskOriginSchema,
  status: TaskStatusSchema,
});
export type TaskDto = z.infer<typeof TaskDtoSchema>;

export const PlanStatusSchema = z.enum(['draft', 'active', 'superseded']);

const StrategySchema = z.object({
  id: z.enum(['copertura_superficiale', 'focus_80', 'estendi_data']),
  label: z.string(),
  description: z.string(),
});

export const FeasibilityDtoSchema = z.object({
  feasible: z.boolean(),
  requiredMinutes: z.number(),
  availableMinutes: z.number(),
  shortfallMinutes: z.number(),
  unscheduledTopicKeys: z.array(z.string()),
  strategies: z.array(StrategySchema),
});

export const DayLoadDtoSchema = z.object({
  date: IsoDateSchema,
  available: z.number(),
  planned: z.number(),
});

export const PlanDtoSchema = z.object({
  id: z.string().uuid(),
  subjectId: z.string().uuid(),
  examId: z.string().uuid().nullable(),
  status: PlanStatusSchema,
  startDate: IsoDateSchema,
  targetDate: IsoDateSchema,
  availability: AvailabilitySchema,
  prefs: PlannerPrefsSchema,
  feasibility: FeasibilityDtoSchema,
  warnings: z.array(z.string()),
  loadPerDay: z.array(DayLoadDtoSchema),
  tasks: z.array(TaskDtoSchema),
  createdAt: z.string().datetime(),
  committedAt: z.string().datetime().nullable(),
});
export type PlanDto = z.infer<typeof PlanDtoSchema>;

export const MoveTaskRequestSchema = z.object({ date: IsoDateSchema });
export type MoveTaskRequest = z.infer<typeof MoveTaskRequestSchema>;

/** Daily Task widget actions on an already-committed task (docs/fasi/F7-dashboard-polish.md "Oggi"). */
export const UpdateTaskStatusRequestSchema = z.object({
  status: z.enum(['todo', 'doing', 'done', 'skipped']),
});
export type UpdateTaskStatusRequest = z.infer<typeof UpdateTaskStatusRequestSchema>;

/** `pinned` lets the review screen lock a task before a recalculation (docs/04 §9.2). */
export const UpdateTaskRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  minutes: z.number().int().min(5).max(600).optional(),
  pinned: z.boolean().optional(),
});
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;

/** "Aggiungi una task manuale — non tutto nasce dall'AI" (docs/04-planner.md §9.2). */
export const CreateManualTaskRequestSchema = z.object({
  date: IsoDateSchema,
  kind: TaskKindSchema,
  minutes: z.number().int().min(5).max(600),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(''),
  topicId: z.string().uuid().nullable().optional(),
});
export type CreateManualTaskRequest = z.infer<typeof CreateManualTaskRequestSchema>;

export const DiffRowDtoSchema = z.object({
  change: z.enum(['added', 'removed', 'moved', 'resized']),
  key: z.string(),
  title: z.string(),
  topicKey: z.string().nullable(),
  from: IsoDateSchema.nullable(),
  to: IsoDateSchema.nullable(),
  reason: z.string(),
});

/** docs/04-planner.md §9.5: "si approva il diff, non il piano". */
export const PlanDiffDtoSchema = z.object({
  rows: z.array(DiffRowDtoSchema),
  unchanged: z.number().int(),
  summary: z.array(z.string()),
});
export type PlanDiffDto = z.infer<typeof PlanDiffDtoSchema>;

/**
 * "Al rientro il sistema propone un ricalcolo" (docs/04-planner.md) —
 * `detectDrift` (`packages/core/src/planner/adapt.ts`) compared against the
 * active plan's own tasks, docs/fasi/F6-planner-calendario.md "Stato".
 */
export const DriftReportDtoSchema = z.object({
  overdueKeys: z.array(z.string()),
  missedDays: z.array(IsoDateSchema),
  shouldRecalculate: z.boolean(),
  reason: z.string().nullable(),
});
export type DriftReportDto = z.infer<typeof DriftReportDtoSchema>;

/** Load of one week of the plan window (weeks start on Monday) — the wizard's preview chart. */
export const WeekLoadDtoSchema = z.object({
  weekStart: IsoDateSchema,
  available: z.number(),
  planned: z.number(),
});
export type WeekLoadDto = z.infer<typeof WeekLoadDtoSchema>;

/**
 * Free, model-less preview shown *before* generating (docs/fasi/F6: "il wizard
 * dichiara il tempo insufficiente prima di generare"): Fase B run on a
 * page-based estimate. `estimate` is always `heuristic` — the job's real Fase A
 * refines it, so the numbers are an approximation, not a promise.
 */
export const PlanPreviewDtoSchema = z.object({
  estimate: z.literal('heuristic'),
  topicCount: z.number().int(),
  taskCount: z.number().int(),
  feasibility: FeasibilityDtoSchema,
  warnings: z.array(z.string()),
  loadPerWeek: z.array(WeekLoadDtoSchema),
  /** Minutes taken out of the window by other subjects' tasks and imported events. */
  busyMinutes: z.number(),
  /** The student's personal estimate-vs-real factor applied to the estimates (1 = not enough data). */
  timeFactor: z.object({
    factor: z.number(),
    sampleCount: z.number().int(),
    /** "sottostimi del 40%", or null when there is nothing worth saying. */
    note: z.string().nullable(),
  }),
});
export type PlanPreviewDto = z.infer<typeof PlanPreviewDtoSchema>;

/** Bulk edits on the draft under review (docs/fasi/F6 "Azioni bulk"). */
export const BulkPlanActionRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('shift'),
    days: z.number().int().min(-30).max(30),
    from: IsoDateSchema.optional(),
  }),
  z.object({ type: z.literal('reduce_load'), percent: z.number().min(1).max(90) }),
  z.object({ type: z.literal('exclude_topic'), topicKey: z.string().min(1) }),
]);
export type BulkPlanActionRequest = z.infer<typeof BulkPlanActionRequestSchema>;
