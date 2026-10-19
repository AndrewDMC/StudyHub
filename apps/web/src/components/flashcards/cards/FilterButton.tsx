'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FOCUS } from '../shared/styles';

export interface FilterOption {
  value: string;
  label: ReactNode;
  /** Plain text of the option, used in the button once chosen. */
  text: string;
  depth?: 0 | 1;
}

/** "Stato" / "Argomento: Derivate": a button that opens a popover with one radio per value. */
export function FilterButton({
  label,
  groupLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  /** Accessible name of the radio group ("Filtra per argomento"). */
  groupLabel: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = value ? options.find((o) => o.value === value) : undefined;
  const active = !!value;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex h-10 max-w-full items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-[13px] transition-colors duration-120 max-md:h-11 ${FOCUS} ${
            active
              ? 'border-accent/40 bg-accent-subtle text-accent-hover'
              : 'border-border bg-bg-surface text-fg-primary hover:bg-bg-raised'
          }`}
        >
          <span className="truncate">{active ? `${label}: ${chosen?.text ?? value}` : label}</span>
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-h-72 w-64 overflow-auto p-1.5">
        <div role="group" aria-label={groupLabel} className="flex flex-col">
          {options.map((o) => {
            const checked = value === o.value;
            return (
              <button
                key={o.value || 'all'}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`flex min-h-10 w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-left text-[13px] hover:bg-bg-raised max-md:min-h-11 ${FOCUS} ${o.depth === 1 ? 'pl-6' : ''}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                    checked ? 'border-accent' : 'border-border-strong'
                  }`}
                >
                  {checked && <span className="size-2 rounded-full bg-accent" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
