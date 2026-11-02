import { eq } from 'drizzle-orm';
import { recomputeTopicMastery, tasks, type StudySession } from '@studyhub/db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/** The topic a verification is about: the task's (payload first), else the session's first topic. */
export async function verifyTopicIdOf(db: AnyDb, session: StudySession): Promise<string | null> {
  if (session.taskId) {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, session.taskId));
    const fromTask = task?.payload?.topicId ?? task?.topicId ?? null;
    if (fromTask) return fromTask;
  }
  return session.topicIds[0] ?? null;
}

/**
 * Brings the topic's mastery up to date after a verification question got (or lost) an outcome, so
 * the result shows the new value without closing the session. Only for verifications with prepared
 * questions; the others keep their old behaviour.
 */
export async function recomputeVerifyMastery(db: AnyDb, session: StudySession): Promise<void> {
  if (session.kind !== 'verify' || !session.verifyPreparedAt) return;
  const topicId = await verifyTopicIdOf(db, session);
  if (topicId) await recomputeTopicMastery(db, topicId);
}
