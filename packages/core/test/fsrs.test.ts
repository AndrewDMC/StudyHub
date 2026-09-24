import { describe, expect, it } from 'vitest';
import { isDue, newCardSchedule, retrievability, scheduleReview } from '../src/fsrs.js';

const FIXED_NOW = new Date('2026-01-01T09:00:00.000Z');

describe('newCardSchedule', () => {
  it('starts in state=new with no stability/difficulty/due yet', () => {
    const schedule = newCardSchedule();
    expect(schedule.state).toBe('new');
    expect(schedule.stability).toBeNull();
    expect(schedule.difficulty).toBeNull();
    expect(schedule.dueAt).toBeNull();
    expect(schedule.reps).toBe(0);
  });

  it('is always due (a card you have never seen is due today)', () => {
    expect(isDue(newCardSchedule(), FIXED_NOW)).toBe(true);
  });
});

describe('scheduleReview', () => {
  it('moves a new card out of state=new after any rating', () => {
    const result = scheduleReview(newCardSchedule(), 3, FIXED_NOW);
    expect(result.schedule.state).not.toBe('new');
    expect(result.schedule.stability).toBeGreaterThan(0);
    expect(result.schedule.reps).toBe(1);
    expect(result.schedule.lastReviewAt).toEqual(FIXED_NOW);
  });

  it('schedules a further-out due date for "Easy" than for "Again"', () => {
    const again = scheduleReview(newCardSchedule(), 1, FIXED_NOW);
    const easy = scheduleReview(newCardSchedule(), 4, FIXED_NOW);
    expect(easy.schedule.dueAt!.getTime()).toBeGreaterThan(again.schedule.dueAt!.getTime());
  });

  it('increments lapses on "Again" once the card has graduated to state=review', () => {
    // Keep rating "Good" at each card's own due date until it graduates out
    // of learning — FSRS's short-term steps mean this can take a few reps.
    let schedule = newCardSchedule();
    let now = FIXED_NOW;
    for (let i = 0; i < 10 && schedule.state !== 'review'; i += 1) {
      const result = scheduleReview(schedule, 3, now); // Good
      schedule = result.schedule;
      now = schedule.dueAt ?? now;
    }
    expect(schedule.state).toBe('review');
    const lapsesBefore = schedule.lapses;

    const afterLapse = scheduleReview(schedule, 1, now); // Again
    expect(afterLapse.schedule.lapses).toBeGreaterThan(lapsesBefore);
    expect(afterLapse.schedule.state).toBe('relearning');
  });

  it('reports prevStability as null for a card reviewed for the first time', () => {
    const result = scheduleReview(newCardSchedule(), 3, FIXED_NOW);
    expect(result.prevStability).toBeNull();
    expect(result.newStability).toBeGreaterThan(0);
  });

  it('reports prevStability from the schedule passed in on subsequent reviews', () => {
    const first = scheduleReview(newCardSchedule(), 3, FIXED_NOW);
    const second = scheduleReview(
      first.schedule,
      3,
      new Date(FIXED_NOW.getTime() + 2 * 86_400_000),
    );
    expect(second.prevStability).toBe(first.schedule.stability);
  });

  it('is deterministic: same input, same output', () => {
    const a = scheduleReview(newCardSchedule(), 3, FIXED_NOW);
    const b = scheduleReview(newCardSchedule(), 3, FIXED_NOW);
    expect(a.schedule).toEqual(b.schedule);
  });
});

describe('retrievability', () => {
  it('is 0 for a never-reviewed card', () => {
    expect(retrievability(newCardSchedule(), FIXED_NOW)).toBe(0);
  });

  it('is close to 1 immediately after a review and decays over time', () => {
    const { schedule } = scheduleReview(newCardSchedule(), 3, FIXED_NOW);
    const rightAfter = retrievability(schedule, FIXED_NOW);
    const muchLater = retrievability(schedule, new Date(FIXED_NOW.getTime() + 365 * 86_400_000));
    expect(rightAfter).toBeGreaterThan(0.9);
    expect(muchLater).toBeLessThan(rightAfter);
    expect(muchLater).toBeGreaterThanOrEqual(0);
  });
});

describe('isDue', () => {
  it('is false right after a review, true once the due date has passed', () => {
    const { schedule } = scheduleReview(newCardSchedule(), 3, FIXED_NOW);
    expect(isDue(schedule, FIXED_NOW)).toBe(false);
    expect(isDue(schedule, schedule.dueAt!)).toBe(true);
    expect(isDue(schedule, new Date(schedule.dueAt!.getTime() + 86_400_000))).toBe(true);
  });
});
