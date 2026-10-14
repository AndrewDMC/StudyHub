'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MoreHorizontal, Wrench } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

/**
 * The header's `⋯` below `md`: sections that don't earn a tab (Admin gave its place to Ripasso,
 * docs/09-ripasso-mobile.md §A2).
 */
export function MobileMoreMenu() {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Altre sezioni"
        className="flex size-11 items-center justify-center rounded-[var(--radius-control)] text-fg-secondary hover:text-fg-primary"
      >
        <MoreHorizontal size={20} strokeWidth={1.75} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        <Link
          href="/admin"
          onClick={() => setOpen(false)}
          className="flex h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-fg-primary hover:bg-bg-raised"
        >
          <Wrench size={18} strokeWidth={1.75} aria-hidden="true" />
          Admin
        </Link>
      </PopoverContent>
    </Popover>
  );
}
