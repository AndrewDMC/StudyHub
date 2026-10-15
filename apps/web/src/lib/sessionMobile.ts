import { phaseDurationMs, type PomodoroConfig, type PomodoroState } from '@studyhub/core/browser';
import type { SessionDocumentDto, StudySessionDto, TaskDto } from '@studyhub/contracts';
import { PHASE_LABELS, type TimerMode } from '@/components/PomodoroTimer';
import { minutes } from '@/components/SessionClosing';
import { todayIso } from '@/components/subject-mobile/queries';

/** Circumference of the 44px timer ring (r = 19). */
export const RING_CIRCUMFERENCE = 119.4;

/** Stroke offset of the timer ring: full at the start of a phase, empty at the end. */
export function ringDashOffset(
  state: PomodoroState,
  config: PomodoroConfig,
  circumference = RING_CIRCUMFERENCE,
): number {
  const total = phaseDurationMs(state.phase, config);
  const ratio = total > 0 ? Math.min(1, Math.max(0, state.remainingMs / total)) : 0;
  return circumference * (1 - ratio);
}

/** Small caption under the clock. */
export function timerCaption(
  mode: TimerMode,
  state: PomodoroState,
  config: PomodoroConfig,
): string {
  if (mode === 'free') return 'Modalità libera';
  if (state.phase !== 'focus') return PHASE_LABELS[state.phase];
  const inGroup = state.completed % config.cyclesBeforeLong;
  return `Focus · pomodoro ${inGroup + 1} di ${config.cyclesBeforeLong}`;
}

/** "48m", "1h", "1h 12m" (minutes never below 1 for a session that really ran). */
export function formatStudyTime(ms: number): string {
  const total = minutes(ms);
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** First open task from today on that is not the one just closed (same rule as the overview's "first open"). */
export function pickNextTask(
  tasks: TaskDto[],
  excludeTaskId: string | null,
  today: string = todayIso(),
): TaskDto | null {
  return (
    tasks.find(
      (t) =>
        t.date >= today &&
        (t.status === 'todo' || t.status === 'doing') &&
        t.id !== excludeTaskId &&
        t.kind !== 'rest',
    ) ?? null
  );
}

/** "pagina 8", "pagine 8–11", several ranges joined by ", "; empty when the document has none. */
export function formatPageRanges(doc: SessionDocumentDto): string {
  return doc.pageRanges
    .map((r) =>
      r.pageFrom === r.pageTo ? `pagina ${r.pageFrom}` : `pagine ${r.pageFrom}–${r.pageTo}`,
    )
    .join(', ');
}

export function sessionTitle(session: Pick<StudySessionDto, 'taskTitle' | 'topics'>): string {
  return session.taskTitle ?? (session.topics.map((t) => t.name).join(', ') || 'Studio libero');
}

/** Wrong exercises the drill can use: it anchors every item to a source, so uncited ones are left out. */
export function drillItems<T extends { kind: string; state: string; citations: unknown[] }>(
  items: T[],
): T[] {
  return items.filter(
    (i) => i.kind === 'exercise' && i.state === 'wrong' && i.citations.length > 0,
  );
}
