import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  chunks,
  documents,
  documentTopics,
  examProfiles,
  sessionItems,
  studySessions,
  subjects,
  tasks,
  topics,
  type NewSessionItem,
  type SessionItemCitation,
  type SolutionStep,
} from '@studyhub/db';
import { describeExamStyle, selectBriefingChunks } from '@studyhub/core';
import {
  estimateCostEur,
  resolveModel,
  resolveProvider,
  type AiProvider,
  type LessonChunk,
  type SprintExercisesOutput,
} from '@studyhub/ai';
import type { GenerateSprintExercisesJobInput } from '@studyhub/contracts';
import { checkBudget } from './shared.js';

const MODEL_ROUTING_SPRINT_EXERCISES = 'claude-sonnet-5-5'; // docs/03-ai-e-worker.md §4

/** How many past-exam documents, and how many characters of each, are handed over as style reference. */
const EXAM_EXCERPT_DOCS = 3;
const EXAM_EXCERPT_CHARS = 1500;

export interface GenerateSprintExercisesResult {
  sessionId: string;
  /** true = the exercises already existed and nothing was spent. */
  skipped: boolean;
  exerciseCount: number;
  discardedCount: number;
  costEur?: number;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * `generate_sprint_exercises` (docs/10-planner-lezioni.md §3.3): the exam-style exercises of a sprint
 * lesson — each with its step-by-step solution, the theory concepts it needs and a similar exercise
 * to retry — in one job, one cost. Idempotent (a session that already has them is left alone).
 * Past exams and the exam profile, when present, set the style; otherwise the material alone does.
 * Citations are kept only when their quote is verbatim in the chunk they cite.
 */
export async function processGenerateSprintExercises(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: GenerateSprintExercisesJobInput,
  /** Injectable for tests. */
  provider: AiProvider = resolveProvider(),
): Promise<GenerateSprintExercisesResult> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, input.subjectId));
  if (!subject) throw new Error(`subject not found: ${input.subjectId}`);

  const [session] = await db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.id, input.sessionId), eq(studySessions.subjectId, subject.id)));
  if (!session) throw new Error(`Sessione non trovata: ${input.sessionId}`);
  if (session.status === 'ended') throw new Error('La sessione è già terminata.');
  if (session.method !== 'sprint')
    throw new Error('Gli esercizi si generano per le lezioni sprint.');
  if (session.documentIds.length === 0) {
    throw new Error(
      'La sessione non ha documenti: scegli un argomento o collega i documenti agli argomenti.',
    );
  }

  const existing: { id: string }[] = await db
    .select({ id: sessionItems.id })
    .from(sessionItems)
    .where(and(eq(sessionItems.sessionId, session.id), eq(sessionItems.kind, 'exercise')))
    .limit(1);
  if (existing.length > 0) {
    return {
      sessionId: session.id,
      skipped: true,
      exerciseCount: 0,
      discardedCount: 0,
    };
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

  const [profileRow] = await db
    .select()
    .from(examProfiles)
    .where(eq(examProfiles.subjectId, input.subjectId));
  const examExcerpts = await loadExamExcerpts(db, input.subjectId);

  const model = input.model ?? resolveModel(MODEL_ROUTING_SPRINT_EXERCISES);
  const result = await provider.generateSprintExercises(
    {
      subjectName: subject.name,
      topicNames: sessionTopics.map((t) => t.name),
      chunks: lessonChunks,
      ...(profileRow ? { examStyle: describeExamStyle(profileRow.profile) } : {}),
      ...(examExcerpts.length > 0 ? { examExcerpts } : {}),
    },
    model,
  );

  const costEur = estimateCostEur(
    result.model,
    result.usage.inputTokens,
    result.usage.outputTokens,
  );
  await checkBudget(db, costEur, input.force);

  const { exercises, discardedCount } = validateSprintExercises(result.data, lessonChunks);
  if (exercises.length === 0) {
    throw new Error(
      'Nessun esercizio con una citazione verificabile nel materiale: riprova, magari con un altro modello.',
    );
  }

  // The topic of an exercise: one of the session's topics its document is tagged with.
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

  // Another job may have saved the exercises while this one was waiting for the model.
  const raced: { id: string }[] = await db
    .select({ id: sessionItems.id })
    .from(sessionItems)
    .where(and(eq(sessionItems.sessionId, session.id), eq(sessionItems.kind, 'exercise')))
    .limit(1);
  if (raced.length > 0) {
    return { sessionId: session.id, skipped: true, exerciseCount: 0, discardedCount };
  }

  const exerciseRows: NewSessionItem[] = [];
  const retryRows: NewSessionItem[] = [];
  exercises.forEach((e, i) => {
    const id = randomUUID();
    const topicId = topicOfDoc(e.citations[0]!.docId);
    exerciseRows.push({
      id,
      sessionId: session.id,
      kind: 'exercise',
      orderIndex: i,
      title: e.question,
      body: renderSolution(e.solutionSteps),
      solutionSteps: e.solutionSteps,
      concepts: e.concepts,
      citations: e.citations,
      topicId,
    });
    retryRows.push({
      id: randomUUID(),
      sessionId: session.id,
      kind: 'retry_exercise',
      orderIndex: i,
      title: e.retry.question,
      body: renderSolution(e.retry.solutionSteps),
      solutionSteps: e.retry.solutionSteps,
      // The retry is graded against the same passage of the material as its exercise.
      citations: e.citations,
      topicId,
      parentItemId: id,
    });
  });
  // One statement: exercises and retries land together or not at all (a retry would otherwise be
  // lost for good, since the exercises' presence makes a retry of the job skip).
  await db.insert(sessionItems).values([...exerciseRows, ...retryRows]);

  return {
    sessionId: session.id,
    skipped: false,
    exerciseCount: exercises.length,
    discardedCount,
    costEur,
    usage: result.usage,
  };
}

/** The solution as plain numbered text (what the grader gets as the expected answer). */
export function renderSolution(steps: SolutionStep[]): string {
  return steps
    .map((s, i) => `${i + 1}. ${s.text}${s.formula ? `\n$$${s.formula}$$` : ''}`)
    .join('\n');
}

interface ValidSprintExercise {
  question: string;
  solutionSteps: SolutionStep[];
  concepts: string[];
  retry: { question: string; solutionSteps: SolutionStep[] };
  citations: SessionItemCitation[];
}

/** Keeps the exercises with at least one verbatim citation; the same question is never kept twice. */
export function validateSprintExercises(
  output: SprintExercisesOutput,
  lessonChunks: { id: string; docId: string; page: number; text: string }[],
): { exercises: ValidSprintExercise[]; discardedCount: number } {
  const byId = new Map(lessonChunks.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const exercises: ValidSprintExercise[] = [];
  let discardedCount = 0;
  for (const e of output.exercises) {
    const citations: SessionItemCitation[] = [];
    for (const c of e.citations) {
      const chunk = byId.get(c.chunkId);
      if (chunk && c.quote.trim() !== '' && chunk.text.includes(c.quote)) {
        citations.push({ docId: chunk.docId, page: chunk.page, quote: c.quote });
      }
    }
    const key = e.question.trim().toLowerCase();
    if (citations.length === 0 || seen.has(key)) {
      discardedCount += 1;
      continue;
    }
    seen.add(key);
    exercises.push({
      question: e.question,
      solutionSteps: e.solutionSteps,
      concepts: e.concepts,
      retry: e.retry,
      citations,
    });
  }
  return { exercises, discardedCount };
}

/** A few lines of each uploaded past exam, as style reference. */
async function loadExamExcerpts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subjectId: string,
): Promise<{ name: string; text: string }[]> {
  const exams: { id: string; originalName: string }[] = await db
    .select({ id: documents.id, originalName: documents.originalName })
    .from(documents)
    .where(
      and(
        eq(documents.subjectId, subjectId),
        eq(documents.type, 'esami'),
        eq(documents.status, 'parsed'),
      ),
    )
    .limit(EXAM_EXCERPT_DOCS);
  const out: { name: string; text: string }[] = [];
  for (const exam of exams) {
    const rows: { text: string }[] = await db
      .select({ text: chunks.text })
      .from(chunks)
      .where(eq(chunks.documentId, exam.id))
      .orderBy(asc(chunks.ord))
      .limit(2);
    const text = rows
      .map((r) => r.text)
      .join('\n')
      .slice(0, EXAM_EXCERPT_CHARS);
    if (text.trim() !== '') out.push({ name: exam.originalName, text });
  }
  return out;
}
