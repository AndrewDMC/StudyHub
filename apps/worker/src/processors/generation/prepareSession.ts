import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import {
  documentTopics,
  examProfiles,
  sessionItems,
  studySessions,
  subjects,
  tasks,
  topics,
  type NewSessionItem,
} from '@studyhub/db';
import {
  BRIEFING_EXERCISES,
  BRIEFING_KEY_POINTS,
  BRIEFING_MORE_EXERCISES,
  describeExamStyle,
  selectBriefingChunks,
} from '@studyhub/core';
import {
  estimateCostEur,
  resolveProvider,
  type AiProvider,
  type SessionBriefingOutput,
  resolveModel,
} from '@studyhub/ai';
import type { PrepareSessionJobInput } from '@studyhub/contracts';
import { checkBudget, resolveScopeChunks } from './shared.js';

const MODEL_ROUTING_SESSION_BRIEFING = 'claude-sonnet-5-5'; // docs/03-ai-e-worker.md §4

export interface PrepareSessionResult {
  sessionId: string;
  keyPointCount: number;
  exerciseCount: number;
  discardedCount: number;
  costEur: number;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * `prepare_session` (docs/08-sessione-di-studio.md §5.2): the key points and exercises of a study
 * session, generated only when the student asks (decision 3). Anti-hallucination gate as in
 * `generate_flashcards`: an item survives only if its `quote` is a verbatim substring of the chunk
 * it cites, and that chunk must be one of the session's documents.
 */
export async function processPrepareSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: PrepareSessionJobInput,
  /** Injectable for tests (e.g. to exercise citation rejection deterministically). */
  provider: AiProvider = resolveProvider(),
): Promise<PrepareSessionResult> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, input.subjectId));
  if (!subject) throw new Error(`subject not found: ${input.subjectId}`);

  const [session] = await db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.id, input.sessionId), eq(studySessions.subjectId, subject.id)));
  if (!session) throw new Error(`Sessione non trovata: ${input.sessionId}`);
  if (session.status === 'ended') throw new Error('La sessione è già terminata.');
  if (session.documentIds.length === 0) {
    throw new Error(
      'La sessione non ha documenti: scegli un argomento o collega i documenti agli argomenti.',
    );
  }

  const existing: { kind: 'key_point' | 'exercise'; orderIndex: number; title: string }[] = await db
    .select({
      kind: sessionItems.kind,
      orderIndex: sessionItems.orderIndex,
      title: sessionItems.title,
    })
    .from(sessionItems)
    .where(eq(sessionItems.sessionId, session.id));
  if (input.mode === 'all' && existing.length > 0) {
    throw new Error('Punti chiave ed esercizi sono già stati generati: chiedi "altri esercizi".');
  }

  const [task] = session.taskId
    ? await db.select().from(tasks).where(eq(tasks.id, session.taskId))
    : [];
  const planned = (task?.payload?.material ?? []).map(
    (m: { docId: string; pageFrom: number; pageTo: number }) => ({
      docId: m.docId,
      pageFrom: m.pageFrom,
      pageTo: m.pageTo,
    }),
  );

  const allChunks = await resolveScopeChunks(db, input.subjectId, { docIds: session.documentIds });
  const chunks = selectBriefingChunks(allChunks, planned);

  const sessionTopics: { id: string; name: string }[] = session.topicIds.length
    ? await db
        .select({ id: topics.id, name: topics.name })
        .from(topics)
        .where(inArray(topics.id, session.topicIds))
    : [];

  const [profileRow] = await db
    .select()
    .from(examProfiles)
    .where(eq(examProfiles.subjectId, input.subjectId));

  const exerciseCount = input.mode === 'all' ? BRIEFING_EXERCISES : BRIEFING_MORE_EXERCISES;
  const model = input.model ?? resolveModel(MODEL_ROUTING_SESSION_BRIEFING);
  const result = await provider.generateSessionBriefing(
    {
      subjectName: subject.name,
      topicNames: sessionTopics.map((t) => t.name),
      chunks,
      keyPointCount: input.mode === 'all' ? BRIEFING_KEY_POINTS : 0,
      exerciseCount,
      existingExercises: existing.filter((e) => e.kind === 'exercise').map((e) => e.title),
      examStyle: profileRow ? describeExamStyle(profileRow.profile) : undefined,
    },
    model,
  );

  const costEur = estimateCostEur(
    result.model,
    result.usage.inputTokens,
    result.usage.outputTokens,
  );
  await checkBudget(db, costEur, input.force);

  const { keyPoints, exercises, discardedCount } = validateBriefing(result.data, chunks, {
    wantKeyPoints: input.mode === 'all',
    existingExercises: new Set(existing.filter((e) => e.kind === 'exercise').map((e) => e.title)),
  });
  if (keyPoints.length === 0 && exercises.length === 0) {
    throw new Error(
      discardedCount === 0 && input.mode === 'exercises'
        ? 'Nessun nuovo esercizio: quelli che si ricavano dal materiale ci sono già tutti.'
        : 'Nessun elemento con una citazione verificabile nel materiale: riprova, magari con un altro modello.',
    );
  }

  // The topic of an item: one of the session's topics its document is tagged with.
  const links: { documentId: string; topicId: string }[] = session.topicIds.length
    ? await db
        .select({ documentId: documentTopics.documentId, topicId: documentTopics.topicId })
        .from(documentTopics)
        .where(
          and(
            inArray(documentTopics.documentId, session.documentIds),
            inArray(documentTopics.topicId, session.topicIds),
          ),
        )
    : [];
  const topicOfDoc = (docId: string) => links.find((l) => l.documentId === docId)?.topicId ?? null;

  const nextIndex = (kind: 'key_point' | 'exercise') =>
    existing.filter((e) => e.kind === kind).reduce((max, e) => Math.max(max, e.orderIndex + 1), 0);
  const rows: NewSessionItem[] = [
    ...keyPoints.map((k, i) => ({
      id: randomUUID(),
      sessionId: session.id,
      kind: 'key_point' as const,
      orderIndex: nextIndex('key_point') + i,
      title: k.title,
      body: k.explanation,
      citations: [k.sourceRef],
      topicId: topicOfDoc(k.sourceRef.docId),
    })),
    ...exercises.map((e, i) => ({
      id: randomUUID(),
      sessionId: session.id,
      kind: 'exercise' as const,
      orderIndex: nextIndex('exercise') + i,
      title: e.prompt,
      body: e.solution,
      difficulty: e.difficulty,
      citations: [e.sourceRef],
      topicId: topicOfDoc(e.sourceRef.docId),
    })),
  ];
  await db.insert(sessionItems).values(rows);
  return {
    sessionId: session.id,
    keyPointCount: keyPoints.length,
    exerciseCount: exercises.length,
    discardedCount,
    costEur,
    usage: result.usage,
  };
}

/** Keeps the items whose quote is verbatim in the chunk they cite; exercises sorted easy → hard. */
export function validateBriefing(
  output: SessionBriefingOutput,
  chunks: { docId: string; page: number; text: string }[],
  options: { wantKeyPoints: boolean; existingExercises: ReadonlySet<string> },
) {
  const textByDocPage = new Map(chunks.map((c) => [`${c.docId}:${c.page}`, c.text]));
  const isCited = (ref: { docId: string; page: number; quote: string }) =>
    textByDocPage.get(`${ref.docId}:${ref.page}`)?.includes(ref.quote) ?? false;

  let discardedCount = 0;
  const seenTitles = new Set<string>();
  const keyPoints = options.wantKeyPoints
    ? output.keyPoints.filter((k) => {
        const key = k.title.trim().toLowerCase();
        if (!isCited(k.sourceRef) || seenTitles.has(key)) {
          discardedCount += 1;
          return false;
        }
        seenTitles.add(key);
        return true;
      })
    : [];
  const seenPrompts = new Set(options.existingExercises);
  const exercises = output.exercises
    .filter((e) => {
      if (!isCited(e.sourceRef) || seenPrompts.has(e.prompt)) {
        discardedCount += 1;
        return false;
      }
      seenPrompts.add(e.prompt);
      return true;
    })
    .sort((a, b) => a.difficulty - b.difficulty);
  return { keyPoints, exercises, discardedCount };
}
