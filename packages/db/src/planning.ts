import { and, eq, inArray, ne } from 'drizzle-orm';
import type { PlannerTopic } from '@studyhub/core';
import { resolvePrimaryTopics } from './documentTopics.js';
import { calendarEvents, documents, tasks } from './schema.js';

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
): Promise<Record<string, number>> {
  const busy: Record<string, number> = {};
  const taskRows: { date: string; minutes: number }[] = await db
    .select({ date: tasks.date, minutes: tasks.minutes })
    .from(tasks)
    .where(and(ne(tasks.subjectId, subjectId), inArray(tasks.status, ['todo', 'doing'])));
  for (const row of taskRows) busy[row.date] = (busy[row.date] ?? 0) + row.minutes;

  const eventRows: { date: string }[] = await db
    .select({ date: calendarEvents.date })
    .from(calendarEvents);
  for (const row of eventRows) busy[row.date] = (busy[row.date] ?? 0) + IMPORTED_EVENT_MINUTES;
  return busy;
}
