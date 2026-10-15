'use client';

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { CoverageMapDto } from '@studyhub/contracts';

/** Exam themes that are not topics of the subject; closed by default. */
export function UnmappedDisclosure({ unmapped }: { unmapped: CoverageMapDto['unmapped'] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-bg-surface px-4 text-left text-sm font-medium text-fg-primary"
      >
        Temi d&apos;esame senza argomento ({unmapped.length})
        <ChevronDown
          className={`size-4 shrink-0 text-fg-muted transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      <div id={panelId} hidden={!open} className="mt-3 min-w-0">
        {open && (
          <ul className="space-y-1.5 text-sm text-fg-secondary">
            {unmapped.map((u) => (
              <li key={u.name} className="break-words">
                <span className="font-medium text-fg-primary">{u.name}</span> —{' '}
                {u.materialMentions === 0
                  ? 'nessun tuo documento ne parla'
                  : `citato in ${u.materialMentions} ${u.materialMentions === 1 ? 'tuo documento' : 'tuoi documenti'}`}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
