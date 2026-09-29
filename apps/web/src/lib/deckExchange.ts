import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { artifacts, flashcards, subjects, type Flashcard } from '@studyhub/db';
import { newCardSchedule, parseCsv, type FlashcardSchedule } from '@studyhub/core';
import type { ArtifactDto } from '@studyhub/contracts';
import { ApkgError, buildApkg, parseApkg, type AnkiCardType, type AnkiImportedCard } from './anki';
import { SubjectNotFoundError } from './errors';
import { NotFoundError } from './examPrep';
import { toArtifactDto } from './generation';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/** More rows than this in one file is not a deck someone made by hand — refuse rather than stall. */
export const MAX_IMPORT_CARDS = 10_000;

export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFileError';
  }
}

async function requireSubject(db: AnyDb, subjectSlug: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);
  return subject;
}

const slugify = (title: string) => title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'mazzo';

function toSchedule(row: Flashcard): FlashcardSchedule {
  return {
    stability: row.stability,
    difficulty: row.difficulty,
    dueAt: row.dueAt,
    lastReviewAt: row.lastReviewAt,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
  };
}

/**
 * Anki `.apkg` export of one deck (docs/fasi/F4-flashcard.md "Export/import Anki .apkg
 * (bidirezionale)"). Carries each card's exact FSRS state, see `anki.ts`.
 */
export async function exportDeckApkg(
  db: AnyDb,
  subjectSlug: string,
  deckId: string,
): Promise<{ filename: string; bytes: Uint8Array }> {
  const subject = await requireSubject(db, subjectSlug);
  const [deck] = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.id, deckId), eq(artifacts.subjectId, subject.id)));
  if (!deck || deck.kind !== 'flashcard_deck')
    throw new NotFoundError(`Mazzo non trovato: ${deckId}`);

  const rows: Flashcard[] = await db
    .select()
    .from(flashcards)
    .where(eq(flashcards.deckId, deckId))
    .orderBy(flashcards.createdAt, flashcards.id);

  const bytes = await buildApkg(
    rows.map((r) => ({
      id: r.id,
      type: r.type,
      front: r.front,
      back: r.back,
      hint: r.hint,
      tags: r.tags,
      schedule: toSchedule(r),
      suspended: r.suspended,
      createdAt: r.createdAt,
    })),
    { deckName: deck.title },
  );
  return { filename: `${slugify(deck.title)}.apkg`, bytes };
}

const CARD_TYPES: AnkiCardType[] = ['basic', 'cloze', 'qa', 'formula'];

/**
 * CSV import. Columns: `front`, `back` and optionally `type`, `hint`, `tags` (comma-separated).
 * With a header row the columns are matched by name in any order; without one the first two
 * columns are front/back (what Anki's plain-text export writes), a third is read as tags.
 */
export function parseCardsCsv(text: string): AnkiImportedCard[] {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new ImportFileError('Il file CSV è vuoto');

  const header = rows[0]!.map((c) => c.trim().toLowerCase());
  const hasHeader = header.includes('front') && header.includes('back');
  const col = (name: string, fallback: number) => (hasHeader ? header.indexOf(name) : fallback);
  const idx = {
    front: col('front', 0),
    back: col('back', 1),
    type: col('type', -1),
    hint: col('hint', -1),
    tags: col('tags', hasHeader ? -1 : 2),
  };
  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');

  const cards: AnkiImportedCard[] = [];
  for (const row of hasHeader ? rows.slice(1) : rows) {
    const front = cell(row, idx.front);
    const back = cell(row, idx.back);
    if (!front || !back) continue;
    const rawType = cell(row, idx.type) as AnkiCardType;
    cards.push({
      type: CARD_TYPES.includes(rawType) ? rawType : 'basic',
      front,
      back,
      hint: cell(row, idx.hint) || null,
      tags: cell(row, idx.tags)
        .split(/[,;]/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
      schedule: newCardSchedule(),
      suspended: false,
    });
  }
  if (cards.length === 0) {
    throw new ImportFileError('Nessuna riga con fronte e retro trovata nel CSV');
  }
  return cards;
}

export interface ImportDeckResult {
  deck: ArtifactDto;
  imported: number;
  duplicates: number;
  warnings: string[];
}

/**
 * Imports a `.csv` or `.apkg` into the subject: into `deckId` when given, otherwise into a new
 * approved deck (named `title`, else the Anki deck name, else the file name). Cards whose
 * front+back already exist anywhere in the subject are skipped, so re-importing the same file
 * is harmless. Cards start `approved`-equivalent: the user brought them, there is no draft.
 */
export async function importDeckFile(
  db: AnyDb,
  subjectSlug: string,
  file: { filename: string; bytes: Uint8Array },
  options: { deckId?: string | undefined; title?: string | undefined } = {},
): Promise<ImportDeckResult> {
  const subject = await requireSubject(db, subjectSlug);
  const lower = file.filename.toLowerCase();

  let parsed: { cards: AnkiImportedCard[]; deckName: string | null; warnings: string[] };
  if (lower.endsWith('.apkg')) {
    try {
      parsed = await parseApkg(file.bytes);
    } catch (err) {
      if (err instanceof ApkgError) throw new ImportFileError(err.message);
      throw err;
    }
  } else if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
    parsed = {
      cards: parseCardsCsv(new TextDecoder('utf-8').decode(file.bytes)),
      deckName: null,
      warnings: [],
    };
  } else {
    throw new ImportFileError('Formato non supportato: usa un file .apkg o .csv');
  }
  if (parsed.cards.length === 0) throw new ImportFileError('Il file non contiene card importabili');
  if (parsed.cards.length > MAX_IMPORT_CARDS) {
    throw new ImportFileError(`Troppe card in un solo file (massimo ${MAX_IMPORT_CARDS})`);
  }

  // Existing front+back pairs in the subject → duplicates.
  const existing: { front: string; back: string }[] = await db
    .select({ front: flashcards.front, back: flashcards.back })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(eq(artifacts.subjectId, subject.id));
  const seen = new Set(existing.map((c) => `${c.front}\u0000${c.back}`));

  const fresh: AnkiImportedCard[] = [];
  let duplicates = 0;
  for (const card of parsed.cards) {
    const key = `${card.front}\u0000${card.back}`;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    fresh.push(card);
  }

  let deckRow: typeof artifacts.$inferSelect;
  if (options.deckId) {
    const [found] = await db
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.id, options.deckId),
          eq(artifacts.subjectId, subject.id),
          eq(artifacts.kind, 'flashcard_deck'),
        ),
      );
    if (!found) throw new NotFoundError(`Mazzo non trovato: ${options.deckId}`);
    deckRow = found;
  } else {
    const title =
      options.title?.trim() ||
      parsed.deckName ||
      file.filename.replace(/\.[^.]+$/, '') ||
      'Mazzo importato';
    const [created] = await db
      .insert(artifacts)
      .values({
        id: randomUUID(),
        subjectId: subject.id,
        kind: 'flashcard_deck',
        title,
        path: '',
        status: 'approved',
        model: 'import',
        promptVersion: 'import',
        approvedAt: new Date(),
      })
      .returning();
    deckRow = created;
  }

  // Chunked: one INSERT with thousands of rows would exceed Postgres' parameter limit (65535).
  for (let i = 0; i < fresh.length; i += 500) {
    await db.insert(flashcards).values(
      fresh.slice(i, i + 500).map((c) => ({
        id: randomUUID(),
        deckId: deckRow.id,
        type: c.type,
        front: c.front,
        back: c.back,
        hint: c.hint,
        sourceRef: null,
        tags: c.tags,
        suspended: c.suspended,
        stability: c.schedule.stability,
        difficulty: c.schedule.difficulty,
        dueAt: c.schedule.dueAt,
        lastReviewAt: c.schedule.lastReviewAt,
        reps: c.schedule.reps,
        lapses: c.schedule.lapses,
        state: c.schedule.state,
      })),
    );
  }

  const deck = toArtifactDto(deckRow);
  return { deck, imported: fresh.length, duplicates, warnings: parsed.warnings };
}
