'use client';

import type { Ref } from 'react';
import Link from 'next/link';
import { ArrowLeft, MoreHorizontal } from 'lucide-react';
import type { SubjectDto } from '@studyhub/contracts';
import { SUBJECT_COLOR_HEX } from '@/lib/subjectColors';
import { iconButton } from '../document-mobile/DocHeader';
import { MobileTabs } from '../subject-mobile/MobileTabs';

/** Sticky header of the plan (replaces the global one below md): back to the subject, its name and the tabs. */
export function PlanHeader({
  slug,
  subject,
  onOpenActions,
  actionsButtonRef,
}: {
  slug: string;
  subject: SubjectDto | undefined;
  /** Opens the subject's actions sheet; the kebab only exists once the subject is loaded. */
  onOpenActions?: () => void;
  actionsButtonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <div className="sticky top-0 z-10 bg-bg-surface pt-[env(safe-area-inset-top)]">
      <div className="flex h-[52px] items-center gap-1 px-1">
        <Link href={`/materie/${slug}`} aria-label="Torna alla materia" className={iconButton}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
          {subject ? (
            <>
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: SUBJECT_COLOR_HEX[subject.color] }}
              />
              <h1 className="truncate text-[15px] font-semibold leading-tight">{subject.name}</h1>
            </>
          ) : (
            <>
              <h1 className="sr-only">Piano di studio</h1>
              <div aria-hidden="true" className="h-4 w-40 animate-pulse rounded bg-bg-raised" />
            </>
          )}
        </div>
        {subject && onOpenActions && (
          <button
            ref={actionsButtonRef}
            type="button"
            aria-label="Azioni della materia"
            aria-haspopup="dialog"
            onClick={onOpenActions}
            className={iconButton}
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
      <MobileTabs slug={slug} activeTab="piano" />
    </div>
  );
}
