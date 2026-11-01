import type { LessonMethodChoice } from '@/lib/taskMethod';
import { methodLabel } from '@/lib/taskMethod';

/** Standard (accent) or sprint (info) badge; the word always carries the meaning, not only the colour. */
export function MethodBadge({
  method,
  size = 'md',
}: {
  method: LessonMethodChoice;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[var(--radius-control)] px-2 text-xs font-medium ${
        size === 'sm' ? 'h-[22px]' : 'h-6'
      } ${method === 'sprint' ? 'bg-info/10 text-info' : 'bg-accent-subtle text-accent-hover'}`}
    >
      {methodLabel(method)}
    </span>
  );
}
