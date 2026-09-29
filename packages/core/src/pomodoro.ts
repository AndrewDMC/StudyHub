/**
 * Pomodoro state machine (docs/08-sessione-di-studio.md). Pure and clock-free:
 * the UI feeds it elapsed milliseconds, so it is testable without timers.
 * Classic cycle: focus -> short break, and every `cyclesBeforeLong`-th focus is
 * followed by a long break instead.
 */
export type PomodoroPhase = 'focus' | 'short_break' | 'long_break';

export interface PomodoroConfig {
  focusMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  cyclesBeforeLong: number;
}

export const DEFAULT_POMODORO: PomodoroConfig = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  cyclesBeforeLong: 4,
};

export interface PomodoroState {
  phase: PomodoroPhase;
  /** Focus phases completed in this session. */
  completed: number;
  remainingMs: number;
}

export interface PomodoroTick {
  state: PomodoroState;
  /** Focus milliseconds inside this tick — the only time that counts as study time. */
  focusMs: number;
  /** Phases that ended during the tick, in order (a long tick can cross several). */
  finished: PomodoroPhase[];
}

/** Keeps a user-edited config sane: whole minutes, at least 1, at most a day. */
export function normalizePomodoroConfig(input: Partial<PomodoroConfig>): PomodoroConfig {
  const pick = (value: number | undefined, fallback: number, max: number) =>
    Number.isFinite(value) ? Math.min(max, Math.max(1, Math.round(value as number))) : fallback;
  return {
    focusMin: pick(input.focusMin, DEFAULT_POMODORO.focusMin, 180),
    shortBreakMin: pick(input.shortBreakMin, DEFAULT_POMODORO.shortBreakMin, 60),
    longBreakMin: pick(input.longBreakMin, DEFAULT_POMODORO.longBreakMin, 120),
    cyclesBeforeLong: pick(input.cyclesBeforeLong, DEFAULT_POMODORO.cyclesBeforeLong, 12),
  };
}

export function phaseDurationMs(phase: PomodoroPhase, config: PomodoroConfig): number {
  const minutes =
    phase === 'focus'
      ? config.focusMin
      : phase === 'short_break'
        ? config.shortBreakMin
        : config.longBreakMin;
  return minutes * 60_000;
}

export function initialPomodoro(config: PomodoroConfig, completed = 0): PomodoroState {
  return { phase: 'focus', completed, remainingMs: phaseDurationMs('focus', config) };
}

function nextPhase(
  phase: PomodoroPhase,
  completed: number,
  config: PomodoroConfig,
): { phase: PomodoroPhase; completed: number } {
  if (phase !== 'focus') return { phase: 'focus', completed };
  const done = completed + 1;
  return {
    phase: done % config.cyclesBeforeLong === 0 ? 'long_break' : 'short_break',
    completed: done,
  };
}

export function tickPomodoro(
  state: PomodoroState,
  config: PomodoroConfig,
  elapsedMs: number,
): PomodoroTick {
  let { phase, completed, remainingMs } = state;
  let left = Math.max(0, elapsedMs);
  let focusMs = 0;
  const finished: PomodoroPhase[] = [];

  while (left >= remainingMs) {
    left -= remainingMs;
    if (phase === 'focus') focusMs += remainingMs;
    finished.push(phase);
    ({ phase, completed } = nextPhase(phase, completed, config));
    remainingMs = phaseDurationMs(phase, config);
  }
  remainingMs -= left;
  if (phase === 'focus') focusMs += left;

  return { state: { phase, completed, remainingMs }, focusMs, finished };
}

/** "Salta": ends the current phase now. Skipping a focus does not count it as a completed pomodoro. */
export function skipPomodoroPhase(state: PomodoroState, config: PomodoroConfig): PomodoroState {
  const next =
    state.phase === 'focus'
      ? { phase: 'short_break' as const, completed: state.completed }
      : nextPhase(state.phase, state.completed, config);
  return { ...next, remainingMs: phaseDurationMs(next.phase, config) };
}
