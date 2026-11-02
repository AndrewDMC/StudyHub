'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import type { VerifyKeyPointDto } from '@studyhub/contracts';
import { Markdown } from '@/components/SessionBriefing';
import { cn } from '@/lib/utils';

/** "Riapri il punto chiave": the lesson block behind a question, only shown after a miss. */
export function KeyPointDisclosure({
  itemId,
  keyPoint,
  onOpenCitation,
}: {
  itemId: string;
  keyPoint: VerifyKeyPointDto;
  onOpenCitation: (citation: NonNullable<VerifyKeyPointDto['citation']>) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const { citation } = keyPoint;

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !open) return;
    e.stopPropagation();
    setOpen(false);
    button.current?.focus();
  }

  return (
    <div onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={`kp-${itemId}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-[var(--radius-control)] bg-bg-raised px-3 text-left text-xs text-accent outline-none hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent md:min-h-[30px] md:w-auto"
      >
        <span>
          Riapri il punto chiave
          {citation ? ` · ${citation.documentName} p. ${citation.page}` : ''}
        </span>
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('transition-transform motion-reduce:transition-none', open && 'rotate-180')}
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      <div
        id={`kp-${itemId}`}
        role="region"
        aria-label={`Punto chiave: ${keyPoint.title}`}
        hidden={!open}
        className="mt-2 space-y-2 rounded-[var(--radius-control)] border border-border bg-bg-inset p-3.5"
      >
        <h3 className="text-sm font-semibold">{keyPoint.title}</h3>
        <div className="text-fg-secondary">
          <Markdown source={keyPoint.body} />
        </div>
        {citation ? (
          <button
            type="button"
            title={`«${citation.quote}»`}
            onClick={() => onOpenCitation(citation)}
            className="min-h-11 rounded bg-accent/15 px-1.5 py-0.5 text-xs font-medium text-accent outline-none hover:bg-accent/25 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent md:min-h-7"
          >
            ↗ {citation.documentName} · p. {citation.page}
          </button>
        ) : (
          <span className="text-xs text-fg-muted">Senza fonte</span>
        )}
      </div>
    </div>
  );
}
