import { and, asc, eq, inArray } from 'drizzle-orm';
import { artifacts, flashcards, subjects, taskFlashcards, tasks } from '@studyhub/db';
import type { TaskFlashcardsResponse, UpdateTaskFlashcardsRequest } from '@studyhub/contracts';
import { SubjectNotFoundError } from './errors';
import { NotFoundError } from './examPrep';
import { toDto } from './review';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

async function requireTask(db: AnyDb, subjectSlug: string, taskId: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.subjectId, subject.id)));
  if (!task) throw new NotFoundError(`Task ${taskId}`);
  return { subject, task: task as typeof tasks.$inferSelect };
}

/** The cards attached to a lesson (plan task), oldest link first, with how each got attached. */
export async function getTaskFlashcards(
  db: AnyDb,
  subjectSlug: string,
  taskId: string,
): Promise<TaskFlashcardsResponse> {
  const { task } = await requireTask(db, subjectSlug, taskId);
  const rows: {
    f: typeof flashcards.$inferSelect;
    source: 'auto' | 'user';
    deckStatus: string;
  }[] = await db
    .select({ f: flashcards, source: taskFlashcards.source, deckStatus: artifacts.status })
    .from(taskFlashcards)
    .innerJoin(flashcards, eq(taskFlashcards.flashcardId, flashcards.id))
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(eq(taskFlashcards.taskId, taskId))
    .orderBy(asc(taskFlashcards.createdAt), asc(flashcards.createdAt), asc(flashcards.id));
  return {
    taskId,
    topicId: task.topicId,
    items: rows.map((r) => ({
      ...toDto(r.f),
      source: r.source,
      reviewable: r.deckStatus === 'approved' && !r.f.suspended && !r.f.flaggedAt,
    })),
  };
}

/**
 * Manual attach/detach. `add` only accepts cards of the task's subject (anything else is a
 * not-found, nothing is written); an existing `auto` link becomes `user`, so the automation never
 * moves it again. `remove` deletes the link whatever its source.
 */
export async function updateTaskFlashcards(
  db: AnyDb,
  subjectSlug: string,
  taskId: string,
  request: UpdateTaskFlashcardsRequest,
): Promise<TaskFlashcardsResponse> {
  const { subject } = await requireTask(db, subjectSlug, taskId);
  const add = [...new Set(request.add ?? [])];
  const remove = [...new Set(request.remove ?? [])];

  if (add.length > 0) {
    const owned: { id: string }[] = await db
      .select({ id: flashcards.id })
      .from(flashcards)
      .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
      .where(and(inArray(flashcards.id, add), eq(artifacts.subjectId, subject.id)));
    if (owned.length !== add.length) {
      const ok = new Set(owned.map((o) => o.id));
      throw new NotFoundError(`Flashcard ${add.find((id) => !ok.has(id))}`);
    }
  }

  await db.transaction(async (tx: AnyDb) => {
    if (remove.length > 0) {
      await tx
        .delete(taskFlashcards)
        .where(and(eq(taskFlashcards.taskId, taskId), inArray(taskFlashcards.flashcardId, remove)));
    }
    if (add.length > 0) {
      await tx
        .insert(taskFlashcards)
        .values(add.map((flashcardId) => ({ taskId, flashcardId, source: 'user' as const })))
        .onConflictDoUpdate({
          target: [taskFlashcards.taskId, taskFlashcards.flashcardId],
          set: { source: 'user' },
        });
    }
  });
  return getTaskFlashcards(db, subjectSlug, taskId);
}
