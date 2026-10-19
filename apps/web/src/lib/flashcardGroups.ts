import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { artifacts, flashcards, jobs, subjects, topics } from '@studyhub/db';
import type { DeckGroupDto, SortFlashcardsStatus } from '@studyhub/contracts';
import type { Queue } from 'bullmq';
import { SubjectNotFoundError } from './errors';
import { ConflictError } from './examPrep';
import { dueCardConditions, reviewableConditions, treatedCardCondition } from './review';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

async function requireSubject(db: AnyDb, slug: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, slug));
  if (!subject) throw new SubjectNotFoundError(slug);
  return subject as { id: string };
}

/**
 * "Mazzi" of a subject = its flashcards grouped by topic. One group per topic that has cards (topic
 * order), then the unsorted cards (`topicId: null`) last. `total`/`suspended` count every card of
 * the subject (any deck). `due` and `new` count only reviewable cards (approved deck, not
 * suspended/flagged): `due` = already seen and due today, `new` = never seen and from a treated lesson (see
 * `treatedCardCondition`), so "Ripassa" is
 * never enabled on an empty queue.
 */
export async function listDeckGroups(
  db: AnyDb,
  slug: string,
  now: Date = new Date(),
): Promise<DeckGroupDto[]> {
  const subject = await requireSubject(db, slug);
  const dueSql = sql<number>`count(*) filter (where ${and(
    ...reviewableConditions(),
    dueCardConditions(now),
    treatedCardCondition(now),
    sql`${flashcards.state} <> 'new'`,
  )})::int`;
  const rows: {
    topicId: string | null;
    total: number;
    due: number;
    isNew: number;
    suspended: number;
  }[] = await db
    .select({
      topicId: flashcards.topicId,
      total: sql<number>`count(*)::int`,
      due: dueSql,
      isNew: sql<number>`count(*) filter (where ${and(
        ...reviewableConditions(),
        treatedCardCondition(now),
        sql`${flashcards.state} = 'new'`,
      )})::int`,
      suspended: sql<number>`count(*) filter (where ${flashcards.suspended})::int`,
    })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(eq(artifacts.subjectId, subject.id))
    .groupBy(flashcards.topicId);

  const topicRows: { id: string; name: string; parentId: string | null }[] = await db
    .select({ id: topics.id, name: topics.name, parentId: topics.parentId })
    .from(topics)
    .where(eq(topics.subjectId, subject.id))
    .orderBy(asc(topics.orderIndex), asc(topics.name));

  const byTopic = new Map(rows.map((r) => [r.topicId, r]));
  const toGroup = (
    r: (typeof rows)[number],
    t: { id: string; name: string; parentId: string | null } | null,
  ): DeckGroupDto => ({
    topicId: t?.id ?? null,
    topicName: t?.name ?? null,
    parentTopicId: t?.parentId ?? null,
    total: Number(r.total),
    due: Number(r.due),
    new: Number(r.isNew),
    suspended: Number(r.suspended),
  });

  const groups: DeckGroupDto[] = [];
  for (const t of topicRows) {
    const r = byTopic.get(t.id);
    if (r) groups.push(toGroup(r, t));
  }
  const loose = byTopic.get(null);
  if (loose) groups.push(toGroup(loose, null));
  return groups;
}

/**
 * Enqueues `sort_flashcards` for the subject. 409 when a sort is already waiting in the queue or
 * running (a job row exists only once the worker picked it up, so both are checked).
 */
export async function enqueueSortFlashcards(
  db: AnyDb,
  queue: Pick<Queue, 'add' | 'getJobs'>,
  slug: string,
  input: { cardIds?: string[] | undefined } = {},
): Promise<{ jobId: string }> {
  const subject = await requireSubject(db, slug);

  const [running] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, 'sort_flashcards'),
        eq(jobs.subjectId, subject.id),
        sql`${jobs.status} in ('queued', 'running')`,
      ),
    )
    .limit(1);
  const pending = await queue.getJobs(['waiting', 'active', 'delayed', 'prioritized']);
  const queued = pending.find(
    (j) =>
      j?.name === 'sort_flashcards' && (j.data as { subjectId?: string })?.subjectId === subject.id,
  );
  const existingId = (running?.id as string | undefined) ?? queued?.id;
  if (running || queued) {
    throw new ConflictError(
      'Un ordinamento delle flashcard è già in corso per questa materia.',
      existingId,
    );
  }

  const jobId = randomUUID();
  await queue.add(
    'sort_flashcards',
    { subjectId: subject.id, ...(input.cardIds ? { cardIds: input.cardIds } : {}) },
    { jobId },
  );
  return { jobId };
}

/** Status of a `sort_flashcards` job of this subject; `queued` until the worker creates the job row. */
export async function getSortJobStatus(
  db: AnyDb,
  slug: string,
  jobId: string,
): Promise<SortFlashcardsStatus> {
  const subject = await requireSubject(db, slug);
  const [row] = await db
    .select({ status: jobs.status, output: jobs.output, error: jobs.error })
    .from(jobs)
    .where(
      and(eq(jobs.id, jobId), eq(jobs.subjectId, subject.id), eq(jobs.type, 'sort_flashcards')),
    );
  if (!row) return { status: 'queued' };
  return {
    status: row.status,
    output: row.output ?? null,
    error: (row.error as { message?: string } | null)?.message ?? null,
  };
}
