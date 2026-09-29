'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import type { StudySessionDto, TaskDto } from '@studyhub/contracts';

type TaskKind = TaskDto['kind'];

/** Task kinds that open a study session; the others keep their own screen (review, simulations…). */
const SESSION_KINDS: ReadonlySet<TaskKind> = new Set(['read', 'schema', 'drill']);

const CLASSNAME =
  'rounded-[var(--radius-control)] bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60';

async function startSession(subjectSlug: string, taskId: string): Promise<StudySessionDto> {
  const res = await fetch(`/api/subjects/${subjectSlug}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Impossibile avviare la sessione');
  return body.session as StudySessionDto;
}

/** "Inizia" on a task: opens (or resumes) its study session, or falls back to the plan page. */
export function StartTaskButton({
  subjectSlug,
  taskId,
  kind,
}: {
  subjectSlug: string;
  taskId: string;
  kind: TaskKind;
}) {
  const router = useRouter();
  const start = useMutation({
    mutationFn: () => startSession(subjectSlug, taskId),
    onSuccess: (session) => router.push(`/materie/${subjectSlug}/sessione/${session.id}`),
  });

  if (!SESSION_KINDS.has(kind)) {
    return (
      <Link href={`/materie/${subjectSlug}/piano`} className={CLASSNAME}>
        Inizia
      </Link>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={start.isPending}
        onClick={() => start.mutate()}
        className={CLASSNAME}
      >
        {start.isPending ? 'Avvio…' : 'Inizia'}
      </button>
      {start.isError && (
        <span role="alert" className="text-xs text-danger">
          {(start.error as Error).message}
        </span>
      )}
    </span>
  );
}
