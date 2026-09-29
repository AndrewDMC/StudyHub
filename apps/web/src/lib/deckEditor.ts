import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  artifacts,
  flashcards,
  recomputeTopicMastery,
  subjects,
  topics,
  type Flashcard,
} from '@studyhub/db';
import type {
  ArtifactDto,
  BulkFlashcardsRequest,
  CreateFlashcardRequest,
  FlashcardDto,
  UpdateFlashcardRequest,
} from '@studyhub/contracts';
import { SubjectNotFoundError } from './errors';
import { ConflictError, NotFoundError } from './examPrep';
import { toArtifactDto } from './generation';
import { toDto } from './review';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

async function requireSubject(db: AnyDb, subjectSlug: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);
  return subject;
}

/** A deck of this subject (any status) — the editor works on drafts and approved decks alike. */
async function requireDeck(db: AnyDb, subjectId: string, deckId: string) {
  const [deck] = await db
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.id, deckId),
        eq(artifacts.subjectId, subjectId),
        eq(artifacts.kind, 'flashcard_deck'),
      ),
    );
  if (!deck) throw new NotFoundError(`Mazzo non trovato: ${deckId}`);
  return deck as typeof artifacts.$inferSelect;
}

async function requireTopic(db: AnyDb, subjectId: string, topicId: string) {
  const [topic] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.subjectId, subjectId)));
  if (!topic) throw new NotFoundError(`Argomento non trovato: ${topicId}`);
}

/** Cards of this subject among `ids` — anything else is silently not this subject's business. */
async function subjectCards(db: AnyDb, subjectId: string, ids: string[]): Promise<Flashcard[]> {
  const joined: { f: Flashcard }[] = await db
    .select({ f: flashcards })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(and(inArray(flashcards.id, ids), eq(artifacts.subjectId, subjectId)));
  return joined.map((r) => r.f);
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/** Recompute mastery for every topic a set of cards touched (before and after a move/delete). */
async function recomputeTopics(db: AnyDb, topicIds: (string | null)[]) {
  for (const id of new Set(topicIds.filter((t): t is string => !!t))) {
    await recomputeTopicMastery(db, id);
  }
}

/**
 * A subject's hand-made deck ("Mazzo manuale"): created lazily on first use, so cards made in
 * the editor have somewhere to live without forcing the user to run a generation first.
 * Approved from the start — there is no draft review for cards the user wrote themselves.
 */
export async function createDeck(
  db: AnyDb,
  subjectSlug: string,
  title: string,
): Promise<ArtifactDto> {
  const subject = await requireSubject(db, subjectSlug);
  const [row] = await db
    .insert(artifacts)
    .values({
      id: randomUUID(),
      subjectId: subject.id,
      kind: 'flashcard_deck',
      title: title.trim(),
      path: '',
      status: 'approved',
      model: 'manual',
      promptVersion: 'manual',
      approvedAt: new Date(),
    })
    .returning();
  return toArtifactDto(row);
}

export async function createFlashcard(
  db: AnyDb,
  subjectSlug: string,
  input: CreateFlashcardRequest,
): Promise<FlashcardDto> {
  const subject = await requireSubject(db, subjectSlug);
  await requireDeck(db, subject.id, input.deckId);
  if (input.topicId) await requireTopic(db, subject.id, input.topicId);

  const [row] = await db
    .insert(flashcards)
    .values({
      id: randomUUID(),
      deckId: input.deckId,
      topicId: input.topicId ?? null,
      type: input.type,
      front: input.front,
      back: input.back,
      hint: input.hint ?? null,
      sourceRef: null,
      tags: normalizeTags(input.tags ?? []),
    })
    .returning();
  return toDto(row);
}

/**
 * Edits any of front/back/type/hint/topic/deck/tags/suspended/flagged on one card (the review
 * session's `E`, the deck editor's inline edit, "segnala card scadente"). Scheduling state is
 * never touched: fixing a typo must not reset the card's memory.
 */
export async function updateFlashcard(
  db: AnyDb,
  subjectSlug: string,
  cardId: string,
  input: UpdateFlashcardRequest,
): Promise<FlashcardDto> {
  const subject = await requireSubject(db, subjectSlug);
  const [card] = await subjectCards(db, subject.id, [cardId]);
  if (!card) throw new NotFoundError(`Flashcard non trovata: ${cardId}`);

  const patch: Partial<typeof flashcards.$inferInsert> = {};
  if (input.type !== undefined) patch.type = input.type;
  if (input.front !== undefined) patch.front = input.front;
  if (input.back !== undefined) patch.back = input.back;
  if (input.hint !== undefined) patch.hint = input.hint;
  if (input.suspended !== undefined) patch.suspended = input.suspended;
  if (input.tags !== undefined) patch.tags = normalizeTags(input.tags);
  if (input.flagged !== undefined) patch.flaggedAt = input.flagged ? new Date() : null;
  if (input.topicId !== undefined) {
    if (input.topicId) await requireTopic(db, subject.id, input.topicId);
    patch.topicId = input.topicId;
  }
  if (input.deckId !== undefined) {
    await requireDeck(db, subject.id, input.deckId);
    patch.deckId = input.deckId;
  }
  // The embedding was computed from the old `front`; a stale one would make the semantic dedup
  // compare against text the card no longer has.
  if (input.front !== undefined && input.front !== card.front) patch.embedding = null;

  const [row] = await db.update(flashcards).set(patch).where(eq(flashcards.id, cardId)).returning();
  if (input.topicId !== undefined) await recomputeTopics(db, [card.topicId, row.topicId]);
  return toDto(row);
}

export async function deleteFlashcard(
  db: AnyDb,
  subjectSlug: string,
  cardId: string,
): Promise<void> {
  const subject = await requireSubject(db, subjectSlug);
  const [card] = await subjectCards(db, subject.id, [cardId]);
  if (!card) throw new NotFoundError(`Flashcard non trovata: ${cardId}`);
  await db.delete(flashcards).where(eq(flashcards.id, cardId));
  await recomputeTopics(db, [card.topicId]);
}

/** One action applied to many cards at once; returns how many were actually affected. */
export async function bulkFlashcards(
  db: AnyDb,
  subjectSlug: string,
  request: BulkFlashcardsRequest,
): Promise<{ affected: number }> {
  const subject = await requireSubject(db, subjectSlug);
  const cards = await subjectCards(db, subject.id, request.ids);
  if (cards.length === 0) return { affected: 0 };
  const ids = cards.map((c) => c.id);
  const { action } = request;

  switch (action.type) {
    case 'delete':
      await db.delete(flashcards).where(inArray(flashcards.id, ids));
      await recomputeTopics(
        db,
        cards.map((c) => c.topicId),
      );
      break;
    case 'suspend':
      await db
        .update(flashcards)
        .set({ suspended: action.suspended })
        .where(inArray(flashcards.id, ids));
      break;
    case 'move':
      await requireDeck(db, subject.id, action.deckId);
      await db.update(flashcards).set({ deckId: action.deckId }).where(inArray(flashcards.id, ids));
      break;
    case 'topic':
      if (action.topicId) await requireTopic(db, subject.id, action.topicId);
      await db
        .update(flashcards)
        .set({ topicId: action.topicId })
        .where(inArray(flashcards.id, ids));
      await recomputeTopics(db, [...cards.map((c) => c.topicId), action.topicId]);
      break;
    case 'addTag': {
      const tag = action.tag.trim().toLowerCase();
      await db
        .update(flashcards)
        .set({ tags: sql`array_append(array_remove(${flashcards.tags}, ${tag}), ${tag})` })
        .where(inArray(flashcards.id, ids));
      break;
    }
    case 'removeTag': {
      const tag = action.tag.trim().toLowerCase();
      await db
        .update(flashcards)
        .set({ tags: sql`array_remove(${flashcards.tags}, ${tag})` })
        .where(inArray(flashcards.id, ids));
      break;
    }
  }
  return { affected: ids.length };
}

/**
 * Merges `sourceDeckId` into `targetDeckId`: every card moves (scheduling state intact) and the
 * emptied source deck is removed. Refuses when the source deck is still a draft — merging would
 * silently approve cards the user never reviewed.
 */
export async function mergeDecks(
  db: AnyDb,
  subjectSlug: string,
  sourceDeckId: string,
  targetDeckId: string,
): Promise<{ moved: number }> {
  const subject = await requireSubject(db, subjectSlug);
  const source = await requireDeck(db, subject.id, sourceDeckId);
  const target = await requireDeck(db, subject.id, targetDeckId);
  if (source.status === 'draft' || target.status === 'draft') {
    throw new ConflictError('Approva il mazzo in bozza prima di unirlo a un altro');
  }

  const moved: { id: string }[] = await db
    .update(flashcards)
    .set({ deckId: targetDeckId })
    .where(eq(flashcards.deckId, sourceDeckId))
    .returning({ id: flashcards.id });
  await db.delete(artifacts).where(eq(artifacts.id, sourceDeckId));
  return { moved: moved.length };
}

/** Every distinct tag in the subject with its card count, most used first. */
export async function listTags(
  db: AnyDb,
  subjectSlug: string,
): Promise<{ tag: string; count: number }[]> {
  const subject = await requireSubject(db, subjectSlug);
  const rows: { tag: string; count: number }[] = await db.execute(sql`
    SELECT t.tag AS tag, count(*)::int AS count
    FROM ${flashcards} f
    JOIN ${artifacts} a ON a.id = f.deck_id
    CROSS JOIN LATERAL unnest(f.tags) AS t(tag)
    WHERE a.subject_id = ${subject.id}
    GROUP BY t.tag
    ORDER BY count DESC, t.tag ASC
  `);
  // node-postgres returns `{ rows }`, pglite returns `{ rows }` too; normalise both.
  const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown }).rows ?? []);
  return list as { tag: string; count: number }[];
}
