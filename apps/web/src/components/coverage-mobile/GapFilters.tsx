'use client';

import { FLAG_LABELS, type GapFilter } from '@/lib/coverageMobile';

const FILTERS: { key: GapFilter; label: string }[] = [
  { key: 'tutte', label: 'Tutte' },
  { key: 'weak', label: 'Deboli' },
  { key: 'no_cards', label: FLAG_LABELS.no_cards },
  { key: 'no_material', label: FLAG_LABELS.no_material },
];

/** Filter chips with counts; one active at a time. */
export function GapFilters({
  value,
  counts,
  onChange,
}: {
  value: GapFilter;
  counts: Record<GapFilter, number>;
  onChange: (f: GapFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filtra le lacune"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]"
    >
      {FILTERS.map((f) => {
        const active = value === f.key;
        return (
          <button
            key={f.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(f.key)}
            className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium ${
              active
                ? 'border-accent bg-accent-subtle text-fg-primary'
                : 'border-border bg-bg-surface text-fg-secondary'
            }`}
          >
            {f.label}
            <span className="font-mono text-xs tabular-nums text-fg-muted">{counts[f.key]}</span>
          </button>
        );
      })}
    </div>
  );
}
