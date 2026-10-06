import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import {
  computeTimeFactor,
  TIME_FACTOR_MAX_SAMPLES,
  type PlannerTopic,
  type TimeFactor,
} from '@studyhub/core';
import { resolvePrimaryTopics } from './documentTopics.js';
import { calendarEvents, documents, studyPlans, studySessions, tasks } from './schema.js';

/**
 * Minutes an imported calendar event takes out of a day. An imported event
 * only carries a date (no start/end — docs/fasi/F6 "Stato"), so the real
 * duration is unknown: a flat hour per event is a stated assumption, not a
 * measurement. Better to under-promise the day than to ignore the event.
 */
export const IMPORTED_EVENT_MINUTES = 60;

export interface PlanningUnit {
  /** A real `topics.id` when the unit is a tagged topic, else the document's own id. */
  key: string;
  topicId: string | null;
  name: string;
  pages: number;
  /** Real `topics.mastery` when the unit is a tagged topic. */
  mastery: number | null;
  docs: { id: string; pages: number }[];
}

export interface EligibleDoc {
  id: string;
  originalName: string;
  pages: number;
}

/** Parsed documents with at least one page — what the Planner can schedule. */
export async function loadEligibleDocs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subjectId: string,
): Promise<EligibleDoc[]> {
  const rows: { id: string; originalName: string; pages: number | null }[] = await db
    .select({ id: documents.id, originalName: documents.originalName, pages: documents.pages })
    .from(documents)
    .where(and(eq(documents.subjectId, subjectId), eq(documents.status, 'parsed')));
  return rows.filter((d): d is EligibleDoc => (d.pages ?? 0) > 0);
}

/**
 * Groups eligible documents into planning units (docs/fasi/F2-materie.md
 * "Stato": `document_topics`). A document tagged with more than one topic is
 * assigned to exactly one — its *primary* topic — so it is never
 * double-counted. An untagged document is its own unit.
 */
export async function buildPlanningUnits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subjectId: string,
  eligibleDocs: EligibleDoc[],
): Promise<PlanningUnit[]> {
  if (eligibleDocs.length === 0) return [];
  const primaryByDoc = await resolvePrimaryTopics(
    db,
    subjectId,
    eligibleDocs.map((d) => d.id),
  );

  const units = new Map<string, PlanningUnit>();
  for (const doc of eligibleDocs) {
    const primary = primaryByDoc.get(doc.id) ?? null;
    const unitKey = primary ? primary.topicId : doc.id;

    const existing = units.get(unitKey);
    if (existing) {
      existing.pages += doc.pages;
      existing.docs.push({ id: doc.id, pages: doc.pages });
    } else {
      units.set(unitKey, {
        key: unitKey,
        topicId: primary ? primary.topicId : null,
        name: primary ? primary.topicName : doc.originalName,
        pages: doc.pages,
        mastery: primary ? primary.mastery : null,
        docs: [{ id: doc.id, pages: doc.pages }],
      });
    }
  }
  return [...units.values()];
}

/**
 * The units of a partial's syllabus: only those tagged with one of `topicIds`. No scope = everything.
 * An untagged document has no topic, so it cannot be part of a chosen syllabus.
 */
export function filterUnitsByScope(
  units: PlanningUnit[],
  topicIds: readonly string[] | undefined,
): PlanningUnit[] {
  if (!topicIds) return units;
  const scope = new Set(topicIds);
  return units.filter((u) => u.topicId !== null && scope.has(u.topicId));
}

/** Minutes for a unit when no AI estimate is available: ~3.5 min/page, never under 20. */
export function heuristicMinutes(pages: number): number {
  return Math.max(20, Math.round(pages * 3.5));
}

/**
 * Fase A stand-in with no model call — the estimate behind the free
 * pre-generation preview (docs/fasi/F6: "il wizard lo dichiara prima di
 * generare"). Deliberately crude (pages only); the real job refines it.
 */
export function heuristicPlannerTopics(units: PlanningUnit[]): PlannerTopic[] {
  return units.map((u) => ({
    key: u.key,
    topicId: u.topicId,
    name: u.name,
    estimatedMinutes: heuristicMinutes(u.pages),
    difficulty: 3,
    examWeight: 1 / units.length,
    prerequisites: [],
    mastery: u.mastery,
    material: u.docs.map((d) => ({ docId: d.id, pageFrom: 1, pageTo: d.pages })),
  }));
}

/**
 * Minutes already spoken for per day, from the Planner's point of view
 * (docs/04-planner.md §7, §9.4): other subjects' active tasks compete for the
 * same hours, and imported calendar events block time regardless of subject.
 */
export async function loadBusyMinutesByDate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subjectId: string,
  /** The exam the plan being made is for (null/absent = the subject's general plan): the active plan it will replace is not "other". */
  examId?: string | null,
): Promise<Record<string, number>> {
  const busy: Record<string, number> = {};
  // Another subject's tasks always count; so do the same subject's tasks of a *different* exam's plan
  // (a partial and the final share the same hours). Only the plan about to be replaced is left out.
  const notReplaced = examId
    ? or(ne(tasks.subjectId, subjectId), isNull(studyPlans.examId), ne(studyPlans.examId, examId))
    : or(ne(tasks.subjectId, subjectId), isNotNull(studyPlans.examId));
  const taskRows: { date: string; minutes: number }[] = await db
    .select({ date: tasks.date, minutes: tasks.minutes })
    .from(tasks)
    // Only the active plan's tasks count: a superseded plan keeps its `todo` rows, but they are no longer in the calendar.
    .innerJoin(studyPlans, eq(tasks.planId, studyPlans.id))
    .where(
      and(notReplaced, inArray(tasks.status, ['todo', 'doing']), eq(studyPlans.status, 'active')),
    );
  for (const row of taskRows) busy[row.date] = (busy[row.date] ?? 0) + row.minutes;

  const eventRows: { date: string }[] = await db
    .select({ date: calendarEvents.date })
    .from(calendarEvents);
  for (const row of eventRows) busy[row.date] = (busy[row.date] ?? 0) + IMPORTED_EVENT_MINUTES;
  return busy;
}

/**
 * The student's personal estimate-vs-real factor (docs/06-miglioramenti.md #7), across every subject:
 * how long they take is a trait of the person, not of the course. Built from the ended study sessions that
 * came from a planned task, newest first; each carries the factor its plan had already applied.
 */
export async function loadTimeFactor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
): Promise<TimeFactor> {
  const rows: { activeMs: number; minutes: number; planFactor: number }[] = await db
    .select({
      activeMs: studySessions.activeMs,
      minutes: tasks.minutes,
      planFactor: studyPlans.timeFactor,
    })
    .from(studySessions)
    .innerJoin(tasks, eq(tasks.id, studySessions.taskId))
    .innerJoin(studyPlans, eq(studyPlans.id, tasks.planId))
    .where(and(eq(studySessions.status, 'ended'), gt(studySessions.activeMs, 0)))
    .orderBy(desc(studySessions.endedAt))
    // A few more than the window: sessions too short to count are dropped after the fetch.
    .limit(TIME_FACTOR_MAX_SAMPLES * 3);
  return computeTimeFactor(
    rows.map((r) => ({
      plannedMin: r.minutes,
      actualMin: r.activeMs / 60_000,
      appliedFactor: r.planFactor,
    })),
  );
}
