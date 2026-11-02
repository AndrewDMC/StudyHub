import type { TaskDto } from '@studyhub/contracts';
import { taskTone, type TypeTone } from '../plan/planModel';

const TONE_BAR: Record<TypeTone, string> = {
  accent: 'bg-accent',
  info: 'bg-info',
  ok: 'bg-ok',
  warn: 'bg-warn',
  neutral: 'bg-border-strong',
};

const TONE_TEXT: Record<TypeTone, string> = {
  accent: 'text-accent-hover',
  info: 'text-info',
  ok: 'text-ok',
  warn: 'text-warn',
  neutral: 'text-fg-muted',
};

/** Bar / dot colour of a task by its type tone (standard lesson, sprint, verify/flashcards, simulation). */
export function toneBar(task: Pick<TaskDto, 'kind' | 'payload'>): string {
  return TONE_BAR[taskTone(task)];
}

/** Colour of the type caption above a task title. */
export function toneText(task: Pick<TaskDto, 'kind' | 'payload'>): string {
  return TONE_TEXT[taskTone(task)];
}
