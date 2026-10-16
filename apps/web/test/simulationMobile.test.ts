import { describe, expect, it } from 'vitest';
import type { SimulationSummaryDto } from '@studyhub/contracts';
import { simulationSubtitle } from '../src/components/simulation-mobile/SimulationRow';
import {
  answeredCount,
  countBelowHalf,
  formatPoints,
  lowTimeAnnouncement,
  ratioTone,
  scoreFromRatio,
  simulationStatus,
} from '../src/lib/simulationMobile';

describe('simulationMobile', () => {
  it('formats points with at most one decimal', () => {
    expect(formatPoints(21)).toBe('21');
    expect(formatPoints(4.5)).toBe('4,5');
    expect(formatPoints(4.25)).toBe('4,3');
    expect(formatPoints(0)).toBe('0');
  });

  it('maps a ratio to a tone', () => {
    expect(ratioTone(1)).toBe('ok');
    expect(ratioTone(0.8)).toBe('ok');
    expect(ratioTone(0.79)).toBe('warn');
    expect(ratioTone(0.5)).toBe('warn');
    expect(ratioTone(0.49)).toBe('danger');
  });

  it('derives the status of a simulation', () => {
    const base = { attemptCount: 0, lastScoreRatio: null, openAttemptId: null };
    expect(simulationStatus(base)).toEqual({ label: 'Pronta', tone: 'accent' });
    expect(simulationStatus({ ...base, attemptCount: 1, openAttemptId: 'a' })).toEqual({
      label: 'In corso',
      tone: 'info',
    });
    expect(simulationStatus({ ...base, attemptCount: 1 })).toEqual({
      label: 'In correzione',
      tone: 'info',
    });
    expect(simulationStatus({ ...base, attemptCount: 2, lastScoreRatio: 0.7 })).toEqual({
      label: 'Corretta',
      tone: 'warn',
    });
  });

  it('converts the last-attempt ratio into points', () => {
    expect(scoreFromRatio({ lastScoreRatio: null, totalPoints: 30 })).toBeNull();
    expect(scoreFromRatio({ lastScoreRatio: 0.7, totalPoints: 30 })).toEqual({
      awarded: 21,
      max: 30,
    });
  });

  it('counts answered items ignoring blanks', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(answeredCount(items, { a: 'x', b: '   ' })).toBe(1);
    expect(answeredCount(items, {})).toBe(0);
  });

  it('counts items below half', () => {
    expect(
      countBelowHalf([
        { awarded: 1, max: 5 },
        { awarded: 2.5, max: 5 },
        { awarded: 0, max: 0 },
      ]),
    ).toBe(1);
  });

  it('announces the last minutes only', () => {
    expect(lowTimeAnnouncement(1200)).toBe('');
    expect(lowTimeAnnouncement(300)).toBe('Restano 5 minuti');
    expect(lowTimeAnnouncement(121)).toBe('Restano 3 minuti');
    expect(lowTimeAnnouncement(61)).toBe('Restano 2 minuti');
    expect(lowTimeAnnouncement(60)).toBe('Resta 1 minuto');
    expect(lowTimeAnnouncement(0)).toBe('Tempo scaduto');
  });
});

describe('simulationSubtitle', () => {
  const base = {
    itemCount: 6,
    timeBudgetMin: 180,
    attemptCount: 2,
    openAttemptId: null,
    lastScoreRatio: 0.7,
    createdAt: new Date(2026, 0, 1).toISOString(),
    lastGradedAt: null,
  } as unknown as SimulationSummaryDto;

  it('shows how long ago the last attempt was graded', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(simulationSubtitle({ ...base, lastGradedAt: yesterday })).toBe('Corretta · ieri');
  });

  it('falls back to the creation date for legacy rows', () => {
    expect(simulationSubtitle(base)).toMatch(/^Corretta · creata /);
  });
});
