'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StudySessionDto, UpdateSessionRequest } from '@studyhub/contracts';
import { usePomodoro } from '@/components/PomodoroTimer';
import { fetchSession, patchSession, postEnd } from '@/lib/sessionApi';
import { useTodayTasks } from '../subject-mobile/queries';

/** The orchestration of `SessionDesktop` for the mobile flow: session query, timer, heartbeat, end, topics. */
export function useSessionRun(slug: string, sessionId: string) {
  const queryClient = useQueryClient();
  const sessionKey = ['studySession', slug, sessionId];
  const query = useQuery({ queryKey: sessionKey, queryFn: () => fetchSession(slug, sessionId) });
  const session = query.data;
  const active = session?.status === 'active';

  const heartbeat = useCallback(
    (activeMs: number, pomodoros: number) => {
      // Keep the cache in step: coming back to the page re-seeds the timer from it.
      queryClient.setQueryData<StudySessionDto>(['studySession', slug, sessionId], (prev) =>
        prev
          ? {
              ...prev,
              activeMs: Math.max(prev.activeMs, activeMs),
              pomodoros: Math.max(prev.pomodoros, pomodoros),
            }
          : prev,
      );
      patchSession(slug, sessionId, { activeMs, pomodoros }).catch(() => {
        /* a missed beat is recovered by the next one or by "Termina" */
      });
    },
    [queryClient, slug, sessionId],
  );

  const timer = usePomodoro({
    savedActiveMs: session?.activeMs,
    savedPomodoros: session?.pomodoros,
    enabled: active,
    onBeat: heartbeat,
  });

  // Opening a source leaves the page and unmounts the timer: send the totals on the way out.
  const activeRef = useRef(active);
  activeRef.current = active;
  const timerRef = useRef(timer);
  timerRef.current = timer;
  useEffect(
    () => () => {
      if (activeRef.current) {
        heartbeat(timerRef.current.studyMsRef.current, timerRef.current.completedRef.current);
      }
    },
    [heartbeat],
  );

  const end = useMutation({
    mutationFn: () =>
      postEnd(slug, sessionId, {
        activeMs: timer.studyMsRef.current,
        pomodoros: timer.completedRef.current,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(sessionKey, next);
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['plans', slug] });
      queryClient.invalidateQueries({ queryKey: ['daily-tasks', slug] });
    },
  });

  const patchTopics = useMutation({
    mutationFn: (patch: UpdateSessionRequest) => patchSession(slug, sessionId, patch),
    onSuccess: (next) => queryClient.setQueryData(sessionKey, next),
  });

  const tasks = useTodayTasks(slug);
  const shownMs = active ? timer.studyMs : (session?.activeMs ?? 0);

  return { session, sessionKey, query, active, timer, shownMs, patchTopics, end, tasks };
}
