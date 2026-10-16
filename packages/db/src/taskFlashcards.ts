import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { pickLessonForTopic, type LessonCandidate } from '@studyhub/core';
import { artifacts, flashcards, studyPlans, taskFlashcards, tasks } from './schema.js';

const OPEN_STATUSES = ['proposed', 'todo', 'doing'] as const;
const CHUNK = 500;

function chunked<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

export interface AutoAttachOptions {
  subjectId: string;
  /** Restrict to these cards (default: every card of the subject). */
  cardIds?: string[];
  /** Restrict to these plans (default: the subject's draft and active plans). */
  planIds?: string[];
  /** ISO date (yyyy-mm-dd) used as "today" by `pickLessonForTopic`. */
  today: string;
}

/**
 * Attaches topic-bearing, non-suspended flashcards to the lesson (plan task)
 * `pickLessonForTopic` selects, once per plan, as `auto` links. A card that
 * already has a link (auto or user) to an open task of a plan is left alone
 * for that plan. Returns the number of links created.
 */
export async function autoAttachFlashcards(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  opts: AutoAttachOptions,
): Promise<number> {
  const { subjectId, today } = opts;
  if (opts.cardIds && opts.cardIds.length === 0) return 0;
  if (opts.planIds && opts.planIds.length === 0) return 0;

  let planIds: string[];
  if (opts.planIds) {
    planIds = opts.planIds;
  } else {
    const rows: { id: string }[] = await db
      .select({ id: studyPlans.id })
      .from(studyPlans)
      .where(
        and(eq(studyPlans.subjectId, subjectId), inArray(studyPlans.status, ['draft', 'active'])),
      );
    planIds = rows.map((r) => r.id);
  }
  if (planIds.length === 0) return 0;

  // Cards: the subject's, with a topic, not suspended.
  const cards: { id: string; topicId: string }[] = [];
  const idGroups: (string[] | undefined)[] = opts.cardIds ? chunked(opts.cardIds) : [undefined];
  for (const ids of idGroups) {
    const rows: { id: string; topicId: string | null }[] = await db
      .select({ id: flashcards.id, topicId: flashcards.topicId })
      .from(flashcards)
      .innerJoin(artifacts, eq(artifacts.id, flashcards.deckId))
      .where(
        and(
          eq(artifacts.subjectId, subjectId),
          isNotNull(flashcards.topicId),
          eq(flashcards.suspended, false),
          ids ? inArray(flashcards.id, ids) : undefined,
        ),
      );
    for (const r of rows) if (r.topicId) cards.push({ id: r.id, topicId: r.topicId });
  }
  if (cards.length === 0) return 0;

  const planTasks: (LessonCandidate & { planId: string })[] = await db
    .select({
      id: tasks.id,
      planId: tasks.planId,
      taskKey: tasks.taskKey,
      date: tasks.date,
      kind: tasks.kind,
      status: tasks.status,
      topicId: tasks.topicId,
    })
    .from(tasks)
    .where(inArray(tasks.planId, planIds));
  if (planTasks.length === 0) return 0;

  const tasksByPlan = new Map<string, (LessonCandidate & { planId: string })[]>();
  const openTaskPlan = new Map<string, string>();
  for (const t of planTasks) {
    const list = tasksByPlan.get(t.planId) ?? [];
    list.push(t);
    tasksByPlan.set(t.planId, list);
    if ((OPEN_STATUSES as readonly string[]).includes(t.status)) openTaskPlan.set(t.id, t.planId);
  }

  // Existing links of these cards to open tasks of the considered plans: planId -> cardIds.
  const linked = new Map<string, Set<string>>();
  const openTaskIds = [...openTaskPlan.keys()];
  for (const cardGroup of chunked(cards.map((c) => c.id))) {
    for (const taskGroup of chunked(openTaskIds)) {
      const rows: { taskId: string; flashcardId: string }[] = await db
        .select({ taskId: taskFlashcards.taskId, flashcardId: taskFlashcards.flashcardId })
        .from(taskFlashcards)
        .where(
          and(
            inArray(taskFlashcards.flashcardId, cardGroup),
            inArray(taskFlashcards.taskId, taskGroup),
          ),
        );
      for (const r of rows) {
        const planId = openTaskPlan.get(r.taskId);
        if (!planId) continue;
        const set = linked.get(planId) ?? new Set<string>();
        set.add(r.flashcardId);
        linked.set(planId, set);
      }
    }
  }

  const toInsert: { taskId: string; flashcardId: string; source: 'auto' }[] = [];
  for (const planId of planIds) {
    const planList = tasksByPlan.get(planId);
    if (!planList) continue;
    const already = linked.get(planId);
    const pickByTopic = new Map<string, string | null>();
    for (const card of cards) {
      if (already?.has(card.id)) continue;
      if (!pickByTopic.has(card.topicId)) {
        pickByTopic.set(card.topicId, pickLessonForTopic(planList, card.topicId, today));
      }
      const taskId = pickByTopic.get(card.topicId);
      if (taskId) toInsert.push({ taskId, flashcardId: card.id, source: 'auto' });
    }
  }

  let created = 0;
  for (const group of chunked(toInsert)) {
    const inserted: unknown[] = await db
      .insert(taskFlashcards)
      .values(group)
      .onConflictDoNothing()
      .returning({ taskId: taskFlashcards.taskId });
    created += inserted.length;
  }
  return created;
}

/**
 * For cards whose topic changed (or was cleared): drops their `auto` links to
 * open tasks whose topic differs from the card's current topic (all of them if
 * the topic is null), then re-attaches. `user` links and links to closed tasks
 * stay untouched.
 */
export async function reattachFlashcards(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  opts: { subjectId: string; cardIds: string[]; today: string },
): Promise<number> {
  if (opts.cardIds.length === 0) return 0;
  for (const group of chunked(opts.cardIds)) {
    const stale: { taskId: string; flashcardId: string }[] = await db
      .select({ taskId: taskFlashcards.taskId, flashcardId: taskFlashcards.flashcardId })
      .from(taskFlashcards)
      .innerJoin(tasks, eq(tasks.id, taskFlashcards.taskId))
      .innerJoin(flashcards, eq(flashcards.id, taskFlashcards.flashcardId))
      .where(
        and(
          inArray(taskFlashcards.flashcardId, group),
          eq(taskFlashcards.source, 'auto'),
          eq(tasks.subjectId, opts.subjectId),
          inArray(tasks.status, [...OPEN_STATUSES]),
          sql`${tasks.topicId} is distinct from ${flashcards.topicId}`,
        ),
      );
    // One DELETE per task: the stale pairs of a task share its card ids.
    const byTask = new Map<string, string[]>();
    for (const p of stale) byTask.set(p.taskId, [...(byTask.get(p.taskId) ?? []), p.flashcardId]);
    for (const [taskId, cardIds] of byTask) {
      await db
        .delete(taskFlashcards)
        .where(
          and(eq(taskFlashcards.taskId, taskId), inArray(taskFlashcards.flashcardId, cardIds)),
        );
    }
  }
  return autoAttachFlashcards(db, {
    subjectId: opts.subjectId,
    cardIds: opts.cardIds,
    today: opts.today,
  });
}

/** Number of flashcards attached to each task; tasks with none are absent (read as 0). */
export async function countTaskFlashcards(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  taskIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const group of chunked(taskIds)) {
    const rows: { taskId: string; n: number }[] = await db
      .select({ taskId: taskFlashcards.taskId, n: sql<number>`count(*)::int` })
      .from(taskFlashcards)
      .where(inArray(taskFlashcards.taskId, group))
      .groupBy(taskFlashcards.taskId);
    for (const r of rows) out.set(r.taskId, Number(r.n));
  }
  return out;
}
