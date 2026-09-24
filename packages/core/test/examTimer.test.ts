import { describe, expect, it } from 'vitest';
import { isExpired, remainingSeconds } from '../src/examTimer.js';

const START = new Date('2026-01-15T09:00:00.000Z');

describe('remainingSeconds', () => {
  it('is the full duration at start', () => {
    expect(remainingSeconds(START, 120, START)).toBe(7200);
  });

  it('survives a "reload": derived from startedAt, so 10 minutes later shows 110 minutes left', () => {
    const tenMinutesLater = new Date(START.getTime() + 10 * 60_000);
    expect(remainingSeconds(START, 120, tenMinutesLater)).toBe(110 * 60);
  });

  it('never goes negative after the deadline', () => {
    const muchLater = new Date(START.getTime() + 5 * 3600_000);
    expect(remainingSeconds(START, 120, muchLater)).toBe(0);
    expect(isExpired(START, 120, muchLater)).toBe(true);
  });

  it('is not expired one second before the end', () => {
    const almost = new Date(START.getTime() + 120 * 60_000 - 1000);
    expect(isExpired(START, 120, almost)).toBe(false);
  });
});
