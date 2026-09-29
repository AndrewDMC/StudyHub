import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POMODORO,
  initialPomodoro,
  normalizePomodoroConfig,
  skipPomodoroPhase,
  tickPomodoro,
} from '../src/pomodoro.js';

const MIN = 60_000;
const cfg = DEFAULT_POMODORO;

describe('pomodoro', () => {
  it('starts in focus with a full focus phase', () => {
    expect(initialPomodoro(cfg)).toEqual({ phase: 'focus', completed: 0, remainingMs: 25 * MIN });
  });

  it('counts down inside a phase and reports focus time', () => {
    const t = tickPomodoro(initialPomodoro(cfg), cfg, 10 * MIN);
    expect(t.state.remainingMs).toBe(15 * MIN);
    expect(t.focusMs).toBe(10 * MIN);
    expect(t.finished).toEqual([]);
  });

  it('moves from focus to a short break, counting the pomodoro', () => {
    const t = tickPomodoro(initialPomodoro(cfg), cfg, 25 * MIN);
    expect(t.state).toEqual({ phase: 'short_break', completed: 1, remainingMs: 5 * MIN });
    expect(t.finished).toEqual(['focus']);
  });

  it('does not count break time as focus time', () => {
    const t = tickPomodoro(
      { phase: 'short_break', completed: 1, remainingMs: 5 * MIN },
      cfg,
      3 * MIN,
    );
    expect(t.focusMs).toBe(0);
  });

  it('takes a long break after every 4th focus', () => {
    const t = tickPomodoro({ phase: 'focus', completed: 3, remainingMs: MIN }, cfg, MIN);
    expect(t.state).toEqual({ phase: 'long_break', completed: 4, remainingMs: 15 * MIN });
  });

  it('crosses several phases in a single long tick (tab hidden, machine asleep)', () => {
    // focus 25 + break 5 + 7 minutes into the next focus
    const t = tickPomodoro(initialPomodoro(cfg), cfg, 37 * MIN);
    expect(t.finished).toEqual(['focus', 'short_break']);
    expect(t.state).toEqual({ phase: 'focus', completed: 1, remainingMs: 18 * MIN });
    expect(t.focusMs).toBe(25 * MIN + 7 * MIN);
  });

  it('skipping a focus does not count it; skipping a break starts the next focus', () => {
    const afterFocus = skipPomodoroPhase(initialPomodoro(cfg), cfg);
    expect(afterFocus).toEqual({ phase: 'short_break', completed: 0, remainingMs: 5 * MIN });
    expect(skipPomodoroPhase(afterFocus, cfg)).toEqual({
      phase: 'focus',
      completed: 0,
      remainingMs: 25 * MIN,
    });
  });

  it('normalizes a hand-edited config', () => {
    expect(
      normalizePomodoroConfig({
        focusMin: 0,
        shortBreakMin: 2.6,
        longBreakMin: NaN,
        cyclesBeforeLong: 999,
      }),
    ).toEqual({ focusMin: 1, shortBreakMin: 3, longBreakMin: 15, cyclesBeforeLong: 12 });
  });
});
