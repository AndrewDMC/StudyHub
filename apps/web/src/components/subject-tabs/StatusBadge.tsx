import type { ReactNode } from 'react';

const TONE = {
  ok: 'border-ok text-ok',
  warn: 'border-warn text-warn',
  danger: 'border-danger text-danger',
  info: 'border-info text-info',
  muted: 'border-border-strong text-fg-secondary',
} as const;

export function StatusBadge({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[tone]}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
