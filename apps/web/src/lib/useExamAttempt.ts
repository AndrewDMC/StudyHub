'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttemptDto } from '@studyhub/contracts';
import { performSubmit, remainingFrom, requeueAnswers } from './examAttemptLogic';

export const AUTOSAVE_DELAY_MS = 1500;

export function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Logic of the exam mode (docs/fasi/F5-esami-simulazioni.md), shared by the desktop and the
 * mobile view: timer, autosave, submit. The countdown is only a display: its starting value
 * comes from the server (`remainingSeconds`, derived from the persisted start time), which also
 * enforces the deadline — so reopening the tab resumes with the right time and every saved answer.
 */
export function useExamAttempt({
  subjectSlug,
  simulationId,
  navigation = 'push',
}: {
  subjectSlug: string;
  simulationId: string;
  /** Read when navigating (not when mounting): the layout can change while the exam is open. */
  navigation?: 'push' | 'replace';
}) {
  const router = useRouter();
  const [attempt, setAttempt] = useState<AttemptDto | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState(0);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expired, setExpired] = useState(false);
  const pending = useRef<Record<string, string>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitted = useRef(false);
  const inflight = useRef<Promise<boolean> | null>(null);
  const deadline = useRef(0);
  const navRef = useRef(navigation);
  navRef.current = navigation;
  const expiredRef = useRef(false);

  const goToResults = useCallback(
    (attemptId: string) => {
      const href = `/materie/${subjectSlug}/attempts/${attemptId}/results`;
      if (navRef.current === 'replace') router.replace(href);
      else router.push(href);
    },
    [router, subjectSlug],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/subjects/${subjectSlug}/simulations/${simulationId}/attempts`, {
        method: 'POST',
      });
      const body = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        setError(body.error?.message ?? "Impossibile avviare l'esame");
        return;
      }
      const a = body.attempt as AttemptDto;
      deadline.current = Date.now() + a.remainingSeconds * 1000;
      setAttempt(a);
      setAnswers(a.answers);
      setRemaining(a.remainingSeconds);
    })();
    return () => {
      cancelled = true;
    };
  }, [subjectSlug, simulationId]);

  /** Saves the queued answers. Resolves true when nothing is left unsaved; a failure requeues them. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (inflight.current) await inflight.current;
    if (!attempt) return true;
    if (Object.keys(pending.current).length === 0) return true;
    const batch = pending.current;
    pending.current = {};
    setSaveState('saving');
    const run = (async (): Promise<boolean> => {
      let res: Response;
      try {
        res = await fetch(`/api/subjects/${subjectSlug}/attempts/${attempt.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: batch }),
        });
      } catch {
        pending.current = requeueAnswers(batch, pending.current);
        setSaveState('error');
        setError('Salvataggio fallito');
        return false;
      }
      if (res.ok) {
        setSaveState('saved');
        setLastSavedAt(Date.now());
        return true;
      }
      const body = await res.json().catch(() => null);
      setSaveState('error');
      setError(body?.error?.message ?? 'Salvataggio fallito');
      if (res.status === 409) {
        expiredRef.current = true;
        setExpired(true);
        goToResults(attempt.id); // time is up server-side: it's already handed in
      } else {
        pending.current = requeueAnswers(batch, pending.current);
      }
      return false;
    })();
    inflight.current = run;
    try {
      return await run;
    } finally {
      if (inflight.current === run) inflight.current = null;
    }
  }, [attempt, subjectSlug, goToResults]);

  const submit = useCallback(
    async (force = false) => {
      if (!attempt || submitted.current) return;
      submitted.current = true;
      setIsSubmitting(true);
      setSubmitError(null);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const out = await performSubmit({
        flush,
        force,
        post: () =>
          fetch(`/api/subjects/${subjectSlug}/attempts/${attempt.id}/submit`, { method: 'POST' }),
      });
      if (out.ok) {
        goToResults(attempt.id);
        return;
      }
      // Not handed in: allow another try. (A 409 on save is already navigating to the results.)
      submitted.current = false;
      setIsSubmitting(false);
      if (!expiredRef.current) setSubmitError(out.error);
    },
    [attempt, flush, subjectSlug, goToResults],
  );

  useEffect(() => {
    if (!attempt) return;
    if (attempt.status !== 'in_progress') {
      goToResults(attempt.id);
      return;
    }
    // Counted down from an absolute deadline: a throttled background timer cannot make it drift.
    const sync = () => setRemaining(remainingFrom(deadline.current, Date.now()));
    const tick = setInterval(sync, 1000);
    document.addEventListener('visibilitychange', sync);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [attempt, goToResults]);

  // Time is up: hand in (anyway), retrying every 5 s if the network is down.
  useEffect(() => {
    if (attempt?.status !== 'in_progress' || remaining !== 0) return;
    if (!submitError) {
      void submit(true);
      return;
    }
    const t = setTimeout(() => void submit(true), 5000);
    return () => clearTimeout(t);
  }, [remaining, attempt, submit, submitError]);

  // Closing the tab inside the autosave debounce window must not lose the last keystrokes:
  // a keepalive request survives the page being torn down. Hiding the tab saves too.
  useEffect(() => {
    if (!attempt) return;
    const onPageHide = () => {
      if (Object.keys(pending.current).length === 0) return;
      void fetch(`/api/subjects/${subjectSlug}/attempts/${attempt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: pending.current }),
        keepalive: true,
      });
      pending.current = {};
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [attempt, subjectSlug, flush]);

  function onAnswerChange(itemId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [itemId]: value }));
    pending.current[itemId] = value;
    setSaveState('idle');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
  }

  return {
    attempt,
    answers,
    remaining,
    saveState,
    lastSavedAt,
    error,
    submitError,
    isSubmitting,
    expired,
    onAnswerChange,
    flush,
    submit,
  };
}

export type ExamAttemptState = ReturnType<typeof useExamAttempt>;
