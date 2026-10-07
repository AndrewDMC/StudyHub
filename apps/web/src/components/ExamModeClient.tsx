'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttemptDto } from '@studyhub/contracts';

const AUTOSAVE_DELAY_MS = 1500;

function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Modalità Esame (docs/fasi/F5-esami-simulazioni.md): timer, one item at a
 * time or the whole paper, autosave, no AI help. The countdown is only a
 * display: its starting value comes from the server (`remainingSeconds`,
 * derived from the persisted start time), which also enforces the deadline —
 * so reopening the tab resumes with the right time and every saved answer.
 */
export function ExamModeClient({
  subjectSlug,
  simulationId,
}: {
  subjectSlug: string;
  simulationId: string;
}) {
  const router = useRouter();
  const [attempt, setAttempt] = useState<AttemptDto | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState(0);
  const [index, setIndex] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Record<string, string>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitted = useRef(false);

  const goToResults = useCallback(
    (attemptId: string) => router.push(`/materie/${subjectSlug}/attempts/${attemptId}/results`),
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
      setAttempt(a);
      setAnswers(a.answers);
      setRemaining(a.remainingSeconds);
    })();
    return () => {
      cancelled = true;
    };
  }, [subjectSlug, simulationId]);

  const flush = useCallback(async () => {
    if (!attempt || Object.keys(pending.current).length === 0) return;
    const batch = pending.current;
    pending.current = {};
    setSaveState('saving');
    const res = await fetch(`/api/subjects/${subjectSlug}/attempts/${attempt.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: batch }),
    });
    if (res.ok) {
      setSaveState('saved');
      return;
    }
    const body = await res.json().catch(() => null);
    setSaveState('error');
    setError(body?.error?.message ?? 'Salvataggio fallito');
    if (res.status === 409) goToResults(attempt.id); // time is up server-side: it's already handed in
  }, [attempt, subjectSlug, goToResults]);

  const submit = useCallback(async () => {
    if (!attempt || submitted.current) return;
    submitted.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await flush();
    await fetch(`/api/subjects/${subjectSlug}/attempts/${attempt.id}/submit`, { method: 'POST' });
    goToResults(attempt.id);
  }, [attempt, flush, subjectSlug, goToResults]);

  useEffect(() => {
    if (!attempt) return;
    if (attempt.status !== 'in_progress') {
      goToResults(attempt.id);
      return;
    }
    const tick = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(tick);
  }, [attempt, goToResults]);

  useEffect(() => {
    if (attempt?.status === 'in_progress' && remaining === 0) void submit();
  }, [remaining, attempt, submit]);

  // Closing the tab inside the autosave debounce window must not lose the last keystrokes:
  // a keepalive request survives the page being torn down.
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
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [attempt, subjectSlug]);

  function onAnswerChange(itemId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [itemId]: value }));
    pending.current[itemId] = value;
    setSaveState('idle');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
  }

  if (error && !attempt) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm">
        <p role="alert" className="text-danger">
          {error}
        </p>
        <Link href={`/materie/${subjectSlug}`} className="text-fg-secondary underline">
          Torna alla materia
        </Link>
      </div>
    );
  }
  if (!attempt) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-fg-muted">
        Preparazione esame…
      </div>
    );
  }

  const items = showAll ? attempt.items : attempt.items.slice(index, index + 1);
  const lowTime = remaining <= 300;

  return (
    <div className="flex h-full flex-col bg-bg-base text-fg-primary">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-xs md:px-6">
        <span className="text-fg-muted">
          Modalità esame<span className="max-md:hidden"> · nessun aiuto disponibile</span>
        </span>
        <span
          className={`font-mono text-base tabular-nums ${lowTime ? 'text-warn' : 'text-fg-primary'}`}
          aria-live={lowTime ? 'polite' : 'off'}
        >
          {formatClock(remaining)}
        </span>
        <span className="text-fg-muted" aria-live="polite">
          {saveState === 'saving' && 'Salvataggio…'}
          {saveState === 'saved' && 'Salvato'}
          {saveState === 'error' && <span className="text-danger">{error}</span>}
        </span>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <div className="mb-4 flex items-center justify-between text-xs text-fg-muted">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="underline hover:text-fg-secondary max-md:-my-3 max-md:py-3"
          >
            {showAll ? 'Un esercizio alla volta' : 'Vista completa'}
          </button>
          {!showAll && (
            <span className="font-mono tabular-nums">
              {index + 1} / {attempt.items.length}
            </span>
          )}
        </div>

        <ol className="space-y-6">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4"
            >
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">
                  {item.ord + 1}. {item.prompt}
                </p>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">
                  {item.points} pt
                </span>
              </div>
              <label className="sr-only" htmlFor={`answer-${item.id}`}>
                Risposta all&apos;esercizio {item.ord + 1}
              </label>
              <textarea
                id={`answer-${item.id}`}
                value={answers[item.id] ?? ''}
                onChange={(e) => onAnswerChange(item.id, e.target.value)}
                rows={8}
                className="w-full rounded-[var(--radius-control)] border border-border bg-bg-inset px-3 py-2 text-sm text-fg-primary outline-none focus:border-accent"
              />
            </li>
          ))}
        </ol>

        {!showAll && (
          <div className="mt-4 flex justify-between">
            <button
              type="button"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
              className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm text-fg-secondary disabled:opacity-40 max-md:min-h-11"
            >
              Precedente
            </button>
            <button
              type="button"
              onClick={() => setIndex((i) => Math.min(attempt.items.length - 1, i + 1))}
              disabled={index >= attempt.items.length - 1}
              className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm text-fg-secondary disabled:opacity-40 max-md:min-h-11"
            >
              Successivo
            </button>
          </div>
        )}
      </main>

      <footer className="flex justify-end border-t border-border px-4 py-3 md:px-6">
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Consegnare l'esame? Le risposte non saranno più modificabili."))
              void submit();
          }}
          className="rounded-[var(--radius-control)] bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover max-md:min-h-11"
        >
          Consegna
        </button>
      </footer>
    </div>
  );
}
