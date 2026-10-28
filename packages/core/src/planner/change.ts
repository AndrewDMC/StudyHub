import type { Availability, Intensity } from './types.js';

/** The inputs of a plan that "Modifica piano" may change — what `generate_plan` is run with. */
export interface PlanInputs {
  targetDate: string;
  availability: Availability;
  prefs: {
    sessionLength: number;
    intensity: Intensity;
    simulationCount: number | 'auto';
    simulationMinutes: number;
    reviewMinutesPerCard: number;
  };
  /** Topics the plan covers; undefined = the whole subject. */
  topicIds?: string[] | undefined;
}

/** The changes the model proposed (`plan_change`), before validation. */
export interface PlanChange {
  targetDate: string | null;
  perWeekday: (number | null)[] | null;
  addBlackoutDates: string[];
  removeBlackoutDates: string[];
  intensity: Intensity | null;
  sessionLength: number | null;
  simulationCount: number | 'auto' | null;
  excludeTopicIds: string[];
  includeTopicIds: string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Applies a proposed change to the current plan inputs. Never trusts the model: an exam date that is not
 * after today, a day off outside the study window, a topic id that is not the subject's, or leaving the
 * plan without topics are dropped, each with a line in `rejected` for the student.
 */
export function applyPlanChange(
  current: PlanInputs,
  change: PlanChange,
  ctx: { today: string; allTopicIds: string[] },
): { inputs: PlanInputs; rejected: string[] } {
  const rejected: string[] = [];

  let targetDate = current.targetDate;
  if (change.targetDate !== null) {
    if (ISO_DATE.test(change.targetDate) && change.targetDate > ctx.today) {
      targetDate = change.targetDate;
    } else {
      rejected.push(`Data d'esame ${change.targetDate} ignorata: deve venire dopo oggi.`);
    }
  }

  const perWeekday = current.availability.perWeekday.map((m, i) => {
    const next = change.perWeekday?.[i];
    return next === null || next === undefined ? m : Math.max(0, Math.min(1440, Math.round(next)));
  });

  const blackout = new Set(current.availability.blackoutDates);
  for (const d of change.removeBlackoutDates) blackout.delete(d);
  for (const d of change.addBlackoutDates) {
    if (ISO_DATE.test(d) && d >= ctx.today && d < targetDate) blackout.add(d);
    else rejected.push(`Giorno libero ${d} ignorato: è fuori dal periodo di studio.`);
  }
  // A day off after a moved-up exam date means nothing any more.
  const blackoutDates = [...blackout].filter((d) => d < targetDate).sort();

  const known = new Set(ctx.allTopicIds);
  let topicIds = current.topicIds;
  const unknown = [...change.excludeTopicIds, ...change.includeTopicIds].filter(
    (id) => !known.has(id),
  );
  if (unknown.length > 0) rejected.push(`${unknown.length} argomenti sconosciuti ignorati.`);
  if (change.excludeTopicIds.length > 0 || change.includeTopicIds.length > 0) {
    const covered = new Set(topicIds ?? ctx.allTopicIds);
    for (const id of change.includeTopicIds) if (known.has(id)) covered.add(id);
    for (const id of change.excludeTopicIds) covered.delete(id);
    if (covered.size === 0) {
      rejected.push('Non posso togliere tutti gli argomenti: il piano resterebbe vuoto.');
    } else {
      topicIds =
        covered.size === known.size ? undefined : ctx.allTopicIds.filter((id) => covered.has(id));
    }
  }

  return {
    inputs: {
      targetDate,
      availability: { perWeekday, blackoutDates },
      prefs: {
        ...current.prefs,
        ...(change.intensity !== null ? { intensity: change.intensity } : {}),
        ...(change.sessionLength !== null
          ? { sessionLength: Math.max(10, Math.min(180, Math.round(change.sessionLength))) }
          : {}),
        ...(change.simulationCount !== null ? { simulationCount: change.simulationCount } : {}),
      },
      topicIds,
    },
    rejected,
  };
}
