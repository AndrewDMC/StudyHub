import type { TaskKind } from './types.js';

/** Minimal task shape needed to pick the lesson a flashcard attaches to. */
export interface LessonCandidate {
  id: string;
  taskKey: string;
  date: string;
  kind: TaskKind | string;
  status: string;
  topicId: string | null;
}

const OPEN_STATUSES = new Set(['proposed', 'todo', 'doing']);
const EXCLUDED_KINDS = new Set(['rest', 'simulation']);

function kindRank(kind: string): number {
  if (kind === 'review') return 0;
  if (kind === 'flashcards') return 1;
  if (kind === 'read') return 2;
  return 3;
}

/**
 * Picks the "lesson" (plan task) a flashcard of `topicId` belongs to: the
 * nearest open task on or after `today` for that topic, ignoring rest and
 * simulation tasks. Ties on date: review > flashcards > read > others, then
 * taskKey/id for determinism. Returns the task id, or null if none fits.
 */
export function pickLessonForTopic(
  tasks: readonly LessonCandidate[],
  topicId: string,
  today: string,
): string | null {
  const candidates = tasks.filter(
    (t) =>
      t.topicId === topicId &&
      OPEN_STATUSES.has(t.status) &&
      t.date >= today &&
      !EXCLUDED_KINDS.has(t.kind),
  );
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      kindRank(a.kind) - kindRank(b.kind) ||
      a.taskKey.localeCompare(b.taskKey) ||
      a.id.localeCompare(b.id),
  );
  return candidates[0]!.id;
}
