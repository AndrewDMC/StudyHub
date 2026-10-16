import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '@studyhub/db/testDb';
import { sessionItems, topics } from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import { endSession, startSession } from '../src/lib/sessions';

const state = vi.hoisted(() => ({ db: null as unknown, dataRoot: '' }));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));
vi.mock('@/lib/dataRoot', () => ({ getDataRoot: () => state.dataRoot }));

import { PATCH as patchMood } from '../src/app/api/subjects/[slug]/sessions/[sessionId]/mood/route';
import { POST as postEnd } from '../src/app/api/subjects/[slug]/sessions/[sessionId]/end/route';
import { POST as postFlashcards } from '../src/app/api/subjects/[slug]/sessions/[sessionId]/flashcards/route';

const req = (body?: string) =>
  new Request('http://localhost/x', { method: 'POST', ...(body !== undefined ? { body } : {}) });
const ctx = (slug: string, sessionId: string) => ({ params: Promise.resolve({ slug, sessionId }) });

describe('session routes: mood and per-item flashcards', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let slug: string;
  let sessionId: string;
  const itemIds: string[] = [];

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-session-routes-'));
    state.dataRoot = dataRoot;
    db = await createTestDb();
    state.db = db;
    const subject = await createSubject(db, dataRoot, { name: 'Analisi 2', color: 'violet' });
    slug = subject.slug;
    const topicId = randomUUID();
    await db
      .insert(topics)
      .values({ id: topicId, subjectId: subject.id, name: 'Serie', slug: 'serie' });
    sessionId = (await startSession(db, slug, { topicIds: [topicId] })).id;
    itemIds.length = 0;
    for (let i = 0; i < 3; i += 1) {
      const id = randomUUID();
      itemIds.push(id);
      await db.insert(sessionItems).values({
        id,
        sessionId,
        kind: 'key_point',
        orderIndex: i,
        title: `Punto ${i}`,
        body: 'Spiegazione',
        difficulty: null,
        citations: [],
        topicId,
        state: 'open',
      });
    }
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  const patch = (body: unknown, id = sessionId) =>
    patchMood(
      new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body) }),
      ctx(slug, id),
    );

  it('PATCH mood: 409 while active, 400 on bad body, 404 unknown, 200 once ended', async () => {
    expect((await patch({ mood: 'ok' })).status).toBe(409);
    await endSession(db, slug, sessionId);
    expect((await patch({ mood: 'tanto' })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ mood: 'ok' }, randomUUID())).status).toBe(404);

    const ok = await patch({ mood: 'hard' });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { session: { mood: string } }).session.mood).toBe('hard');
    const cleared = await patch({ mood: null });
    expect(((await cleared.json()) as { session: { mood: null } }).session.mood).toBeNull();
  });

  it('end accepts an optional mood and stays backwards compatible', async () => {
    const bad = await postEnd(req(JSON.stringify({ mood: 'boh' })), ctx(slug, sessionId));
    expect(bad.status).toBe(400);
    const res = await postEnd(req(JSON.stringify({ mood: 'good' })), ctx(slug, sessionId));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { session: { mood: string } }).session.mood).toBe('good');
  });

  it('flashcards: itemIds select the points; 400 for foreign ids or an invalid body', async () => {
    await endSession(db, slug, sessionId);
    const foreign = await postFlashcards(
      req(JSON.stringify({ itemIds: [randomUUID()] })),
      ctx(slug, sessionId),
    );
    expect(foreign.status).toBe(400);
    expect((await postFlashcards(req('{"itemIds":[]}'), ctx(slug, sessionId))).status).toBe(400);
    expect((await postFlashcards(req('non json'), ctx(slug, sessionId))).status).toBe(400);

    const res = await postFlashcards(
      req(JSON.stringify({ itemIds: itemIds.slice(0, 2) })),
      ctx(slug, sessionId),
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as { cardCount: number }).cardCount).toBe(2);
  });

  it('flashcards: no body or an empty body converts every key point', async () => {
    await endSession(db, slug, sessionId);
    const res = await postFlashcards(req(), ctx(slug, sessionId));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { cardCount: number }).cardCount).toBe(3);
    const again = await postFlashcards(req(''), ctx(slug, sessionId));
    expect(again.status).toBe(200);
  });
});
