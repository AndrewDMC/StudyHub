'use client';

import type { Ref } from 'react';
import Link from 'next/link';
import { ArrowLeft, MoreHorizontal, Search } from 'lucide-react';
import type { SubjectDto } from '@studyhub/contracts';
import { SUBJECT_COLOR_HEX } from '@/lib/subjectColors';

const iconButton =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-fg-secondary hover:text-fg-primary';

export function MobileHeader({
  subject,
  subtitle,
  searchOpen,
  searchRegionId,
  onToggleSearch,
  onOpenActions,
  searchButtonRef,
  actionsButtonRef,
}: {
  subject: SubjectDto;
  /** Optional second line under the name (e.g. the next exam). */
  subtitle?: string | undefined;
  searchOpen: boolean;
  searchRegionId: string;
  onToggleSearch: () => void;
  onOpenActions: () => void;
  searchButtonRef: Ref<HTMLButtonElement>;
  actionsButtonRef: Ref<HTMLButtonElement>;
}) {
  return (
    <div className={`flex items-center gap-1 px-1 ${subtitle ? 'min-h-[60px]' : 'h-[52px]'}`}>
      <Link href="/materie" aria-label="Torna a Materie" className={iconButton}>
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      </Link>
      <span
        aria-hidden="true"
        className="h-[9px] w-[9px] shrink-0 rounded-full"
        style={{ backgroundColor: SUBJECT_COLOR_HEX[subject.color] }}
      />
      <div className="ml-1 min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold tracking-[-0.02em]">{subject.name}</h1>
        {subtitle && <p className="truncate text-[13px] text-fg-secondary">{subtitle}</p>}
      </div>
      {subject.archivedAt && (
        <span className="shrink-0 rounded-full border border-warn px-2 py-0.5 text-[11px] text-warn">
          Archiviata
        </span>
      )}
      <button
        ref={searchButtonRef}
        type="button"
        aria-label="Cerca nella materia"
        aria-expanded={searchOpen}
        aria-controls={searchRegionId}
        onClick={onToggleSearch}
        className={iconButton}
      >
        <Search className="h-5 w-5" aria-hidden="true" />
      </button>
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
    </div>
  );
}
