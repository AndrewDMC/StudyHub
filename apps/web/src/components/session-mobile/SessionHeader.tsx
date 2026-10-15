'use client';

import type { RefObject } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { StudySessionDto, TaskDto } from '@studyhub/contracts';
import { sessionTitle } from '@/lib/sessionMobile';
import { iconButton } from '../document-mobile/DocHeader';
import { TASK_KIND_LABELS } from '../subject-mobile/queries';

/** Sticky header of the session (replaces the global one below md): back, "Dalla task · tipo", title, "Termina". */
export function SessionHeader({
  slug,
  session,
  tasks,
  endDisabled,
  onEnd,
  endRef,
}: {
  slug: string;
  session?: StudySessionDto | undefined;
  tasks?: TaskDto[] | undefined;
  endDisabled?: boolean;
  onEnd?: () => void;
  endRef?: RefObject<HTMLButtonElement | null>;
}) {
  const kind = session?.taskId ? tasks?.find((t) => t.id === session.taskId)?.kind : undefined;
  const subtitle = !session
    ? ''
    : session.taskId
      ? kind
        ? `Dalla task · ${TASK_KIND_LABELS[kind]}`
        : 'Dalla task'
      : 'Sessione di studio';

  return (
    <div className="sticky top-0 z-10 shrink-0 border-b border-border bg-bg-surface pt-[env(safe-area-inset-top)]">
      <div className="flex h-[52px] items-center gap-0.5 pl-1 pr-2">
        <Link href={`/materie/${slug}`} aria-label="Torna alla materia" className={iconButton}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1 pl-1">
          {session ? (
            <>
              <p className="truncate text-xs text-fg-secondary">{subtitle}</p>
              <h1 className="truncate text-[15px] font-semibold leading-tight">
                {sessionTitle(session)}
              </h1>
            </>
          ) : (
            <>
              <h1 className="sr-only">Sessione di studio</h1>
              <div aria-hidden="true" className="h-4 w-40 animate-pulse rounded bg-bg-raised" />
            </>
          )}
        </div>
        {session && onEnd && (
          <button
            ref={endRef}
            type="button"
            onClick={onEnd}
            disabled={endDisabled}
            aria-haspopup="dialog"
            className="flex min-h-11 shrink-0 items-center rounded-[var(--radius-control)] border border-border-strong bg-bg-raised px-4 text-[13px] font-semibold text-fg-primary disabled:opacity-50"
          >
            Termina
          </button>
        )}
      </div>
    </div>
  );
}
