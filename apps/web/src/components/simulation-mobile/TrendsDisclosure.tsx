'use client';

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { TopicTrendDto } from '@studyhub/contracts';
import { TopicTrendRow } from '../ExamPrepPanel';

/** "Andamento per argomento" of the desktop panel, closed by default. */
export function TrendsDisclosure({ trends }: { trends: TopicTrendDto[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (trends.length === 0) return null;
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-bg-surface px-4 text-left text-sm font-medium text-fg-primary"
      >
        Andamento per argomento
        <ChevronDown
          className={`size-4 shrink-0 text-fg-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      <div id={panelId} hidden={!open} className="mt-3 min-w-0">
        {open && (
          <ul className="space-y-2 text-xs">
            {trends.map((t) => (
              <TopicTrendRow key={t.topicId} trend={t} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
