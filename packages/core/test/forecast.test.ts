import { describe, expect, it } from 'vitest';
import { cardsAtRiskForExam, forecastDueCounts } from '../src/forecast.js';
import { newCardSchedule, scheduleReview, type FlashcardSchedule } from '../src/fsrs.js';

const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');

describe('forecastDueCounts', () => {
  it('is deterministic with a fixed clock (F4 acceptance criterion)', () => {
    const schedules: Pick<FlashcardSchedule, 'dueAt' | 'state'>[] = [
      { state: 'review', dueAt: new Date('2026-01-02T00:00:00.000Z') },
      { state: 'review', dueAt: new Date('2026-01-02T00:00:00.000Z') },
      { state: 'review', dueAt: new Date('2026-01-05T00:00:00.000Z') },
    ];
    const a = forecastDueCounts(schedules, 7, FIXED_NOW);
    const b = forecastDueCounts(schedules, 7, FIXED_NOW);
    expect(a).toEqual(b);
  });

  it('buckets cards by calendar day and returns one entry per day in range', () => {
    const schedules: Pick<FlashcardSchedule, 'dueAt' | 'state'>[] = [
      { state: 'review', dueAt: new Date('2026-01-02T08:00:00.000Z') },
      { state: 'review', dueAt: new Date('2026-01-02T20:00:00.000Z') },
      { state: 'review', dueAt: new Date('2026-01-03T00:00:00.000Z') },
    ];
    const forecast = forecastDueCounts(schedules, 5, FIXED_NOW);
    expect(forecast).toHaveLength(5);
    expect(forecast[0]?.date).toBe('2026-01-01');
    expect(forecast[1]).toEqual({ date: '2026-01-02', count: 2 });
    expect(forecast[2]).toEqual({ date: '2026-01-03', count: 1 });
  });

  it('counts new (never-reviewed) cards as due today', () => {
    const forecast = forecastDueCounts([{ state: 'new', dueAt: null }], 3, FIXED_NOW);
    expect(forecast[0]).toEqual({ date: '2026-01-01', count: 1 });
  });

  it('folds overdue cards into "today" rather than dropping them', () => {
    const overdue: Pick<FlashcardSchedule, 'dueAt' | 'state'> = {
      state: 'review',
      dueAt: new Date('2025-12-20T00:00:00.000Z'),
    };
    const forecast = forecastDueCounts([overdue], 3, FIXED_NOW);
    expect(forecast[0]).toEqual({ date: '2026-01-01', count: 1 });
  });

  it('excludes cards due beyond the forecast horizon', () => {
    const farOut: Pick<FlashcardSchedule, 'dueAt' | 'state'> = {
      state: 'review',
      dueAt: new Date('2026-06-01T00:00:00.000Z'),
    };
    const forecast = forecastDueCounts([farOut], 7, FIXED_NOW);
    expect(forecast.reduce((sum, d) => sum + d.count, 0)).toBe(0);
  });

  it('matches the actual schedule produced by scheduleReview (forecast agrees with real scheduling)', () => {
    const { schedule } = scheduleReview(newCardSchedule(), 3, FIXED_NOW); // Good
    const forecast = forecastDueCounts([schedule], 30, FIXED_NOW);
    const total = forecast.reduce((sum, d) => sum + d.count, 0);
    expect(total).toBe(1); // the card's real due date must fall somewhere in a 30-day horizon
  });
});

describe('cardsAtRiskForExam', () => {
  it('flags a card whose retrievability decays below the threshold by the exam date', () => {
    const { schedule } = scheduleReview(newCardSchedule(), 1, FIXED_NOW); // Again -> short stability
    const examDate = new Date(FIXED_NOW.getTime() + 365 * 86_400_000); // a year away
    const atRisk = cardsAtRiskForExam([{ id: 'card-1', schedule }], examDate);
    expect(atRisk).toHaveLength(1);
    expect(atRisk[0]?.retrievabilityAtExam).toBeLessThan(0.7);
  });

  it('does not flag a card reviewed right before the exam', () => {
    const { schedule } = scheduleReview(newCardSchedule(), 4, FIXED_NOW); // Easy -> high stability
    const examDate = new Date(FIXED_NOW.getTime() + 60 * 60 * 1000); // 1 hour later
    const atRisk = cardsAtRiskForExam([{ id: 'card-1', schedule }], examDate);
    expect(atRisk).toHaveLength(0);
  });

  it('respects a custom threshold', () => {
    const { schedule } = scheduleReview(newCardSchedule(), 3, FIXED_NOW);
    const examDate = new Date(FIXED_NOW.getTime() + 10 * 86_400_000);
    const strict = cardsAtRiskForExam([{ id: 'x', schedule }], examDate, 0.99);
    const lenient = cardsAtRiskForExam([{ id: 'x', schedule }], examDate, 0.01);
    expect(strict.length).toBeGreaterThanOrEqual(lenient.length);
  });
});
