import type { AttemptItemResultDto, ExamItemDto, SimulationSummaryDto } from '@studyhub/contracts';

export type Tone = 'accent' | 'ok' | 'warn' | 'danger' | 'info';

const numberFormat = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });

/** Points with at most one decimal and no trailing ",0": 21 → "21", 4.5 → "4,5". */
export function formatPoints(n: number): string {
  return numberFormat.format(n);
}

/** Score colour of the design: ok from 80%, warn from 50%, danger below. */
export function ratioTone(ratio: number): 'ok' | 'warn' | 'danger' {
  if (ratio >= 0.8) return 'ok';
  if (ratio >= 0.5) return 'warn';
  return 'danger';
}

type SimStatusInput = Pick<
  SimulationSummaryDto,
  'attemptCount' | 'lastScoreRatio' | 'openAttemptId'
>;

/** Label + tone of a simulation row: ready / in progress / graded. */
export function simulationStatus(sim: SimStatusInput): { label: string; tone: Tone } {
  if (sim.openAttemptId) return { label: 'In corso', tone: 'info' };
  if (sim.attemptCount === 0) return { label: 'Pronta', tone: 'accent' };
  if (sim.lastScoreRatio !== null) {
    return { label: 'Corretta', tone: ratioTone(sim.lastScoreRatio) };
  }
  return { label: 'In correzione', tone: 'info' };
}

/** Best score as points (`lastScoreRatio` is the best attempt, not the last one). */
export function scoreFromRatio(
  sim: Pick<SimulationSummaryDto, 'lastScoreRatio' | 'totalPoints'>,
): { awarded: number; max: number } | null {
  if (sim.lastScoreRatio === null) return null;
  return { awarded: sim.lastScoreRatio * sim.totalPoints, max: sim.totalPoints };
}

export function answeredCount(
  items: Pick<ExamItemDto, 'id'>[],
  answers: Record<string, string>,
): number {
  return items.filter((i) => (answers[i.id] ?? '').trim().length > 0).length;
}

/** Items scored under half of their maximum. */
export function countBelowHalf(results: Pick<AttemptItemResultDto, 'awarded' | 'max'>[]): number {
  return results.filter((r) => r.max > 0 && r.awarded / r.max < 0.5).length;
}

/** Screen-reader message for the last five minutes (changes once per minute); '' otherwise. */
export function lowTimeAnnouncement(remaining: number): string {
  if (remaining <= 0) return 'Tempo scaduto';
  if (remaining > 300) return '';
  const minutes = Math.ceil(remaining / 60);
  return minutes === 1 ? 'Resta 1 minuto' : `Restano ${minutes} minuti`;
}
