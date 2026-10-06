import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  documents,
  jobs,
  sessionMessages,
  studySessions,
  subjects,
  tasks,
  topics,
  type SessionCitation,
  type SessionMessage,
  type StudySession,
} from '@studyhub/db';
import {
  estimateCostEur,
  type AiProvider,
  type SessionChatSource,
  truncate,
  resolveModel,
} from '@studyhub/ai';
import {
  parseAnswerCitations,
  renderSessionTranscript,
  resolveSubjectSubpath,
  transcriptFileName,
  windowMessages,
} from '@studyhub/core';
import type {
  SendSessionMessageRequest,
  SessionChatDto,
  SessionChatEvent,
  SessionMessageDto,
} from '@studyhub/contracts';
import { SubjectNotFoundError, formatError } from './errors';
import { ConflictError, NotFoundError } from './examPrep';
import { chunksAtPage, retrieveChunks, type RetrievedChunk } from './search';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/** The fast tier of `ModelPicker`: a tutor chat is many short turns, so cost matters more than depth. */
export const CHAT_DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
/** Top-k of the session retrieval (docs/08 §5.3). */
const SOURCE_LIMIT = 8;
/** Per-source cap: pages can be long and every source is paid for on every turn. */
const SOURCE_MAX_CHARS = 1800;
const FOCUS_QUERY_CHARS = 300;

async function requireSession(db: AnyDb, slug: string, sessionId: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, slug));
  if (!subject) throw new SubjectNotFoundError(slug);
  const [session] = await db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.id, sessionId), eq(studySessions.subjectId, subject.id)));
  if (!session) throw new NotFoundError('Sessione');
  return { subject: subject as typeof subjects.$inferSelect, session: session as StudySession };
}

function toMessageDto(row: SessionMessage): SessionMessageDto {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    focus: row.focus ? { ...row.focus, page: row.focus.page ?? null } : null,
    citations: row.citations,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
  };
}

function messagesCostEur(rows: SessionMessage[]): number {
  const total = rows.reduce(
    (sum, m) =>
      m.role === 'assistant' && m.model
        ? sum + estimateCostEur(m.model, m.inputTokens ?? 0, m.outputTokens ?? 0)
        : sum,
    0,
  );
  return Math.round(total * 1_000_000) / 1_000_000;
}

async function loadMessages(db: AnyDb, sessionId: string): Promise<SessionMessage[]> {
  return db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, sessionId))
    .orderBy(asc(sessionMessages.createdAt), asc(sessionMessages.id));
}

/** The conversation so far and what it has cost. Readable after the session ended (read-only). */
export async function getSessionChat(
  db: AnyDb,
  slug: string,
  sessionId: string,
): Promise<SessionChatDto> {
  const { session } = await requireSession(db, slug, sessionId);
  const rows = await loadMessages(db, session.id);
  return { messages: rows.map(toMessageDto), costEur: messagesCostEur(rows) };
}

export interface ChatTurn {
  /** The question, already saved: the route sends it back first so the UI can show it. */
  userMessage: SessionMessageDto;
  /** Retrieval + model call + persistence. Yields `delta`s, then `done` (or `error`). */
  run(): AsyncGenerator<SessionChatEvent>;
}

/**
 * One question to the tutor (docs/08-sessione-di-studio.md §5.3). Everything that can be refused with a
 * proper HTTP status (unknown session, ended session, a passage from a document outside the session)
 * throws here, *before* the stream starts; what happens during the stream is reported as events.
 */
export async function startChatTurn(
  db: AnyDb,
  slug: string,
  sessionId: string,
  request: SendSessionMessageRequest,
  provider: AiProvider,
): Promise<ChatTurn> {
  const { subject, session } = await requireSession(db, slug, sessionId);
  if (session.status === 'ended')
    throw new ConflictError('La sessione è terminata: la chat è in sola lettura.');
  if (request.focus && !session.documentIds.includes(request.focus.docId)) {
    throw new NotFoundError('Documento della sessione');
  }

  const history = windowMessages(await loadMessages(db, session.id));
  const [saved] = await db
    .insert(sessionMessages)
    .values({
      id: randomUUID(),
      sessionId: session.id,
      role: 'user',
      content: request.content,
      focus: request.focus ?? null,
      citations: [],
    })
    .returning();
  const model = request.model ?? resolveModel(CHAT_DEFAULT_MODEL);

  async function* run(): AsyncGenerator<SessionChatEvent> {
    try {
      const focusDoc = request.focus
        ? ((
            await db
              .select({ name: documents.originalName })
              .from(documents)
              .where(eq(documents.id, request.focus.docId))
          )[0] as { name: string } | undefined)
        : undefined;

      const found = await gatherSources(db, subject.id, session.documentIds, request);
      const sources: (SessionChatSource & { chunkId: string })[] = found.map((c, i) => ({
        ref: i + 1,
        chunkId: c.chunkId,
        docId: c.documentId,
        documentName: c.documentName,
        page: c.pageFrom,
        text: truncate(c.text, SOURCE_MAX_CHARS),
      }));

      const topicRows: { name: string }[] = session.topicIds.length
        ? await db
            .select({ name: topics.name })
            .from(topics)
            .where(inArray(topics.id, session.topicIds))
        : [];

      let answer = '';
      let done: { usage: { inputTokens: number; outputTokens: number }; model: string } | null =
        null;
      for await (const delta of provider.chatStream(
        {
          subjectName: subject.name,
          topicNames: topicRows.map((t) => t.name),
          sources,
          history: history.map((m) => ({ role: m.role, content: m.content })),
          focus: request.focus
            ? {
                documentName: focusDoc?.name ?? 'documento',
                page: request.focus.page ?? null,
                text: request.focus.text,
              }
            : undefined,
          question: request.content,
        },
        model,
      )) {
        if (delta.type === 'text') {
          answer += delta.text;
          yield { type: 'delta', text: delta.text };
        } else {
          done = { usage: delta.usage, model: delta.model };
        }
      }
      if (!answer.trim()) throw new Error('Il modello non ha restituito nessuna risposta.');

      // A marker to a source that was never provided is dropped, never turned into a fake citation.
      const parsed = parseAnswerCitations(answer, sources);
      const citations: SessionCitation[] = parsed.cited.map((s) => ({
        ref: s.ref,
        chunkId: s.chunkId,
        docId: s.docId,
        documentName: s.documentName,
        page: s.page,
      }));
      const usage = done?.usage ?? { inputTokens: 0, outputTokens: 0 };
      const usedModel = done?.model ?? model;

      const [assistant] = await db
        .insert(sessionMessages)
        .values({
          id: randomUUID(),
          sessionId: session.id,
          role: 'assistant',
          content: parsed.text,
          citations,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          model: usedModel,
        })
        .returning();

      // Same ledger as every other AI call, so the turn shows up in /admin and the monthly cost.
      await db.insert(jobs).values({
        id: randomUUID(),
        type: 'session_chat',
        subjectId: subject.id,
        status: 'succeeded',
        input: { sessionId: session.id, messageId: assistant.id },
        cost: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          eur: estimateCostEur(usedModel, usage.inputTokens, usage.outputTokens),
        },
        progressPct: 100,
        finishedAt: new Date(),
      });

      yield {
        type: 'done',
        message: toMessageDto(assistant),
        costEur: messagesCostEur(await loadMessages(db, session.id)),
      };
    } catch (err) {
      yield { type: 'error', message: formatError(err) };
    }
  }

  return { userMessage: toMessageDto(saved), run };
}

/**
 * The material the answer may draw on: hybrid retrieval limited to the session's documents, plus — when
 * the student selected a passage — the chunk(s) at that page, which always go in (docs/08 §5.3 step 2).
 */
async function gatherSources(
  db: AnyDb,
  subjectId: string,
  documentIds: string[],
  request: SendSessionMessageRequest,
): Promise<RetrievedChunk[]> {
  const focus = request.focus;
  const query = focus
    ? `${request.content} ${focus.text.slice(0, FOCUS_QUERY_CHARS)}`
    : request.content;

  const found = new Map<string, RetrievedChunk>();
  if (focus?.page) {
    for (const chunk of await chunksAtPage(db, focus.docId, focus.page)) {
      found.set(chunk.chunkId, chunk);
    }
  }
  for (const chunk of await retrieveChunks(db, subjectId, query, {
    documentIds,
    limit: SOURCE_LIMIT,
  })) {
    if (found.size >= SOURCE_LIMIT) break;
    if (!found.has(chunk.chunkId)) found.set(chunk.chunkId, chunk);
  }
  return [...found.values()];
}

const TRANSCRIPT_DIR = 'sessioni';

/**
 * Writes the chat of a just-ended session as a Markdown note in `<materia>/sessioni/` (docs/08 decision 2)
 * and records its path on the session. Returns the path relative to the subject folder.
 */
export async function writeSessionTranscript(
  db: AnyDb,
  dataRoot: string,
  slug: string,
  session: StudySession,
): Promise<string> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, slug));
  if (!subject) throw new SubjectNotFoundError(slug);

  const [task] = session.taskId
    ? await db.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, session.taskId))
    : [];
  const topicRows: { name: string }[] = session.topicIds.length
    ? await db
        .select({ name: topics.name })
        .from(topics)
        .where(inArray(topics.id, session.topicIds))
    : [];
  const topicNames = topicRows.map((t) => t.name);
  const title = (task?.title as string | undefined) ?? (topicNames.join(', ') || 'Studio libero');

  const rows = await loadMessages(db, session.id);
  const focusDocIds = [...new Set(rows.flatMap((m) => (m.focus ? [m.focus.docId] : [])))];
  const focusDocs: { id: string; name: string }[] = focusDocIds.length
    ? await db
        .select({ id: documents.id, name: documents.originalName })
        .from(documents)
        .where(inArray(documents.id, focusDocIds))
    : [];
  const docName = new Map(focusDocs.map((d) => [d.id, d.name]));

  const endedAt = session.endedAt ?? new Date();
  const markdown = renderSessionTranscript({
    title,
    subjectName: subject.name,
    topicNames,
    startedAt: session.startedAt,
    endedAt,
    activeMs: session.activeMs,
    pomodoros: session.pomodoros,
    messages: rows.map((m) => ({
      role: m.role,
      content: m.content,
      focus: m.focus
        ? {
            documentName: docName.get(m.focus.docId) ?? 'documento',
            page: m.focus.page,
            text: m.focus.text,
          }
        : null,
      citations: m.citations,
      createdAt: m.createdAt,
    })),
  });

  const fileName = transcriptFileName(title, session.startedAt, session.id);
  const dir = resolveSubjectSubpath(slug, [TRANSCRIPT_DIR], dataRoot);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    resolveSubjectSubpath(slug, [TRANSCRIPT_DIR, fileName], dataRoot),
    markdown,
    'utf-8',
  );

  const relative = `${TRANSCRIPT_DIR}/${fileName}`;
  await db
    .update(studySessions)
    .set({ transcriptPath: relative })
    .where(eq(studySessions.id, session.id));
  return relative;
}

/** The transcript file of an ended session, or null when it has none (no chat, or never written). */
export async function readSessionTranscript(
  db: AnyDb,
  dataRoot: string,
  slug: string,
  sessionId: string,
): Promise<string | null> {
  const { session } = await requireSession(db, slug, sessionId);
  if (!session.transcriptPath) return null;
  try {
    return await fs.readFile(
      resolveSubjectSubpath(slug, session.transcriptPath.split('/'), dataRoot),
      'utf-8',
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
