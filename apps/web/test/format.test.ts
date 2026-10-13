import { describe, expect, it } from 'vitest';
import { formatInterval } from '../src/lib/format';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatInterval', () => {
  it.each([
    [0, '<1 min'],
    [59_000, '<1 min'],
    [MIN, '1 min'],
    [8 * MIN, '8 min'],
    [59 * MIN, '59 min'],
    [3 * HOUR, '3 h'],
    [23 * HOUR, '23 h'],
    [DAY, '1 g'],
    [4 * DAY, '4 g'],
    [29 * DAY, '29 g'],
    [30 * DAY, '1 mese'],
    [62 * DAY, '2 mesi'],
    [365 * DAY, '1 anno'],
    [548 * DAY, '1,5 anni'],
  ])('%i ms → %s', (ms, label) => {
    expect(formatInterval(ms)).toBe(label);
  });
});
