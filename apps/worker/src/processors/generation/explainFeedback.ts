import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  chunks,
  documents,
  lessonBlocks,
  sessionItems,
  studySessions,
  subjects,
  tasks,
  topics,
} from '@studyhub/db';
import { selectBriefingChunks } from '@studyhub/core';
import {
  estimateCostEur,
  resolveModel,
  resolveProvider,
  type AiProvider,
  type ExplainFeedbackOutput,
  type LessonChunk,
} from '@studyhub/ai';
import type { ExplainFeedbackJobInput, ExplanationFeedbackDto } from '@studyhub/contracts';
import { checkBudget } from './shared.js';

const MODEL_ROUTING_EXPLAIN_FEEDBACK = 'claude-sonnet-5-5'; // docs/03-ai-e-worker.md §4

export const EXPLAIN_FEEDBACK_JOB = 'explain_feedback';

export interface ExplainFeedbackResult {
  sessionId: string;
  itemId: string;
  /** true = the item already had its feedback and nothing was spent. */
  skipped: boolean;
  /** Points kept without a citation because the quote was not verbatim in a chunk of the session. */
  uncitedPoints: number;
  costEur?: number;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * `explain_feedback` (docs/10-planner-lezioni.md §3.2, phase "Rielabora"): compares the student's
 * own explanation (a `session_items` row of kind `explanation`) with the lesson material and stores
 * giusto / manca / attento on the item. A point keeps its citation only when the quote is verbatim
 * in a chunk of this session; otherwise it is kept without one (a "manca" is never lost). The
 * feedback lives in the item's `feedback` jsonb as an `ExplanationFeedbackDto`.
 * Idempotent: an item that already has its feedback is left alone unless `force`.
 */
export async function processExplainFeedback(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: ExplainFeedbackJobInput,
  /** Injectable for tests. */
  provider: AiProvider = resolveProvider(),
): Promise<ExplainFeedbackResult> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, input.subjectId));
  if (!subject) throw new Error(`subject not found: ${input.subjectId}`);

  const [session] = await db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.id, input.sessionId), eq(studySessions.subjectId, subject.id)));
  if (!session) throw new Error(`Sessione non trovata: ${input.sessionId}`);

  const [item] = await db
    .select()
    .from(sessionItems)
    .where(
      and(
        eq(sessionItems.id, input.itemId),
        eq(sessionItems.sessionId, session.id),
        eq(sessionItems.kind, 'explanation'),
      ),
    );
  if (!item) throw new Error(`Spiegazione non trovata: ${input.itemId}`);
  if (item.feedback && !input.force) {
    return { sessionId: session.id, itemId: item.id, skipped: true, uncitedPoints: 0 };
  }
  if (session.status === 'ended') throw new Error('La sessione è già terminata.');
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

  const blocks: { title: string; body: string }[] = await db
    .select({ title: lessonBlocks.title, body: lessonBlocks.body })
    .from(lessonBlocks)
    .where(eq(lessonBlocks.sessionId, session.id))
    .orderBy(asc(lessonBlocks.orderIndex));

  const sessionTopics: { id: string; name: string }[] = session.topicIds.length
    ? await db
        .select({ id: topics.id, name: topics.name })
        .from(topics)
        .where(inArray(topics.id, session.topicIds))
    : [];

  const model = input.model ?? resolveModel(MODEL_ROUTING_EXPLAIN_FEEDBACK);
  const result = await provider.gradeExplanation(
    {
      subjectName: subject.name,
      topicNames: sessionTopics.map((t) => t.name),
      studentText: item.body,
      chunks: lessonChunks,
      lessonBlocks: blocks,
    },
    model,
  );

  const costEur = estimateCostEur(
    result.model,
    result.usage.inputTokens,
    result.usage.outputTokens,
  );
  await checkBudget(db, costEur, input.force);

  const { feedback, uncitedPoints } = buildExplanationFeedback(
    result.data,
    lessonChunks,
    docName,
    result.model,
  );
  await db.update(sessionItems).set({ feedback }).where(eq(sessionItems.id, item.id));

  return {
    sessionId: session.id,
    itemId: item.id,
    skipped: false,
    uncitedPoints,
    costEur,
    usage: result.usage,
  };
}

/**
 * Turns the provider's points into the stored feedback: the citation is kept (as `{docId, page,
 * quote}` plus the document name) only when its chunk belongs to the session and the quote is
 * verbatim in it; otherwise the point stays with `citation: null`.
 */
export function buildExplanationFeedback(
  output: ExplainFeedbackOutput,
  lessonChunks: { id: string; docId: string; page: number; text: string }[],
  docName: Map<string, string>,
  model: string,
  now: Date = new Date(),
): { feedback: ExplanationFeedbackDto; uncitedPoints: number } {
  const byId = new Map(lessonChunks.map((c) => [c.id, c]));
  let uncitedPoints = 0;
  const convert = (points: ExplainFeedbackOutput['correct']) =>
    points.map((p) => {
      const chunk = byId.get(p.chunkId);
      if (!chunk || p.quote.trim() === '' || !chunk.text.includes(p.quote)) {
        uncitedPoints += 1;
        return { text: p.text, citation: null };
      }
      return {
        text: p.text,
        citation: {
          docId: chunk.docId,
          documentName: docName.get(chunk.docId) ?? 'Documento',
          page: chunk.page,
          quote: p.quote,
        },
      };
    });
  const feedback: ExplanationFeedbackDto = {
    correct: convert(output.correct),
    missing: convert(output.missing),
    wrong: convert(output.wrong),
    model,
    gradedAt: now.toISOString(),
  };
  return { feedback, uncitedPoints };
}
