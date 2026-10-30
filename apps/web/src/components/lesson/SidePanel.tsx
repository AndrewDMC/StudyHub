'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type SidePanelTab = 'material' | 'tutor';

const TABS: { id: SidePanelTab; label: string }[] = [
  { id: 'material', label: 'Materiale' },
  { id: 'tutor', label: 'Tutor' },
];

/**
 * Material | Tutor beside the lesson. Both panels stay mounted (the page the student was reading and
 * the chat are not lost on a tab change); the inactive one is just hidden.
 */
export function SidePanel({
  tab,
  onTabChange,
  material,
  tutor,
  className,
}: {
  tab: SidePanelTab;
  onTabChange: (tab: SidePanelTab) => void;
  material: ReactNode;
  tutor: ReactNode;
  className?: string;
}) {
  const refs = useRef<Record<SidePanelTab, HTMLButtonElement | null>>({
    material: null,
    tutor: null,
  });

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next: SidePanelTab = tab === 'material' ? 'tutor' : 'material';
    onTabChange(next);
    refs.current[next]?.focus();
  }

  return (
    <aside
      id="lesson-side-panel"
      aria-label="Materiale e tutor"
      className={cn('flex min-h-0 flex-col gap-2', className)}
    >
      <div role="tablist" aria-label="Materiale e tutor" className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`lesson-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`lesson-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => onTabChange(t.id)}
            onKeyDown={onKeyDown}
            className={cn(
              'min-h-11 flex-1 rounded-[var(--radius-control)] border px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent lg:min-h-9',
              tab === t.id
                ? 'border-accent bg-bg-raised text-fg-primary'
                : 'border-border text-fg-secondary hover:text-fg-primary',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="lesson-panel-material"
        aria-labelledby="lesson-tab-material"
        hidden={tab !== 'material'}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {material}
      </div>
      <div
        role="tabpanel"
        id="lesson-panel-tutor"
        aria-labelledby="lesson-tab-tutor"
        hidden={tab !== 'tutor'}
        className="flex min-h-0 flex-1 flex-col"
      >
        {tutor}
      </div>
    </aside>
  );
}
