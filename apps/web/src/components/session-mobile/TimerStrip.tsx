'use client';

import { Pause, Play } from 'lucide-react';
import { formatClock, type UsePomodoro } from '@/components/PomodoroTimer';
import { ringDashOffset, RING_CIRCUMFERENCE, timerCaption } from '@/lib/sessionMobile';

const requestNotifications = () => {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default')
      void Notification.requestPermission();
  } catch {
    /* optional */
  }
};

/** Ring, clock, caption and pause/resume of the study timer. No live region: it would read every second. */
export function TimerStrip({ timer }: { timer: UsePomodoro }) {
  const free = timer.mode === 'free';
  const offset = free ? RING_CIRCUMFERENCE : ringDashOffset(timer.state, timer.config);

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-bg-surface px-4 py-2.5">
      <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" className="shrink-0">
        <circle cx="22" cy="22" r="19" fill="none" strokeWidth="4" stroke="var(--bg-raised)" />
        <circle
          cx="22"
          cy="22"
          r="19"
          fill="none"
          strokeWidth="4"
          stroke="var(--accent)"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 22 22)"
          className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-1000 motion-safe:ease-linear"
        />
      </svg>
      <div className="min-w-0 flex-1">
        <b
          role="timer"
          aria-label={free ? 'Tempo di studio' : 'Tempo rimasto nella fase'}
          className="block font-mono text-xl font-semibold leading-[1.1] tabular-nums"
        >
          {formatClock(free ? timer.studyMs : timer.state.remainingMs)}
        </b>
        <span className="block truncate text-xs text-fg-secondary">
          {timerCaption(timer.mode, timer.state, timer.config)}
        </span>
        <span className="block text-xs tabular-nums text-fg-secondary">
          Studio {formatClock(timer.studyMs)}
        </span>
      </div>
      <button
        type="button"
        aria-label={timer.running ? 'Metti in pausa' : 'Riprendi'}
        onClick={() => {
          requestNotifications();
          timer.setRunning(!timer.running);
        }}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border-strong bg-bg-raised text-fg-primary"
      >
        {timer.running ? (
          <Pause className="h-[18px] w-[18px] fill-current" aria-hidden="true" />
        ) : (
          <Play className="h-[18px] w-[18px] fill-current" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
