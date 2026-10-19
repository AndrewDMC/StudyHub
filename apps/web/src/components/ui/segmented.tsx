import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface SegmentedOption {
  value: string;
  label: ReactNode;
  /** With an href the option is a link (`aria-current="page"` when active); otherwise a toggle button. */
  href?: string;
}

const BASE =
  'inline-flex min-h-10 items-center justify-center rounded-[var(--radius-control)] px-3.5 text-[13px] outline-none transition-colors duration-120 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent max-md:min-h-11';

/** Pill-shaped switch: links for "Viste flashcard", `aria-pressed` buttons for "Raggruppa". */
export function Segmented({
  value,
  onChange,
  options,
  className,
  itemClassName,
  'aria-label': ariaLabel,
}: {
  'aria-label': string;
  value: string;
  onChange?: (value: string) => void;
  options: SegmentedOption[];
  className?: string | undefined;
  itemClassName?: string | undefined;
}) {
  const cls = (active: boolean) =>
    cn(
      BASE,
      active
        ? 'bg-bg-raised font-medium text-fg-primary'
        : 'text-fg-secondary hover:text-fg-primary',
      itemClassName,
    );
  const asLinks = options.some((o) => o.href);
  return (
    <div
      {...(asLinks ? {} : { role: 'group' })}
      aria-label={asLinks ? undefined : ariaLabel}
      className={cn(
        'flex gap-0.5 rounded-lg border border-border bg-bg-surface p-[3px]',
        className,
      )}
    >
      {options.map((o) =>
        o.href ? (
          <Link
            key={o.value}
            href={o.href}
            scroll={false}
            replace
            aria-current={o.value === value ? 'page' : undefined}
            className={cls(o.value === value)}
          >
            {o.label}
          </Link>
        ) : (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            onClick={() => onChange?.(o.value)}
            className={cls(o.value === value)}
          >
            {o.label}
          </button>
        ),
      )}
    </div>
  );
}
