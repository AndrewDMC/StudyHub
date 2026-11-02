import { cn } from '@/lib/utils';

const FILL = {
  accent: 'bg-accent',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
} as const;

/** Decorative bar (`aria-hidden`): whoever uses it also writes the value as text. */
export function ProgressBar({
  ratio,
  tone,
  className,
}: {
  /** 0..1 */
  ratio: number;
  tone: keyof typeof FILL;
  className?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  return (
    <span
      aria-hidden="true"
      className={cn('block h-1.5 overflow-hidden rounded-full bg-border', className)}
    >
      <span className={cn('block h-full rounded-full', FILL[tone])} style={{ width: `${pct}%` }} />
    </span>
  );
}
