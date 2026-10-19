import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '@studyhub/db/testDb';
import { artifacts, documents, flashcards, studyPlans, tasks, topics } from '@studyhub/db';
import { sql } from 'drizzle-orm';
import { createSubject, setSubjectArchived } from '../src/lib/subjects';
import { createDeck, listDeckSummaries, updateDeck } from '../src/lib/deckEditor';
import { DEFAULT_NEW_LIMIT } from '@studyhub/contracts';
import {
  getQuickReviewQueue,
  getReviewOverview,
  getReviewQueue,
  listFlashcards,
} from '../src/lib/review';
import { scopeFromSearchParams, scopeToSearchParams } from '../src/lib/quickReview';
import { listDeckGroups } from '../src/lib/flashcardGroups';
import { getFlashcardStats } from '../src/lib/stats';
import { NotFoundError } from '../src/lib/examPrep';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));

import { PATCH as patchArtifact } from '../src/app/api/subjects/[slug]/artifacts/[artifactId]/route';
import { GET as getDecks } from '../src/app/api/subjects/[slug]/decks/route';
import { GET as getCards } from '../src/app/api/subjects/[slug]/flashcards/route';
import { GET as getCard } from '../src/app/api/subjects/[slug]/flashcards/[cardId]/route';
import { GET as getQueue } from '../src/app/api/review/queue/route';
import { GET as getOverview } from '../src/app/api/review/overview/route';

const NOW = new Date('2026-03-10T10:00:00Z');
const DAY = 86_400_000;

type Db = Awaited<ReturnType<typeof createTestDb>>;

describe('flashcard tab redesign: contracts and services', () => {
  let dataRoot: string;
  let db: Db;
  let subjectId: string;
  let slug: string;
  let deckId: string;

  async function addDeck(
    status: 'draft' | 'approved' | 'archived',
    title = 'Deck',
    sid = subjectId,
  ) {
    const id = randomUUID();
    await db.insert(artifacts).values({
      id,
      subjectId: sid,
      kind: 'flashcard_deck',
      title,
      path: '/x',
      model: 'fake-v1',
      promptVersion: 'flashcards/v1',
      status,
    });
    return id;
  }

  async function addCard(over: Partial<typeof flashcards.$inferInsert> = {}, deck = deckId) {
    const id = randomUUID();
    await db.insert(flashcards).values({
      id,
      deckId: deck,
      type: 'basic',
      front: 'Q',
      back: 'A',
      ...over,
    });
    return id;
  }

  const seen = (daysFromNow: number): Partial<typeof flashcards.$inferInsert> => ({
    state: 'review',
    stability: 5,
    difficulty: 5,
    reps: 3,
    lapses: 1,
    dueAt: new Date(NOW.getTime() + daysFromNow * DAY),
    lastReviewAt: new Date(NOW.getTime() - 5 * DAY),
  });

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-fc-redesign-'));
    db = await createTestDb();
    state.db = db;
    const subject = await createSubject(db, dataRoot, { name: 'Fisica', color: 'blue' });
    subjectId = subject.id;
    slug = subject.slug;
    deckId = await addDeck('approved');
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  describe('review overview split', () => {
    it('splits due into started and new cards, new capped at 20', async () => {
      await addCard(seen(-1));
      await addCard(seen(-2));
      for (let i = 0; i < 25; i += 1) await addCard();
      const overview = await getReviewOverview(db, NOW);
      const s = overview.subjects.find((x) => x.slug === slug)!;
      expect(s.dueCount).toBe(2);
      expect(s.newCount).toBe(20);
      expect(s.due).toBe(s.dueCount + s.newCount);
    });
  });

  describe('archived decks', () => {
    it('keep their cards out of the queue and the overview', async () => {
      const archived = await addDeck('archived', 'Vecchio');
      await addCard({}, archived);
      await addCard(seen(-1), archived);
      expect(await getReviewQueue(db, slug, { now: NOW })).toHaveLength(0);
      const s = (await getReviewOverview(db, NOW)).subjects.find((x) => x.slug === slug)!;
      expect(s.due).toBe(0);
    });
  });

  describe('stats', () => {
    it('counts draft decks and cards, and excluded cards once', async () => {
      const draft = await addDeck('draft', 'Bozza');
      await addCard({}, draft);
      await addCard({}, draft);
      await addDeck('draft', 'Bozza vuota');
      await addCard({ suspended: true });
      await addCard({ suspended: true, flaggedAt: NOW });
      await addCard({ flaggedAt: NOW });
      await addCard();
      const stats = await getFlashcardStats(db, slug, NOW);
      expect(stats.draftDeckCount).toBe(2);
      expect(stats.draftCardCount).toBe(2);
      expect(stats.excludedCount).toBe(3);
      expect(stats.suspendedCount).toBe(1);
      expect(stats.flaggedCount).toBe(2);
    });
  });

  describe('listFlashcards', () => {
    it('filters excluded (suspended or flagged, approved decks only) and reports total', async () => {
      const draft = await addDeck('draft', 'Bozza');
      await addCard({ suspended: true }, draft);
      const archived = await addDeck('archived', 'Vecchio');
      await addCard({ flaggedAt: NOW }, archived);
      const suspended = await addCard({ suspended: true });
      const flagged = await addCard({ flaggedAt: NOW });
      const ok = await addCard();

      const ex = await listFlashcards(db, slug, { excluded: true });
      expect(ex.items.map((c) => c.id).sort()).toEqual([suspended, flagged].sort());
      expect(ex.total).toBe(2);

      const stats = await getFlashcardStats(db, slug, NOW);
      expect(stats.excludedCount).toBe(ex.total);

      const inc = await listFlashcards(db, slug, { excluded: false, deckId });
      expect(inc.items.map((c) => c.id)).toEqual([ok]);

      const all = await listFlashcards(db, slug, { limit: 2 });
      expect(all.items).toHaveLength(2);
      expect(all.total).toBe(5);
      expect(all.nextCursor).not.toBeNull();
    });

    it('sorts by due date with nulls last, paginating with a cursor', async () => {
      const later = await addCard(seen(5));
      const sooner = await addCard(seen(1));
      const fresh = await addCard();
      const suspended = await addCard({ ...seen(0), suspended: true });
      const soonest = await addCard(seen(-3));

      const first = await listFlashcards(db, slug, { sort: 'due', limit: 2 });
      expect(first.items.map((c) => c.id)).toEqual([soonest, sooner]);
      const second = await listFlashcards(db, slug, {
        sort: 'due',
        limit: 2,
        cursor: first.nextCursor!,
      });
      expect(second.items[0]!.id).toBe(later);
      const third = await listFlashcards(db, slug, {
        sort: 'due',
        limit: 2,
        cursor: second.nextCursor!,
      });
      expect(third.nextCursor).toBeNull();
      expect(new Set([second.items[1]!, ...third.items].map((c) => c.id))).toEqual(
        new Set([fresh, suspended]),
      );
      expect(third.total).toBe(5);
    });

    it('exposes reps, lapses and the source document name', async () => {
      const docId = randomUUID();
      await db.insert(documents).values({
        id: docId,
        subjectId,
        type: 'slides',
        originalName: 'Dispensa.pdf',
        storedPath: '/d',
        mime: 'application/pdf',
        bytes: 1,
        sha256: 'x',
      } as never);
      await addCard({ ...seen(1), sourceRef: { docId, page: 3, quote: 'q' } });
      await addCard({ sourceRef: { docId: randomUUID(), page: 1, quote: 'q' } });
      await addCard();
      const items = (await listFlashcards(db, slug)).items;
      const withDoc = items.find((c) => c.sourceRef?.docId === docId)!;
      expect(withDoc.reps).toBe(3);
      expect(withDoc.lapses).toBe(1);
      expect(withDoc.sourceRef!.docTitle).toBe('Dispensa.pdf');
      const orphan = items.find((c) => c.sourceRef && c.sourceRef.docId !== docId)!;
      expect(orphan.sourceRef!.docTitle).toBeNull();
      expect(items.find((c) => !c.sourceRef)!.reps).toBe(0);
    });
  });

  describe('deck groups: newBlockedCount', () => {
    it('counts new cards of the topic the plan keeps out today', async () => {
      const topicId = randomUUID();
      await db.insert(topics).values({ id: topicId, subjectId, name: 'Cinematica', slug: 't' });
      const planId = randomUUID();
      await db.insert(studyPlans).values({
        id: planId,
        subjectId,
        status: 'active',
        startDate: '2026-03-01',
        targetDate: '2026-04-01',
        availability: {} as never,
        prefs: {} as never,
        feasibility: {} as never,
        warnings: [],
        model: 'fake-v1',
        promptVersion: 'planner/v1',
      });
      await addCard({ topicId });
      await addCard({ topicId });
      await addCard({ topicId, suspended: true }); // not reviewable: not "blocked"
      await addCard({ topicId, ...seen(-1) }); // started: never blocked

      let g = (await listDeckGroups(db, slug, NOW)).find((x) => x.topicId === topicId)!;
      expect(g.newBlockedCount).toBe(2);
      expect(g.new).toBe(0);

      await db.insert(tasks).values({
        id: randomUUID(),
        subjectId,
        planId,
        taskKey: 'read:1',
        date: '2026-03-02',
        kind: 'read',
        topicId,
        minutes: 30,
        title: 'Lezione',
        description: '',
        payload: { action: 'read' },
        status: 'done',
      } as never);
      g = (await listDeckGroups(db, slug, NOW)).find((x) => x.topicId === topicId)!;
      expect(g.newBlockedCount).toBe(0);
      expect(g.new).toBe(2);
    });

    it('caps new at the daily limit per topic: new matches a session on that topic', async () => {
      const topicA = randomUUID();
      const topicB = randomUUID();
      await db.insert(topics).values([
        { id: topicA, subjectId, name: 'A', slug: 'a' },
        { id: topicB, subjectId, name: 'B', slug: 'b' },
      ]);
      for (let i = 0; i < 25; i += 1) await addCard({ topicId: topicA });
      for (let i = 0; i < 7; i += 1) await addCard({ topicId: topicB });
      const groups = await listDeckGroups(db, slug, NOW);
      expect(groups.find((g) => g.topicId === topicA)!.new).toBe(DEFAULT_NEW_LIMIT);
      for (const g of groups) {
        const queue = await getQuickReviewQueue(
          db,
          { subjectSlug: slug, topicId: g.topicId },
          { now: NOW },
        );
        expect(g.new).toBe(queue.filter((c) => c.state === 'new').length);
        expect(g.newBlockedCount).toBe(0);
      }
    });
  });

  describe('microsecond cursors', () => {
    it('pages through cards sharing created_at to the microsecond, with both sorts', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) ids.push(await addCard(i % 2 ? seen(i) : {}));
      // Real Postgres stores microseconds: four cards in one batch share the exact value, one
      // differs only below the millisecond.
      await db.execute(sql`update flashcards set created_at = '2026-01-01 10:00:00.123456+00'`);
      await db.execute(
        sql`update flashcards set created_at = '2026-01-01 10:00:00.123789+00' where id = ${ids[0]}`,
      );
      await db.execute(
        sql`update flashcards set due_at = '2026-03-01 10:00:00.000500+00' where state = 'review'`,
      );

      for (const sort of ['recent', 'due'] as const) {
        const seenIds: string[] = [];
        let cursor: string | undefined;
        for (let guard = 0; guard < 10; guard += 1) {
          const page = await listFlashcards(db, slug, {
            sort,
            limit: 2,
            ...(cursor ? { cursor } : {}),
          });
          seenIds.push(...page.items.map((c) => c.id));
          if (!page.nextCursor) break;
          cursor = page.nextCursor;
        }
        expect(seenIds).toHaveLength(5);
        expect(new Set(seenIds)).toEqual(new Set(ids));
      }
    });

    it('rejects a malformed cursor with 400', async () => {
      const res = await getCards(new Request('http://localhost/x?cursor=garbage'), {
        params: Promise.resolve({ slug }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('overview of a single (archived) subject', () => {
    it('includes an archived subject only when asked by slug', async () => {
      await addCard();
      await addCard(seen(-1));
      await setSubjectArchived(db, slug, true);
      expect(
        (await getReviewOverview(db, NOW)).subjects.find((x) => x.slug === slug),
      ).toBeUndefined();

      const one = await getReviewOverview(db, NOW, { subjectSlug: slug });
      expect(one.subjects.map((x) => x.slug)).toEqual([slug]);
      expect(one.subjects[0]).toMatchObject({ dueCount: 1, newCount: 1, due: 2 });

      const res = await getOverview(new Request(`http://localhost/x?materia=${slug}`));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { subjects: unknown[] }).subjects).toHaveLength(1);
      expect((await getOverview(new Request('http://localhost/x?materia=nope'))).status).toBe(404);
    });
  });

  describe('single card', () => {
    const get = (s: string, id: string) =>
      getCard(new Request('http://localhost/x'), {
        params: Promise.resolve({ slug: s, cardId: id }),
      });

    it('GET returns the card with docTitle, 404 for another subject or unknown id', async () => {
      const docId = randomUUID();
      await db.insert(documents).values({
        id: docId,
        subjectId,
        type: 'slides',
        originalName: 'Dispensa.pdf',
        storedPath: '/d',
        mime: 'application/pdf',
        bytes: 1,
        sha256: 'x',
      } as never);
      const id = await addCard({ ...seen(1), sourceRef: { docId, page: 2, quote: 'q' } });
      const res = await get(slug, id);
      expect(res.status).toBe(200);
      const { flashcard } = (await res.json()) as {
        flashcard: { id: string; reps: number; sourceRef: { docTitle: string } };
      };
      expect(flashcard).toMatchObject({ id, reps: 3, sourceRef: { docTitle: 'Dispensa.pdf' } });

      const other = await createSubject(db, dataRoot, { name: 'Chimica', color: 'teal' });
      expect((await get(other.slug, id)).status).toBe(404);
      expect((await get(slug, randomUUID())).status).toBe(404);
    });
  });

  describe('review queue by deck', () => {
    it('narrows the queue with scope.deckId, the mazzo query param and the deep link', async () => {
      const other = await addDeck('approved', 'Secondo');
      const a = await addCard();
      const b = await addCard({}, other);

      const onlyB = await getQuickReviewQueue(
        db,
        { subjectSlug: slug, deckId: other },
        { now: NOW },
      );
      expect(onlyB.map((c) => c.id)).toEqual([b]);
      const both = await getQuickReviewQueue(db, { subjectSlug: slug }, { now: NOW });
      expect(both.map((c) => c.id).sort()).toEqual([a, b].sort());

      const res = await getQueue(new Request(`http://localhost/x?materia=${slug}&mazzo=${other}`));
      expect(res.status).toBe(200);
      const { queue } = (await res.json()) as { queue: { id: string }[] };
      expect(queue.map((c) => c.id)).toEqual([b]);
      expect((await getQueue(new Request('http://localhost/x?mazzo=nope'))).status).toBe(400);

      const scope = scopeFromSearchParams({ materia: slug, mazzo: other });
      expect(scope).toEqual({ subjectSlug: slug, deckId: other });
      expect(scopeToSearchParams(scope!, 10).get('mazzo')).toBe(other);
    });
  });

  describe('deck summaries', () => {
    it('lists every deck with counts and origin', async () => {
      const topicA = randomUUID();
      const topicB = randomUUID();
      await db.insert(topics).values([
        { id: topicA, subjectId, name: 'A', slug: 'a' },
        { id: topicB, subjectId, name: 'B', slug: 'b' },
      ]);
      await addCard({ topicId: topicA });
      await addCard({ topicId: topicB, ...seen(-1) });
      await addCard({ topicId: topicB, suspended: true });
      const draft = await addDeck('draft', 'Bozza');
      await addCard({}, draft);
      const manual = await createDeck(db, slug, 'A mano');
      // Another subject's deck must not show up.
      const other = await createSubject(db, dataRoot, { name: 'Chimica', color: 'teal' });
      await addDeck('approved', 'Altro', other.id);

      const list = await listDeckSummaries(db, slug, NOW);
      expect(list).toHaveLength(3);
      const main = list.find((d) => d.id === deckId)!;
      expect(main).toMatchObject({
        status: 'approved',
        cardCount: 3,
        topicCount: 2,
        dueCount: 1,
        newCount: 1,
        generatedBy: 'ai',
      });
      expect(list.find((d) => d.id === draft)).toMatchObject({
        status: 'draft',
        cardCount: 1,
        dueCount: 0,
        newCount: 0,
      });
      expect(list.find((d) => d.id === manual.id)).toMatchObject({
        cardCount: 0,
        generatedBy: 'manual',
      });
    });

    it('GET /decks answers with the list, 404 on an unknown subject', async () => {
      const res = await getDecks(new Request('http://localhost/x'), {
        params: Promise.resolve({ slug }),
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { decks: unknown[] }).decks).toHaveLength(1);
      const missing = await getDecks(new Request('http://localhost/x'), {
        params: Promise.resolve({ slug: 'nope' }),
      });
      expect(missing.status).toBe(404);
    });
  });

  describe('updateDeck and PATCH route', () => {
    const patch = (s: string, id: string, body: unknown) =>
      patchArtifact(
        new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body) }),
        { params: Promise.resolve({ slug: s, artifactId: id }) },
      );

    it('renames, archives and restores a deck; archived cards leave the queue', async () => {
      await addCard();
      expect(await getReviewQueue(db, slug, { now: NOW })).toHaveLength(1);

      const renamed = await updateDeck(db, slug, deckId, { title: '  Nuovo  ' });
      expect(renamed.title).toBe('Nuovo');
      expect(renamed.status).toBe('approved');

      const archived = await updateDeck(db, slug, deckId, { status: 'archived' });
      expect(archived.status).toBe('archived');
      expect(await getReviewQueue(db, slug, { now: NOW })).toHaveLength(0);

      const restored = await updateDeck(db, slug, deckId, { status: 'approved' });
      expect(restored.status).toBe('approved');
      expect(await getReviewQueue(db, slug, { now: NOW })).toHaveLength(1);
    });

    it('answers 200 with the artifact', async () => {
      const res = await patch(slug, deckId, { title: 'Meccanica', status: 'archived' });
      expect(res.status).toBe(200);
      const { artifact } = (await res.json()) as { artifact: { title: string; status: string } };
      expect(artifact).toMatchObject({ title: 'Meccanica', status: 'archived' });
    });

    it('answers 404 for a deck of another subject, a missing one, or another kind', async () => {
      const other = await createSubject(db, dataRoot, { name: 'Chimica', color: 'teal' });
      const foreign = await addDeck('approved', 'Altro', other.id);
      expect((await patch(slug, foreign, { title: 'x' })).status).toBe(404);
      expect((await patch(slug, randomUUID(), { title: 'x' })).status).toBe(404);

      const summary = randomUUID();
      await db.insert(artifacts).values({
        id: summary,
        subjectId,
        kind: 'summary',
        title: 'Riassunto',
        path: '/s',
        model: 'fake-v1',
        promptVersion: 's/v1',
        status: 'approved',
      });
      expect((await patch(slug, summary, { title: 'x' })).status).toBe(404);
      await expect(updateDeck(db, slug, summary, { title: 'x' })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect((await patch('nope', deckId, { title: 'x' })).status).toBe(404);
    });

    it('answers 400 on an invalid body', async () => {
      expect((await patch(slug, deckId, {})).status).toBe(400);
      expect((await patch(slug, deckId, { title: '' })).status).toBe(400);
      expect((await patch(slug, deckId, { title: 'x'.repeat(121) })).status).toBe(400);
      expect((await patch(slug, deckId, { status: 'draft' })).status).toBe(400);
      const bad = await patchArtifact(
        new Request('http://localhost/x', { method: 'PATCH', body: 'not json' }),
        { params: Promise.resolve({ slug, artifactId: deckId }) },
      );
      expect(bad.status).toBe(400);
    });
  });

  describe('GET /flashcards query params', () => {
    it('parses excluded and sort, rejects an unknown sort', async () => {
      await addCard({ suspended: true });
      await addCard();
      const get = (qs: string) =>
        getCards(new Request(`http://localhost/x?${qs}`), { params: Promise.resolve({ slug }) });
      const ok = await get('excluded=true&sort=due');
      expect(ok.status).toBe(200);
      const { page } = (await ok.json()) as { page: { items: unknown[]; total: number } };
      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(1);
      expect((await get('sort=bogus')).status).toBe(400);
    });
  });
});
