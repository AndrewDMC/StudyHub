import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { documentTopics, documents, jobs, settings, subjects, topics } from '@studyhub/db';
import {
  estimateCostEur,
  estimateTokens,
  renderSubjectAskUserPrompt,
  resolveModel,
  type AiProvider,
  type SubjectAskPromptInput,
} from '@studyhub/ai';
import { parseAnswerCitations } from '@studyhub/core';
import type { AskSubjectEvent, AskSubjectRequest } from '@studyhub/contracts';
import { BudgetExceededError, SubjectNotFoundError, formatError } from './errors';
import { InvalidRequestError } from './examPrep';
import { retrieveChunks } from './search';
import {
  CHAT_DEFAULT_MODEL,
  SOURCE_LIMIT,
  SOURCE_MAX_CHARS,
  toChatSources,
  toCitations,
} from './sessionChat';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/** Ledger type of these calls in `jobs` (shows up in /admin and in the monthly cost). */
export const SUBJECT_ASK_JOB_TYPE = 'subject_ask';
/** What the answer says when there is nothing to read (same wording as the model's own refusal). */
export const INSUFFICIENT_SOURCES_ANSWER =
  'Le fonti selezionate non bastano per rispondere: prova a riformulare la domanda o a includere più documenti.';
/**
 * Same list as `AI_JOB_TYPES` in `apps/worker/src/processors/generation/shared.ts` (the web cannot import
 * the worker): keep them in sync.
 */
const AI_JOB_TYPES = [
  'generate_flashcards',
  'generate_schema',
  'generate_summary',
  'extract_exam_profile',
  'generate_simulation',
  'grade_attempt',
  'generate_plan',
  'extract_topics',
  'prepare_session',
  'sort_flashcards',
  'session_chat',
  'subject_ask',
];
/** Output tokens assumed by the pre-flight budget check. */
const ESTIMATED_OUTPUT_TOKENS = 600;

/** Documents the answer may draw on: explicit docs > documents tagged with the topics > the whole subject. */
async function resolveScopeDocIds(
  db: AnyDb,
  subjectId: string,
  request: AskSubjectRequest,
): Promise<string[]> {
  if (request.docIds && request.docIds.length > 0) {
    const ids = [...new Set(request.docIds)];
    const rows: { id: string }[] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.subjectId, subjectId), inArray(documents.id, ids)));
    if (rows.length !== ids.length) {
      throw new InvalidRequestError('Documenti non appartenenti a questa materia');
    }
    return ids;
  }
  if (request.topicIds && request.topicIds.length > 0) {
    const ids = [...new Set(request.topicIds)];
    const topicRows: { id: string }[] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(and(eq(topics.subjectId, subjectId), inArray(topics.id, ids)));
    if (topicRows.length !== ids.length) {
      throw new InvalidRequestError('Argomenti non appartenenti a questa materia');
    }
    const links: { documentId: string }[] = await db
      .select({ documentId: documentTopics.documentId })
      .from(documentTopics)
      .where(inArray(documentTopics.topicId, ids));
    return [...new Set(links.map((l) => l.documentId))];
  }
  const rows: { id: string }[] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.subjectId, subjectId));
  return rows.map((r) => r.id);
}

/**
 * Daily cap guard (`settings['budget.dailyCapEur']`, no cap = no guard): sums today's recorded AI cost in
 * the `jobs` ledger (chat included, aborted calls too) and refuses when this call would exceed it.
 */
async function assertWithinBudget(db: AnyDb, estimatedEur: number): Promise<void> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'budget.dailyCapEur'));
  const cap = typeof row?.value === 'number' ? row.value : null;
  if (cap === null) return;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const today: { cost: { eur?: number } | null }[] = await db
    .select({ cost: jobs.cost })
    .from(jobs)
    .where(
      and(
        inArray(jobs.type, AI_JOB_TYPES),
        inArray(jobs.status, ['succeeded', 'cancelled']),
        gte(jobs.createdAt, startOfDay),
      ),
    );
  const spent = today.reduce((sum, j) => sum + (j.cost?.eur ?? 0), 0);
  if (spent + estimatedEur > cap) throw new BudgetExceededError(cap, spent);
}

export interface SubjectAsk {
  /** Retrieval + model call + cost ledger. Yields `delta`s, then `done` (or `error`). Saves no message. */
  run(): AsyncGenerator<AskSubjectEvent>;
}

/**
 * One-shot question on a subject (docs/08 §5.3 without a session): no history, nothing stored but the cost.
 * Everything refusable with an HTTP status (unknown subject, ids of another subject, budget) throws here,
 * before the stream starts; what happens during the stream is reported as events.
 */
export async function askSubject(
  db: AnyDb,
  slug: string,
  request: AskSubjectRequest,
  provider: AiProvider,
): Promise<SubjectAsk> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, slug));
  if (!subject) throw new SubjectNotFoundError(slug);
  const subjectRow = subject as typeof subjects.$inferSelect;

  const documentIds = await resolveScopeDocIds(db, subjectRow.id, request);
  const model = request.model ?? resolveModel(CHAT_DEFAULT_MODEL);
  await assertWithinBudget(
    db,
    estimateCostEur(
      model,
      Math.ceil((SOURCE_LIMIT * SOURCE_MAX_CHARS) / 4) + request.question.length,
      ESTIMATED_OUTPUT_TOKENS,
    ),
  );

  async function* run(): AsyncGenerator<AskSubjectEvent> {
    // No document in scope (e.g. topics without tagged documents): nothing to read, nothing to pay for.
    if (documentIds.length === 0) {
      yield { type: 'done', answer: INSUFFICIENT_SOURCES_ANSWER, citations: [] };
      return;
    }

    let answer = '';
    let done: { usage: { inputTokens: number; outputTokens: number }; model: string } | null = null;
    let promptText = '';
    let started = false;
    let recorded = false;
    let outcome: 'succeeded' | 'failed' | 'cancelled' = 'cancelled';
    try {
      const found = await retrieveChunks(db, subjectRow.id, request.question, {
        documentIds,
        limit: SOURCE_LIMIT,
      });
      const sources = toChatSources(found);

      const input: SubjectAskPromptInput = {
        subjectName: subjectRow.name,
        sources,
        question: request.question,
      };
      promptText = renderSubjectAskUserPrompt(input);

      started = true;
      for await (const delta of provider.askStream(input, model)) {
        if (delta.type === 'text') {
          answer += delta.text;
          yield { type: 'delta', text: delta.text };
        } else {
          done = { usage: delta.usage, model: delta.model };
        }
      }
      if (!answer.trim()) throw new Error('Il modello non ha restituito nessuna risposta.');

      const parsed = parseAnswerCitations(answer, sources);
      outcome = 'succeeded';
      // The ledger row is written by the `finally` below, before the consumer sees `done`.
      await recordCost();
      yield { type: 'done', answer: parsed.text, citations: toCitations(parsed.cited) };
    } catch (err) {
      outcome = 'failed';
      yield { type: 'error', message: formatError(err) };
    } finally {
      // Client abort (generator `return()`) or failure after tokens were spent: still on the ledger,
      // so the daily cap cannot be dodged by closing the tab.
      if (started && (answer.length > 0 || done)) await recordCost();
    }

    async function recordCost() {
      if (recorded) return;
      recorded = true;
      const usage = done?.usage ?? {
        inputTokens: estimateTokens(promptText),
        outputTokens: estimateTokens(answer),
      };
      const usedModel = done?.model ?? model;
      await db.insert(jobs).values({
        id: randomUUID(),
        type: SUBJECT_ASK_JOB_TYPE,
        subjectId: subjectRow.id,
        status: outcome,
        input: { question: request.question.slice(0, 200), documentCount: documentIds.length },
        cost: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          eur: estimateCostEur(usedModel, usage.inputTokens, usage.outputTokens),
        },
        progressPct: outcome === 'succeeded' ? 100 : 0,
        finishedAt: new Date(),
      });
    }
  }

  return { run };
}
