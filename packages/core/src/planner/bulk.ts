import { addDays, type IsoDate } from './dates.js';
import { validatePlan, type PlanWindow, type TaskLike } from './adapt.js';

/**
 * Bulk edits on a plan (docs/fasi/F6 "Azioni bulk"): pure and deterministic
 * like `moveTask` — no AI, instant. Pinned tasks are never touched: the user
 * put them there. A bulk action that would break a hard constraint is refused
 * whole, with the reason, never applied halfway.
 */
export type BulkAction =
  | { type: 'shift'; days: number; from?: IsoDate | undefined }
  | { type: 'reduce_load'; percent: number }
  | { type: 'exclude_topic'; topicKey: string };

export type BulkResult<T extends TaskLike> =
  | { ok: true; tasks: T[]; changedKeys: string[]; removedKeys: string[] }
  | { ok: false; reason: string };

/** Kinds whose length is not a study-effort dial: a simulation lasts as long as the exam does. */
const FIXED_LENGTH_KINDS = new Set(['simulation', 'rest']);
const MIN_REDUCED_MINUTES = 10;

const roundTo5 = (n: number) => Math.round(n / 5) * 5;

export function applyBulkAction<T extends TaskLike>(
  tasks: T[],
  action: BulkAction,
  window: PlanWindow,
): BulkResult<T> {
  if (action.type === 'exclude_topic') {
    const removedKeys = tasks
      .filter((t) => t.topicKey === action.topicKey && !t.pinned)
      .map((t) => t.key);
    if (removedKeys.length === 0)
      return { ok: false, reason: "Nessuna task sbloccata per l'argomento scelto." };
    const gone = new Set(removedKeys);
    return { ok: true, tasks: tasks.filter((t) => !gone.has(t.key)), changedKeys: [], removedKeys };
  }

  if (action.type === 'reduce_load') {
    if (!(action.percent > 0 && action.percent < 100))
      return { ok: false, reason: 'La riduzione deve essere fra 1% e 99%.' };
    const changedKeys: string[] = [];
    const next = tasks.map((t) => {
      if (t.pinned || FIXED_LENGTH_KINDS.has(t.kind)) return t;
      const minutes = Math.max(
        MIN_REDUCED_MINUTES,
        roundTo5(t.minutes * (1 - action.percent / 100)),
      );
      if (minutes >= t.minutes) return t;
      changedKeys.push(t.key);
      return { ...t, minutes };
    });
    if (changedKeys.length === 0)
      return { ok: false, reason: 'Nessuna task riducibile (bloccate o di durata fissa).' };
    return { ok: true, tasks: next, changedKeys, removedKeys: [] };
  }

  // shift
  if (!Number.isInteger(action.days) || action.days === 0)
    return { ok: false, reason: 'Indica di quanti giorni spostare (intero, non zero).' };
  const from = action.from ?? '0000-01-01';
  const changedKeys: string[] = [];
  const next = tasks.map((t) => {
    if (t.pinned || t.date < from) return t;
    changedKeys.push(t.key);
    return { ...t, date: addDays(t.date, action.days) };
  });
  if (changedKeys.length === 0) return { ok: false, reason: 'Nessuna task sbloccata da spostare.' };

  // Only problems the shift *introduced* refuse it; pre-existing ones don't block.
  const before = new Set(validatePlan(tasks, window).map((v) => v.message));
  const introduced = validatePlan(next, window).find((v) => !before.has(v.message));
  if (introduced) return { ok: false, reason: introduced.message };
  return { ok: true, tasks: next, changedKeys, removedKeys: [] };
}
