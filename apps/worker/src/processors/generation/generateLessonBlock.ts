import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  chunks,
  documents,
  jobs,
  lessonBlocks,
  sessionItems,
  studySessions,
  subjects,
  tasks,
  topics,
  type NewSessionItem,
  type SessionItemCitation,
} from '@studyhub/db';
import { selectBriefingChunks } from '@studyhub/core';
import {
  estimateCostEur,
  resolveModel,
  resolveProvider,
  type AiProvider,
  type LessonChunk,
  type SessionLessonOutput,
} from '@studyhub/ai';
import type { GenerateLessonBlockJobInput } from '@studyhub/contracts';
import { createJobQueue } from '../../queue.js';
import { checkBudget } from './shared.js';

const MODEL_ROUTING_SESSION_LESSON = 'claude-sonnet-5-5'; // docs/03-ai-e-worker.md §4

export const GENERATE_LESSON_BLOCK_JOB = 'generate_lesson_block';

/** Puts a job on the queue; injectable so tests need no Redis. */
export type JobEnqueuer = (name: string, data: unknown, jobId: string) => Promise<void>;

let sharedQueue: ReturnType<typeof createJobQueue> | undefined;
const defaultEnqueue: JobEnqueuer = async (name, data, jobId) => {
  sharedQueue ??= createJobQueue();
  await sharedQueue.add(name, data, { jobId });
};

export interface GenerateLessonBlockResult {
  sessionId: string;
  blockIndex: number;
  blockId: string | null;
  /** true = the block already existed and nothing was spent. */
  skipped: boolean;
  blockCount: number | null;
  discardedCitations: number;
  costEur?: number;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * `generate_lesson_block` (docs/10-planner-lezioni.md §3.2): block `blockIndex` of a guided lesson.
 * Idempotent (an existing block is left alone unless `regenerate`). The first block also fixes how
 * many blocks the lesson has and stores the guide questions, then queues block 1 so the next one
 * is ready before the student gets there. Citations are kept only when their quote is verbatim in
 * the chunk they cite (the provider does not verify them).
 */
export async function processGenerateLessonBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: GenerateLessonBlockJobInput,
  /** Injectable for tests. */
  provider: AiProvider = resolveProvider(),
  enqueue: JobEnqueuer = defaultEnqueue,
): Promise<GenerateLessonBlockResult> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, input.subjectId));
  if (!subject) throw new Error(`subject not found: ${input.subjectId}`);

  const [session] = await db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.id, input.sessionId), eq(studySessions.subjectId, subject.id)));
  if (!session) throw new Error(`Sessione non trovata: ${input.sessionId}`);
  if (session.status === 'ended') throw new Error('La sessione è già terminata.');

  const existingBlocks: {
    id: string;
    orderIndex: number;
    title: string;
    body: string;
    state: string;
  }[] = await db
    .select({
      id: lessonBlocks.id,
      orderIndex: lessonBlocks.orderIndex,
      title: lessonBlocks.title,
      body: lessonBlocks.body,
      state: lessonBlocks.state,
    })
    .from(lessonBlocks)
    .where(eq(lessonBlocks.sessionId, session.id))
    .orderBy(asc(lessonBlocks.orderIndex));
  const current = existingBlocks.find((b) => b.orderIndex === input.blockIndex);
  if (current && !input.regenerate) {
    return {
      sessionId: session.id,
      blockIndex: input.blockIndex,
      blockId: current.id,
      skipped: true,
      blockCount: session.blockCount ?? null,
      discardedCitations: 0,
    };
  }
  if (
    input.blockIndex > 0 &&
    session.blockCount !== null &&
    input.blockIndex >= session.blockCount
  ) {
    throw new Error('Questo blocco è oltre la fine della lezione.');
  }

  if (session.documentIds.length === 0) {
    throw new Error(
      'La sessione non ha documenti: scegli un argomento o collega i documenti agli argomenti.',
    );
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

  const docRows: { id: string; originalName: string }[] = await db
    .select({ id: documents.id, originalName: documents.originalName })
    .from(documents)
    .where(inArray(documents.id, session.documentIds));
  const docName = new Map(docRows.map((d) => [d.id, d.originalName]));

  const chunkRows: { id: string; documentId: string; pageFrom: number; text: string }[] = await db
    .select({
      id: chunks.id,
      documentId: chunks.documentId,
      pageFrom: chunks.pageFrom,
      text: chunks.text,
    })
    .from(chunks)
    .where(inArray(chunks.documentId, session.documentIds))
    .orderBy(chunks.documentId, chunks.ord);
  const allChunks: LessonChunk[] = chunkRows.map((r) => ({
    id: r.id,
    docId: r.documentId,
    documentName: docName.get(r.documentId),
    page: r.pageFrom,
    text: r.text,
  }));
  // `selectBriefingChunks` returns the very objects it was given, so identity maps back to the ids.
  const picked = new Set<unknown>(selectBriefingChunks(allChunks, planned));
  const lessonChunks = allChunks.filter((c) => picked.has(c));
  if (lessonChunks.length === 0) {
    throw new Error(
      'Nessun testo estratto dal materiale di questa lezione: attendi che i documenti siano elaborati (estrazione del testo) e riprova.',
    );
  }

  const sessionTopics: { id: string; name: string }[] = session.topicIds.length
    ? await db
        .select({ id: topics.id, name: topics.name })
        .from(topics)
        .where(inArray(topics.id, session.topicIds))
    : [];

  const model = input.model ?? resolveModel(MODEL_ROUTING_SESSION_LESSON);
  const result = await provider.generateLessonBlock(
    {
      subjectName: subject.name,
      topicNames: sessionTopics.map((t) => t.name),
      chunks: lessonChunks,
      blockIndex: input.blockIndex,
      previousBlockTitles: existingBlocks
        .filter((b) => b.orderIndex < input.blockIndex)
        .map((b) => b.title),
      ...(input.hint ? { hint: input.hint } : {}),
      ...(current ? { previousBody: current.body } : {}),
    },
    model,
  );

  const costEur = estimateCostEur(
    result.model,
    result.usage.inputTokens,
    result.usage.outputTokens,
  );
  await checkBudget(db, costEur, input.force);

  const { citations, discardedCount } = validateCitations(
    result.data.block.citations,
    lessonChunks,
  );
  if (citations.length === 0) {
    throw new Error(
      'Il blocco non ha citazioni verificabili nel materiale: riprova, magari con un altro modello.',
    );
  }

  const block = result.data.block;
  const fields = {
    title: block.title,
    body: block.body,
    formula: block.formula,
    exampleSteps: block.exampleSteps,
    trap: block.trap,
    checkQuestion: block.checkQuestion,
    checkAnswer: block.checkAnswer,
    citations,
    model: result.model,
    updatedAt: new Date(),
  };

  let blockId: string;
  let blockCount: number | null = session.blockCount ?? null;
  if (current) {
    // Same id and index: the block stays what it was (state, student's answer) until replaced.
    await db.update(lessonBlocks).set(fields).where(eq(lessonBlocks.id, current.id));
    blockId = current.id;
  } else {
    // A block generated after its predecessor was already answered is born open.
    const previous = existingBlocks.find((b) => b.orderIndex === input.blockIndex - 1);
    const open = input.blockIndex === 0 || previous?.state === 'done';
    blockId = randomUUID();
    const inserted = await db
      .insert(lessonBlocks)
      .values({
        id: blockId,
        sessionId: session.id,
        orderIndex: input.blockIndex,
        ...fields,
        state: open ? 'open' : 'locked',
      })
      .onConflictDoNothing()
      .returning({ id: lessonBlocks.id });
    if (inserted.length === 0) {
      // Another job created this block meanwhile: leave it alone.
      return {
        sessionId: session.id,
        blockIndex: input.blockIndex,
        blockId: null,
        skipped: true,
        blockCount,
        discardedCitations: discardedCount,
      };
    }

    if (input.blockIndex > 0 && !open) {
      // The student may have answered the previous block while this one was being generated:
      // re-check against the current state, atomically, so the lesson is never left locked.
      await db
        .update(lessonBlocks)
        .set({ state: 'open', updatedAt: new Date() })
        .where(
          and(
            eq(lessonBlocks.id, blockId),
            eq(lessonBlocks.state, 'locked'),
            sql`exists (select 1 from lesson_blocks p where p.session_id = ${session.id} and p.order_index = ${input.blockIndex - 1} and p.state = 'done')`,
          ),
        );
    }

    if (input.blockIndex === 0) {
      blockCount = result.data.blockCount;
      await db.update(studySessions).set({ blockCount }).where(eq(studySessions.id, session.id));
      await saveGuideQuestions(db, session.id, result.data);
    }
  }

  if (input.blockIndex === 0 && !current && (blockCount ?? 0) > 1) {
    await enqueueLessonBlock(db, enqueue, {
      subjectId: subject.id,
      sessionId: session.id,
      blockIndex: 1,
      ...(input.model ? { model: input.model } : {}),
      force: input.force,
    });
  }

  return {
    sessionId: session.id,
    blockIndex: input.blockIndex,
    blockId,
    skipped: false,
    blockCount,
    discardedCitations: discardedCount,
    costEur,
    usage: result.usage,
  };
}

async function saveGuideQuestions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  sessionId: string,
  output: SessionLessonOutput,
) {
  const existing = await db
    .select({ id: sessionItems.id })
    .from(sessionItems)
    .where(and(eq(sessionItems.sessionId, sessionId), eq(sessionItems.kind, 'guide_question')))
    .limit(1);
  if (existing.length > 0 || output.guideQuestions.length === 0) return;
  const rows: NewSessionItem[] = output.guideQuestions.map((question, i) => ({
    id: randomUUID(),
    sessionId,
    kind: 'guide_question' as const,
    orderIndex: i,
    title: question,
    body: '',
  }));
  await db.insert(sessionItems).values(rows);
}

/** Records a `queued` job row (so the UI sees it at once) and puts the job on the queue. */
async function enqueueLessonBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  enqueue: JobEnqueuer,
  data: {
    subjectId: string;
    sessionId: string;
    blockIndex: number;
    model?: string;
    force: boolean;
  },
) {
  const [pending] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, GENERATE_LESSON_BLOCK_JOB),
        inArray(jobs.status, ['queued', 'running']),
        sql`${jobs.input}->>'sessionId' = ${data.sessionId}`,
        sql`(${jobs.input}->>'blockIndex')::int = ${data.blockIndex}`,
      ),
    );
  if (pending) return;
  const jobId = randomUUID();
  const payload = { ...data, regenerate: false };
  await db.insert(jobs).values({
    id: jobId,
    type: GENERATE_LESSON_BLOCK_JOB,
    subjectId: data.subjectId,
    status: 'queued',
    input: payload,
  });
  await enqueue(GENERATE_LESSON_BLOCK_JOB, payload, jobId);
}

/** Keeps the citations whose quote is verbatim in the chunk they cite; stored as `{docId, page, quote}`. */
export function validateCitations(
  citations: SessionLessonOutput['block']['citations'],
  lessonChunks: { id: string; docId: string; page: number; text: string }[],
): { citations: SessionItemCitation[]; discardedCount: number } {
  const byId = new Map(lessonChunks.map((c) => [c.id, c]));
  const kept: SessionItemCitation[] = [];
  let discardedCount = 0;
  for (const c of citations) {
    const chunk = byId.get(c.chunkId);
    if (!chunk || c.quote.trim() === '' || !chunk.text.includes(c.quote)) {
      discardedCount += 1;
      continue;
    }
    kept.push({ docId: chunk.docId, page: chunk.page, quote: c.quote });
  }
  return { citations: kept, discardedCount };
}
