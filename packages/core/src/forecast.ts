import { retrievability, type FlashcardSchedule } from './fsrs.js';

export interface ForecastDay {
  date: string; // YYYY-MM-DD
  count: number;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Forecast of how many cards will be due on each of the next `days` days
 * (docs/fasi/F4-flashcard.md: "forecast dei prossimi 30 giorni"). Pure and
 * deterministic given a fixed `from` — the acceptance criterion asks for
 * exactly this: "test deterministico con clock fissato".
 */
export function forecastDueCounts(
  schedules: Pick<FlashcardSchedule, 'dueAt' | 'state'>[],
  days: number,
  from: Date = new Date(),
): ForecastDay[] {
  // UTC throughout: dayKey() buckets via toISOString(), which is UTC — mixing
  // that with local-time setHours()/setDate() shifted the "today" bucket by
  // a day on any machine not at UTC+0 (caught by this file's own tests).
  const startOfDay = new Date(from);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const buckets = new Map<string, number>();
  const result: ForecastDay[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(startOfDay);
    d.setUTCDate(d.getUTCDate() + i);
    const key = dayKey(d);
    buckets.set(key, 0);
    result.push({ date: key, count: 0 });
  }

  const horizonEnd = new Date(startOfDay);
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + days);

  for (const schedule of schedules) {
    // A never-reviewed card is due today, by definition (docs/fasi/F4 daily queue: new + review mix).
    const due = schedule.state === 'new' ? startOfDay : schedule.dueAt;
    if (!due || due >= horizonEnd) continue;
    const key = dayKey(due < startOfDay ? startOfDay : due); // overdue cards fall into "today"
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  return result.map((r) => ({ date: r.date, count: buckets.get(r.date) ?? 0 }));
}

export interface CardAtRisk<TId> {
  id: TId;
  retrievabilityAtExam: number;
}

/**
 * "Card a rischio per la data d'esame" (docs/fasi/F4-flashcard.md) — the
 * metric the Planner needs: projected retrievability at the exam date if
 * the card is never reviewed again before then, using FSRS's forgetting
 * curve from its last review. Below `threshold` (default 0.7) = at risk.
 */
export function cardsAtRiskForExam<TId>(
  cards: { id: TId; schedule: FlashcardSchedule }[],
  examDate: Date,
  threshold = 0.7,
): CardAtRisk<TId>[] {
  return cards
    .map((c) => ({ id: c.id, retrievabilityAtExam: retrievability(c.schedule, examDate) }))
    .filter((c) => c.retrievabilityAtExam < threshold);
}
