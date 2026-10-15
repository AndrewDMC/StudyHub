'use client';

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { TopicDto } from '@studyhub/contracts';
import { CalibrationPanel } from '../CalibrationPanel';
import { DeckToolsPanel } from '../DeckToolsPanel';

/** The desktop deck tools and calibration, unchanged, mounted only once opened. */
export function DeckToolsDisclosure({ slug, topics }: { slug: string; topics: TopicDto[] }) {
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
        Strumenti del mazzo e calibrazione
        <ChevronDown
          className={`size-4 shrink-0 text-fg-muted transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      <div id={panelId} hidden={!open} className="mt-3 min-w-0 space-y-4">
        {open && (
          <>
            <DeckToolsPanel subjectSlug={slug} topics={topics} />
            <CalibrationPanel subjectSlug={slug} />
          </>
        )}
      </div>
    </section>
  );
}
