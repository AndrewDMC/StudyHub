import { describe, expect, it } from 'vitest';
import { applyPlanChange, type PlanChange, type PlanInputs } from '../../src/planner/change.js';

const current: PlanInputs = {
  targetDate: '2026-11-03',
  availability: { perWeekday: [0, 90, 90, 90, 90, 90, 60], blackoutDates: ['2026-10-30'] },
  prefs: {
    sessionLength: 50,
    intensity: 'standard',
    simulationCount: 'auto',
    simulationMinutes: 90,
    reviewMinutesPerCard: 0.5,
  },
};
const none: PlanChange = {
  targetDate: null,
  perWeekday: null,
  addBlackoutDates: [],
  removeBlackoutDates: [],
  intensity: null,
  sessionLength: null,
  simulationCount: null,
  excludeTopicIds: [],
  includeTopicIds: [],
};
const ctx = { today: '2026-10-28', allTopicIds: ['a', 'b', 'c'] };

describe('applyPlanChange', () => {
  it('changes only what was asked', () => {
    const { inputs, rejected } = applyPlanChange(
      current,
      { ...none, perWeekday: [null, 180, 180, 180, 180, 180, 0], intensity: 'sprint' },
      ctx,
    );
    expect(inputs.availability.perWeekday).toEqual([0, 180, 180, 180, 180, 180, 0]);
    expect(inputs.prefs.intensity).toBe('sprint');
    expect(inputs.prefs.sessionLength).toBe(50);
    expect(inputs.targetDate).toBe('2026-11-03');
    expect(rejected).toEqual([]);
  });

  it('refuses an exam date not after today and days off outside the window', () => {
    const { inputs, rejected } = applyPlanChange(
      current,
      { ...none, targetDate: '2026-10-20', addBlackoutDates: ['2026-12-25', '2026-10-31'] },
      ctx,
    );
    expect(inputs.targetDate).toBe('2026-11-03');
    expect(inputs.availability.blackoutDates).toEqual(['2026-10-30', '2026-10-31']);
    expect(rejected).toHaveLength(2);
  });

  it('drops days off that fall after a moved-up exam', () => {
    const { inputs } = applyPlanChange(current, { ...none, targetDate: '2026-10-30' }, ctx);
    expect(inputs.availability.blackoutDates).toEqual([]);
  });

  it('excludes and re-includes topics, never leaving the plan empty or trusting unknown ids', () => {
    const excluded = applyPlanChange(current, { ...none, excludeTopicIds: ['b', 'zzz'] }, ctx);
    expect(excluded.inputs.topicIds).toEqual(['a', 'c']);
    expect(excluded.rejected).toHaveLength(1);

    const back = applyPlanChange(excluded.inputs, { ...none, includeTopicIds: ['b'] }, ctx);
    expect(back.inputs.topicIds).toBeUndefined();

    const empty = applyPlanChange(current, { ...none, excludeTopicIds: ['a', 'b', 'c'] }, ctx);
    expect(empty.inputs.topicIds).toBeUndefined();
    expect(empty.rejected).toHaveLength(1);
  });
});
