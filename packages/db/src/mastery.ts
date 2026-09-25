import { and, eq, inArray, ne } from 'drizzle-orm';
import { computeMastery, retrievability } from '@studyhub/core';
import { resolvePrimaryTopics } from './documentTopics.js';
import {
  attemptItemResults,
  documents,
  flashcards,
  simulationItems,
  tasks,
  topics,
  type Flashcard,
} from './schema.js';

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Fraction of a topic's assigned material (pages of the documents whose
 * *primary* tag is this topic, `resolvePrimaryTopics`) actually read —
 * "read" meaning cited by a `read` task the user marked `done` (Planner or
 * manual), not merely scheduled. `null` when the topic has no material
 * assigned at all (nothing to cover yet), not a silent zero.
 *
 * A document's covered pages are clamped to its own page count before
 * summing, so overlapping `done` tasks from more than one plan generation
 * can never push a document's — or the topic's — coverage past 100%.
 */
async function computeTopicCoverage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  topicId: string,
  subjectId: string,
): Promise<number | null> {
  const docRows: { id: string; pages: number | null }[] = await db
    .select({ id: documents.id, pages: documents.pages })
    .from(documents)
    .where(and(eq(documents.subjectId, subjectId), eq(documents.status, 'parsed')));
  const eligibleDocs = docRows.filter(
    (d): d is { id: string; pages: number } => (d.pages ?? 0) > 0,
  );
  if (eligibleDocs.length === 0) return null;

  const primaryByDoc = await resolvePrimaryTopics(
    db,
    subjectId,
    eligibleDocs.map((d) => d.id),
  );
  const topicDocs = eligibleDocs.filter((d) => primaryByDoc.get(d.id)?.topicId === topicId);
  if (topicDocs.length === 0) return null;

  const readTasks: {
    payload: { material?: { docId: string; pageFrom: number; pageTo: number }[] };
  }[] = await db
    .select({ payload: tasks.payload })
    .from(tasks)
    .where(and(eq(tasks.topicId, topicId), eq(tasks.kind, 'read'), eq(tasks.status, 'done')));

  const readPagesByDoc = new Map<string, number>();
  for (const t of readTasks) {
    for (const m of t.payload.material ?? []) {
      const pages = Math.max(0, m.pageTo - m.pageFrom + 1);
      readPagesByDoc.set(m.docId, (readPagesByDoc.get(m.docId) ?? 0) + pages);
    }
  }

  const totalPages = topicDocs.reduce((s, d) => s + d.pages, 0);
  const coveredPages = topicDocs.reduce(
    (s, d) => s + Math.min(d.pages, readPagesByDoc.get(d.id) ?? 0),
    0,
  );
  return clamp01(coveredPages / totalPages);
}

/**
 * Subject-wide reading coverage (docs/fasi/F2-materie.md griglia Materie,
 * "Copertura argomenti"): pages actually read (`done` `read` tasks) over
 * pages assigned to *any* topic of the subject (via each document's primary
 * tag, `resolvePrimaryTopics`) — the same real definition
 * `computeTopicCoverage` uses per topic, summed across every topic instead
 * of picking one. `null` when no document in the subject is tagged to a
 * topic yet (nothing assigned to cover), not a silent zero.
 */
export async function computeSubjectCoverage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subjectId: string,
): Promise<number | null> {
  const docRows: { id: string; pages: number | null }[] = await db
    .select({ id: documents.id, pages: documents.pages })
    .from(documents)
    .where(and(eq(documents.subjectId, subjectId), eq(documents.status, 'parsed')));
  const eligibleDocs = docRows.filter(
    (d): d is { id: string; pages: number } => (d.pages ?? 0) > 0,
  );
  if (eligibleDocs.length === 0) return null;

  const primaryByDoc = await resolvePrimaryTopics(
    db,
    subjectId,
    eligibleDocs.map((d) => d.id),
  );
  const taggedDocs = eligibleDocs.filter((d) => primaryByDoc.has(d.id));
  if (taggedDocs.length === 0) return null;

  const topicIds: { id: string }[] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(eq(topics.subjectId, subjectId));
  const readTasks: {
    payload: { material?: { docId: string; pageFrom: number; pageTo: number }[] };
  }[] =
    topicIds.length === 0
      ? []
      : await db
          .select({ payload: tasks.payload })
          .from(tasks)
          .where(
            and(
              inArray(
                tasks.topicId,
                topicIds.map((t) => t.id),
              ),
              eq(tasks.kind, 'read'),
              eq(tasks.status, 'done'),
            ),
          );

  const readPagesByDoc = new Map<string, number>();
  for (const t of readTasks) {
    for (const m of t.payload.material ?? []) {
      const pages = Math.max(0, m.pageTo - m.pageFrom + 1);
      readPagesByDoc.set(m.docId, (readPagesByDoc.get(m.docId) ?? 0) + pages);
    }
  }

  const totalPages = taggedDocs.reduce((s, d) => s + d.pages, 0);
  const coveredPages = taggedDocs.reduce(
    (s, d) => s + Math.min(d.pages, readPagesByDoc.get(d.id) ?? 0),
    0,
  );
  return clamp01(coveredPages / totalPages);
}

/**
 * Recomputes `topics.mastery` from its inputs (docs/02-filesystem-e-dati.md
 * §5, formula in `packages/core/src/mastery.ts`): average current
 * retrievability of the topic's reviewed flashcards + average accuracy of
 * every graded simulation item on the topic + fraction of its assigned
 * material actually read.
 *
 * Lives in `@studyhub/db` (not `apps/worker`) because both `apps/worker`
 * (after grading a simulation, and after a `read` task is marked done) and
 * `apps/web` (after every flashcard review) need to trigger it — see
 * docs/fasi/F4-flashcard.md and docs/fasi/F5-esami-simulazioni.md "Stato".
 */
export async function recomputeTopicMastery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  topicId: string,
  now: Date = new Date(),
): Promise<number | null> {
  const [topicRow] = await db
    .select({ subjectId: topics.subjectId })
    .from(topics)
    .where(eq(topics.id, topicId));
  const coverage = topicRow ? await computeTopicCoverage(db, topicId, topicRow.subjectId) : null;

  const cards: Flashcard[] = await db
    .select()
    .from(flashcards)
    .where(
      and(
        eq(flashcards.topicId, topicId),
        eq(flashcards.suspended, false),
        ne(flashcards.state, 'new'),
      ),
    );
  const retrievabilities = cards.map((c) =>
    retrievability(
      {
        stability: c.stability,
        difficulty: c.difficulty,
        dueAt: c.dueAt,
        lastReviewAt: c.lastReviewAt,
        reps: c.reps,
        lapses: c.lapses,
        state: c.state,
      },
      now,
    ),
  );

  const itemIds: { id: string }[] = await db
    .select({ id: simulationItems.id })
    .from(simulationItems)
    .where(eq(simulationItems.topicId, topicId));
  const results: { awarded: number; max: number }[] =
    itemIds.length === 0
      ? []
      : await db
          .select({ awarded: attemptItemResults.awarded, max: attemptItemResults.max })
          .from(attemptItemResults)
          .where(
            inArray(
              attemptItemResults.itemId,
              itemIds.map((i) => i.id),
            ),
          );

  const mean = (xs: number[]) =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
  const { value } = computeMastery({
    retrievability: mean(retrievabilities),
    simulationAccuracy: mean(results.map((r) => (r.max > 0 ? r.awarded / r.max : 0))),
    coverage,
  });

  await db.update(topics).set({ mastery: value }).where(eq(topics.id, topicId));
  return value;
}
