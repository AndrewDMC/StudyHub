'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_POMODORO,
  initialPomodoro,
  normalizePomodoroConfig,
  skipPomodoroPhase,
  tickPomodoro,
  type PomodoroConfig,
  type PomodoroPhase,
  type PomodoroState,
} from '@studyhub/core/browser';

const STORAGE_KEY = 'studyhub.pomodoro';
const HEARTBEAT_MS = 30_000;
/** A tick longer than this (laptop asleep) is not study time, so it is clamped. */
const MAX_TICK_MS = 90_000;

export type TimerMode = 'pomodoro' | 'free';

export const PHASE_LABELS: Record<PomodoroPhase, string> = {
  focus: 'Focus',
  short_break: 'Pausa breve',
  long_break: 'Pausa lunga',
};

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

interface Stored {
  mode: TimerMode;
  config: PomodoroConfig;
}

function loadStored(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Stored>;
      return {
        mode: parsed.mode === 'free' ? 'free' : 'pomodoro',
        config: normalizePomodoroConfig(parsed.config ?? {}),
      };
    }
  } catch {
    /* private window / blocked storage: fall back to the defaults */
  }
  return { mode: 'pomodoro', config: DEFAULT_POMODORO };
}

function saveStored(stored: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* preference only — the timer works without it */
  }
}

/** A short two-note chime; silent if audio is unavailable or blocked. */
function chime() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.22 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.22);
      osc.stop(ctx.currentTime + i * 0.22 + 0.22);
    });
    setTimeout(() => void ctx.close(), 900);
  } catch {
    /* no sound is fine */
  }
}

function announce(ended: PomodoroPhase, next: PomodoroPhase) {
  chime();
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(ended === 'focus' ? 'Pomodoro completato' : 'Pausa finita', {
        body:
          next === 'focus'
            ? 'Si torna a studiare.'
            : `Ora: ${PHASE_LABELS[next].toLowerCase()}. Alzati un attimo.`,
      });
    }
  } catch {
    /* notifications are optional */
  }
}

export interface UsePomodoro {
  mode: TimerMode;
  config: PomodoroConfig;
  state: PomodoroState;
  /** Focus time only: breaks are not study time. */
  studyMs: number;
  studyMsRef: React.MutableRefObject<number>;
  completedRef: React.MutableRefObject<number>;
  running: boolean;
  setRunning: (running: boolean) => void;
  setMode: (mode: TimerMode) => void;
  applyConfig: (config: Partial<PomodoroConfig>) => void;
  skip: () => void;
}

/**
 * Study clock for a session. In `pomodoro` mode the phases cycle
 * focus/break and only focus counts as study time; in `free` mode it is a plain
 * stopwatch. `saved*` seed from the server once; the running totals are sent
 * back on a slow heartbeat and by "Termina".
 */
export function usePomodoro(opts: {
  savedActiveMs: number | undefined;
  savedPomodoros: number | undefined;
  enabled: boolean;
  onBeat: (activeMs: number, pomodoros: number) => void;
}): UsePomodoro {
  const [mode, setModeState] = useState<TimerMode>('pomodoro');
  const [config, setConfigState] = useState<PomodoroConfig>(DEFAULT_POMODORO);
  const [state, setState] = useState<PomodoroState>(() => initialPomodoro(DEFAULT_POMODORO));
  const [studyMs, setStudyMs] = useState(opts.savedActiveMs ?? 0);
  const [running, setRunning] = useState(true);

  const stateRef = useRef(state);
  const configRef = useRef(config);
  const modeRef = useRef(mode);
  const studyMsRef = useRef(studyMs);
  const completedRef = useRef(opts.savedPomodoros ?? 0);
  const beatRef = useRef(opts.onBeat);
  beatRef.current = opts.onBeat;
  stateRef.current = state;
  configRef.current = config;
  modeRef.current = mode;
  studyMsRef.current = studyMs;
  completedRef.current = state.completed;

  // Preferences live in localStorage, read after mount so SSR markup matches.
  useEffect(() => {
    const stored = loadStored();
    setModeState(stored.mode);
    setConfigState(stored.config);
    setState((s) => initialPomodoro(stored.config, s.completed));
  }, []);

  // The session arrives after the first render: adopt its saved totals once, never again
  // (later server values are our own heartbeats and must not rewind the clock).
  const seeded = useRef(opts.savedActiveMs !== undefined);
  useEffect(() => {
    if (!seeded.current && opts.savedActiveMs !== undefined) {
      seeded.current = true;
      setStudyMs(opts.savedActiveMs);
      setState((s) => ({ ...s, completed: opts.savedPomodoros ?? 0 }));
    }
  }, [opts.savedActiveMs, opts.savedPomodoros]);

  useEffect(() => {
    if (!opts.enabled || !running) return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(now - last, MAX_TICK_MS);
      last = now;
      if (modeRef.current === 'free') {
        setStudyMs((v) => v + dt);
        return;
      }
      const tick = tickPomodoro(stateRef.current, configRef.current, dt);
      stateRef.current = tick.state;
      setState(tick.state);
      if (tick.focusMs > 0) setStudyMs((v) => v + tick.focusMs);
      const lastEnded = tick.finished[tick.finished.length - 1];
      if (lastEnded) announce(lastEnded, tick.state.phase);
    }, 1000);
    return () => clearInterval(id);
  }, [opts.enabled, running]);

  useEffect(() => {
    if (!opts.enabled) return;
    const id = setInterval(
      () => beatRef.current(studyMsRef.current, completedRef.current),
      HEARTBEAT_MS,
    );
    return () => clearInterval(id);
  }, [opts.enabled]);

  const setMode = useCallback((next: TimerMode) => {
    setModeState(next);
    saveStored({ mode: next, config: configRef.current });
    // Switching back to Pomodoro starts a fresh focus phase.
    if (next === 'pomodoro') setState((s) => initialPomodoro(configRef.current, s.completed));
  }, []);

  const applyConfig = useCallback((patch: Partial<PomodoroConfig>) => {
    const next = normalizePomodoroConfig({ ...configRef.current, ...patch });
    setConfigState(next);
    saveStored({ mode: modeRef.current, config: next });
    setState((s) => initialPomodoro(next, s.completed));
  }, []);

  const skip = useCallback(() => {
    setState((s) => skipPomodoroPhase(s, configRef.current));
  }, []);

  return {
    mode,
    config,
    state,
    studyMs,
    studyMsRef,
    completedRef,
    running,
    setRunning,
    setMode,
    applyConfig,
    skip,
  };
}

const INPUT =
  'w-16 rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-right text-sm text-fg-primary outline-none focus:border-accent';

function ConfigField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-fg-secondary">
      {label}
      <input
        type="number"
        min={1}
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommit(Number(text))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className={INPUT}
      />
    </label>
  );
}

export function PomodoroPanel({ timer, active }: { timer: UsePomodoro; active: boolean }) {
  const { mode, config, state, running } = timer;
  const isFocus = state.phase === 'focus';
  const dots = config.cyclesBeforeLong;
  // Dots show the position inside the current group of pomodoros.
  const inGroup = state.completed % dots;

  const requestNotifications = () => {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default')
        void Notification.requestPermission();
    } catch {
      /* optional */
    }
  };

  return (
    <section
      aria-label="Timer Pomodoro"
      className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">Timer</h2>
        <div role="group" aria-label="Modalità" className="flex gap-1 text-xs">
          {(['pomodoro', 'free'] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={!active}
              aria-pressed={mode === m}
              onClick={() => timer.setMode(m)}
              className={`rounded-full px-2 py-0.5 max-md:px-3 max-md:py-2 ${
                mode === m ? 'bg-accent text-white' : 'text-fg-muted hover:text-fg-primary'
              }`}
            >
              {m === 'pomodoro' ? 'Pomodoro' : 'Libero'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'pomodoro' ? (
        <>
          <p
            className={`text-xs font-medium ${isFocus ? 'text-accent' : 'text-ok'}`}
            data-testid="pomodoro-phase"
          >
            {PHASE_LABELS[state.phase]}
          </p>
          <p
            role="timer"
            aria-label="Tempo rimasto nella fase"
            className="font-mono text-4xl tabular-nums text-fg-primary"
          >
            {formatClock(state.remainingMs)}
          </p>
          <div
            className="mt-2 flex items-center gap-1"
            aria-label={`Pomodori completati: ${state.completed}`}
          >
            {Array.from({ length: dots }, (_, i) => (
              <span
                key={i}
                className={`h-2 w-2 rounded-full ${
                  i < inGroup ? 'bg-accent' : 'border border-border'
                }`}
              />
            ))}
            <span className="ml-2 text-xs text-fg-muted">
              {state.completed} {state.completed === 1 ? 'pomodoro' : 'pomodori'}
            </span>
          </div>
        </>
      ) : (
        <p
          role="timer"
          aria-label="Tempo di studio"
          className="font-mono text-4xl tabular-nums text-fg-primary"
        >
          {formatClock(timer.studyMs)}
        </p>
      )}

      {active && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              requestNotifications();
              timer.setRunning(!running);
            }}
            className="rounded-[var(--radius-control)] bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover max-md:min-h-11 max-md:px-4"
          >
            {running ? 'Pausa' : 'Riprendi'}
          </button>
          {mode === 'pomodoro' && (
            <button
              type="button"
              onClick={timer.skip}
              className="rounded-[var(--radius-control)] border border-border px-3 py-1 text-xs text-fg-secondary hover:bg-bg-raised max-md:min-h-11 max-md:px-4"
            >
              {isFocus ? 'Salta al riposo' : 'Salta la pausa'}
            </button>
          )}
        </div>
      )}

      <p className="mt-2 text-xs text-fg-muted">
        Tempo di studio: <span className="tabular-nums">{formatClock(timer.studyMs)}</span>
        {mode === 'pomodoro' && ' (solo i focus)'}
      </p>

      {mode === 'pomodoro' && active && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-fg-muted">Durate</summary>
          <div className="mt-2 space-y-1.5">
            <ConfigField
              label="Focus (min)"
              value={config.focusMin}
              onCommit={(v) => timer.applyConfig({ focusMin: v })}
            />
            <ConfigField
              label="Pausa breve (min)"
              value={config.shortBreakMin}
              onCommit={(v) => timer.applyConfig({ shortBreakMin: v })}
            />
            <ConfigField
              label="Pausa lunga (min)"
              value={config.longBreakMin}
              onCommit={(v) => timer.applyConfig({ longBreakMin: v })}
            />
            <ConfigField
              label="Focus prima della lunga"
              value={config.cyclesBeforeLong}
              onCommit={(v) => timer.applyConfig({ cyclesBeforeLong: v })}
            />
            <p className="text-fg-muted">Cambiare una durata riparte da un nuovo focus.</p>
          </div>
        </details>
      )}
    </section>
  );
}
