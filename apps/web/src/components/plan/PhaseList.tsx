import { LESSON_PHASES, SPRINT_LESSON_PHASES } from '@/lib/lessonClient';
import type { LessonMethodChoice } from '@/lib/taskMethod';

/** The phases of a lesson in order: five for standard, four for sprint. */
export function PhaseList({
  method,
  label = 'Fasi della lezione',
}: {
  method: LessonMethodChoice;
  label?: string;
}) {
  const phases = method === 'sprint' ? SPRINT_LESSON_PHASES : LESSON_PHASES;
  return (
    <ol aria-label={label} className="flex flex-wrap gap-1.5">
      {phases.map((p, i) => (
        <li
          key={p.id}
          className="flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-2.5 text-[13px] text-fg-secondary"
        >
          <span aria-hidden="true" className="font-mono text-[11px] text-fg-muted">
            {i + 1}
          </span>
          {p.label}
        </li>
      ))}
    </ol>
  );
}
