import type { IsoDate } from './dates.js';

/** docs/02-filesystem-e-dati.md §3 `tasks.kind`. */
export type TaskKind =
  'read' | 'flashcards' | 'schema' | 'simulation' | 'drill' | 'rest' | 'review';

export interface MaterialRef {
  docId: string;
  pageFrom: number;
  pageTo: number;
}

/**
 * What a click on the task does (docs/04-planner.md §5: "ogni task è
 * azionabile in un click"). A task whose payload can't say *with which
 * material* it is done is never created (docs/fasi/F6 "Decisioni").
 */
export interface TaskPayload {
  action: 'read' | 'generate_flashcards' | 'review_session' | 'simulation' | 'manual';
  material?: MaterialRef[];
  topicId?: string | null;
}

/**
 * A unit the scheduler plans for: a real topic, or — when the subject has
 * no topics — a document standing in for one. Produced by Fase A (AI
 * estimates) or by the heuristic estimate for the pre-generation preview.
 */
export interface PlannerTopic {
  key: string;
  topicId: string | null;
  name: string;
  /** First-pass learning time. */
  estimatedMinutes: number;
  difficulty: number; // 1..5
  examWeight: number; // 0..1
  prerequisites: string[]; // other PlannerTopic keys
  mastery: number | null; // 0..1
  material: MaterialRef[];
}

export interface Availability {
  /** Minutes per weekday, index 0 = Sunday … 6 = Saturday. */
  perWeekday: number[];
  blackoutDates: IsoDate[];
}

export type Intensity = 'sostenibile' | 'standard' | 'sprint';

export interface PlannerPrefs {
  sessionLength: number;
  intensity: Intensity;
  simulationCount: number | 'auto';
  simulationMinutes: number;
  reviewMinutesPerCard: number;
}

export interface PlannedTask {
  /** Deterministic within a plan — the identity used by diffs and idempotent commits. */
  key: string;
  date: IsoDate;
  kind: TaskKind;
  topicKey: string | null;
  topicId: string | null;
  minutes: number;
  title: string;
  description: string;
  payload: TaskPayload;
  pinned: boolean;
  origin: 'planner' | 'manual';
}

export interface PlannerInput {
  /** First study day. */
  startDate: IsoDate;
  /** Exam day — never a study day. */
  targetDate: IsoDate;
  availability: Availability;
  topics: PlannerTopic[];
  prefs: PlannerPrefs;
  /** FSRS cards due per day (from the forecast) — "precedenza assoluta". */
  dueCardsByDate?: Record<IsoDate, number>;
  /** Minutes already taken per day: other subjects' active tasks, blocking calendar events. */
  busyMinutesByDate?: Record<IsoDate, number>;
  /** Tasks the user pinned: kept exactly where they are, their minutes consumed first. */
  pinned?: PlannedTask[];
}

export interface DayLoad {
  date: IsoDate;
  available: number;
  planned: number;
}

export interface Strategy {
  id: 'copertura_superficiale' | 'focus_80' | 'estendi_data';
  label: string;
  description: string;
}

export interface Feasibility {
  feasible: boolean;
  requiredMinutes: number;
  availableMinutes: number;
  shortfallMinutes: number;
  unscheduledTopicKeys: string[];
  strategies: Strategy[];
}

export interface PlanResult {
  tasks: PlannedTask[];
  loadPerDay: DayLoad[];
  feasibility: Feasibility;
  warnings: string[];
}
