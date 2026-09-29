import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import type { DatabaseSync } from 'node:sqlite';
import { newCardSchedule, type FlashcardSchedule, type FsrsCardState } from '@studyhub/core';
import { displayMathRe, inlineMathRe } from './mathSyntax';

/**
 * Anki `.apkg` reader/writer (docs/fasi/F4-flashcard.md "Export/import Anki .apkg (bidirezionale)").
 *
 * An `.apkg` is a zip holding a SQLite collection (`collection.anki2`, the "legacy" schema-11
 * layout every Anki version still imports) plus a `media` map. This module is pure — bytes in,
 * bytes out, no database of ours — so the round trip is testable on its own.
 *
 * Scheduling: Anki's own fields (`type`/`queue`/`due`/`ivl`/`factor`) are filled with the closest
 * SM-2-style equivalent so Anki shows sensible due dates, and the card's *exact* FSRS state is
 * stored in the card's `data` column — both as Anki's FSRS memory state (`s`, `d`) and as a
 * `studyhub` object. Re-importing our own export restores the state verbatim; a file from plain
 * Anki (no such state) is approximated, see `importedSchedule`.
 */

const SQLITE_BUILTIN = 'node:sqlite';

/** `node:sqlite` via `getBuiltinModule` so the bundler never tries to resolve it. */
function openDatabase(path: string): DatabaseSync {
  const mod = process.getBuiltinModule(SQLITE_BUILTIN) as typeof import('node:sqlite') | undefined;
  if (!mod) throw new Error('SQLite non disponibile in questa versione di Node (serve ≥ 22.13)');
  return new mod.DatabaseSync(path);
}

export class ApkgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApkgError';
  }
}

export type AnkiCardType = 'basic' | 'cloze' | 'qa' | 'formula';

export interface AnkiExportCard {
  id: string;
  type: AnkiCardType;
  front: string;
  back: string;
  hint: string | null;
  tags: string[];
  schedule: FlashcardSchedule;
  suspended: boolean;
  createdAt: Date;
}

export interface AnkiImportedCard {
  type: AnkiCardType;
  front: string;
  back: string;
  hint: string | null;
  tags: string[];
  schedule: FlashcardSchedule;
  suspended: boolean;
}

export interface ParsedApkg {
  deckName: string | null;
  cards: AnkiImportedCard[];
  warnings: string[];
}

// ---------------------------------------------------------------------------------------------
// Text conversion: our card syntax <-> Anki's HTML
// ---------------------------------------------------------------------------------------------

const FIELD_SEP = '\x1f';
const MATH_OPEN = '\uE000';
const MATH_CLOSE = '\uE001';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** `$x$` → `\(x\)`, `$$x$$` → `\[x\]` (Anki's MathJax); everything else HTML-escaped. */
export function toAnkiHtml(text: string): string {
  const maths: string[] = [];
  const stash = (open: string, tex: string, close: string) => {
    maths.push(`${open}${escapeHtml(tex)}${close}`);
    return `${MATH_OPEN}${maths.length - 1}${MATH_CLOSE}`;
  };
  const withoutMath = text
    .replaceAll(MATH_OPEN, '')
    .replaceAll(MATH_CLOSE, '')
    .replace(displayMathRe(), (_m, tex: string) => stash('\\[', tex, '\\]'))
    .replace(inlineMathRe(), (_m, tex: string) => stash('\\(', tex, '\\)'));
  return escapeHtml(withoutMath)
    .replace(/\r?\n/g, '<br>')
    .replace(
      new RegExp(`${MATH_OPEN}(\\d+)${MATH_CLOSE}`, 'g'),
      (_m, i: string) => maths[Number(i)]!,
    );
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent[0] === '#') {
      const code =
        ent[1]!.toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? whole;
  });
}

/**
 * Anki field HTML → plain card text: line breaks kept, MathJax → `$…$`, tags stripped, images
 * replaced by a visible `[immagine: nome]` marker (media files are not imported).
 */
export function fromAnkiHtml(html: string): string {
  const maths: string[] = [];
  const stash = (open: string, tex: string) => {
    maths.push(`${open}${decodeEntities(tex.replace(/<br\s*\/?>/gi, ' '))}${open}`);
    return `${MATH_OPEN}${maths.length - 1}${MATH_CLOSE}`;
  };
  const text = html
    .replaceAll(MATH_OPEN, '')
    .replaceAll(MATH_CLOSE, '')
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, tex: string) => stash('$$', tex))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, tex: string) => stash('$', tex))
    .replace(
      /<img\b[^>]*\bsrc\s*=\s*["']?([^"' >]+)["']?[^>]*>/gi,
      (_m, src: string) => `[immagine: ${src}]`,
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text)
    .replace(
      new RegExp(`${MATH_OPEN}(\\d+)${MATH_CLOSE}`, 'g'),
      (_m, i: string) => maths[Number(i)]!,
    )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A generated cloze card keeps its blank as `{{...}}` in `front` and the full sentence in `back`;
 * Anki wants the answer inside the text (`{{c1::answer}}`). Recovers the answer from the two
 * (front minus blank must be a prefix + suffix of back). Returns null when it can't.
 */
export function clozeToAnki(front: string, back: string): { text: string; extra: string } | null {
  if (/\{\{c\d+::/.test(front)) {
    // StudyHub hides every blank of a cloze card at once, while Anki hides only the number of the
    // card being asked: renumbering them all `c1` keeps that behaviour in Anki (one card, all
    // hidden) and makes the round trip stable.
    return { text: front.replace(/\{\{c\d+::/g, '{{c1::'), extra: back };
  }
  const blanks = front.split('{{...}}');
  if (blanks.length !== 2) return null;
  const [prefix, suffix] = blanks as [string, string];
  if (back.length <= prefix.length + suffix.length) return null;
  if (!back.startsWith(prefix) || !back.endsWith(suffix)) return null;
  const answer = back.slice(prefix.length, back.length - suffix.length);
  return { text: `${prefix}{{c1::${answer}}}${suffix}`, extra: '' };
}

/** Keeps `{{c<keep>::…}}` and turns every other cloze deletion into its plain answer. */
export function isolateCloze(text: string, keep: number): string {
  return text.replace(
    /\{\{c(\d+)::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g,
    (whole, n: string, answer: string) => (Number(n) === keep ? whole : answer),
  );
}

function stripCloze(text: string): string {
  return text.replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, '$1');
}

// ---------------------------------------------------------------------------------------------
// Scheduling: FlashcardSchedule <-> Anki card row
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;

interface StudyhubState {
  stability: number | null;
  difficulty: number | null;
  dueAt: string | null;
  lastReviewAt: string | null;
  reps: number;
  lapses: number;
  state: FsrsCardState;
}

interface AnkiCardRow {
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number;
  data: string;
}

function scheduleToAnkiRow(
  schedule: FlashcardSchedule,
  suspended: boolean,
  crtSecs: number,
  position: number,
): AnkiCardRow {
  const base = { reps: schedule.reps, lapses: schedule.lapses, left: 0 };
  if (schedule.state === 'new') {
    return {
      ...base,
      type: 0,
      queue: suspended ? -1 : 0,
      due: position,
      ivl: 0,
      factor: 0,
      data: '',
    };
  }

  const dueAt = schedule.dueAt ?? new Date();
  const scheduledDays = schedule.lastReviewAt
    ? Math.max(1, Math.round((dueAt.getTime() - schedule.lastReviewAt.getTime()) / DAY_MS))
    : Math.max(1, Math.round(schedule.stability ?? 1));

  const state: StudyhubState = {
    stability: schedule.stability,
    difficulty: schedule.difficulty,
    dueAt: schedule.dueAt ? schedule.dueAt.toISOString() : null,
    lastReviewAt: schedule.lastReviewAt ? schedule.lastReviewAt.toISOString() : null,
    reps: schedule.reps,
    lapses: schedule.lapses,
    state: schedule.state,
  };
  // `s`/`d` are Anki's own FSRS memory-state keys; `studyhub` is the lossless copy.
  const data = JSON.stringify({ s: schedule.stability, d: schedule.difficulty, studyhub: state });

  if (schedule.state === 'review') {
    const due = Math.floor((dueAt.getTime() - crtSecs * 1000) / DAY_MS);
    return {
      ...base,
      type: 2,
      queue: suspended ? -1 : 2,
      due,
      ivl: scheduledDays,
      factor: 2500,
      data,
    };
  }
  // learning (type 1) and relearning (type 3) both live in queue 1, due as epoch seconds.
  return {
    ...base,
    type: schedule.state === 'learning' ? 1 : 3,
    queue: suspended ? -1 : 1,
    due: Math.floor(dueAt.getTime() / 1000),
    ivl: schedule.state === 'relearning' ? scheduledDays : 0,
    factor: 2500,
    left: 1001,
    data,
  };
}

function parseData(raw: string): { s?: number; d?: number; studyhub?: Partial<StudyhubState> } {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as never) : {};
  } catch {
    return {};
  }
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function validDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const STATES: FsrsCardState[] = ['new', 'learning', 'review', 'relearning'];

/**
 * The schedule for one imported Anki card. In order of fidelity:
 * 1. our own `studyhub` state (a re-import of a StudyHub export) — verbatim;
 * 2. Anki's FSRS memory state (`s`/`d`) — real stability/difficulty, Anki's due date;
 * 3. plain SM-2 data — stability ≈ the interval (the days after which FSRS expects ~90%
 *    retention, which is what an interval means), difficulty mapped from the ease factor. An
 *    approximation: it seeds a sensible schedule, it is not a lossless conversion.
 */
export function importedSchedule(row: AnkiCardRow, crtSecs: number): FlashcardSchedule {
  if (row.type === 0) return newCardSchedule();
  const data = parseData(row.data);

  const own = data.studyhub;
  if (own && STATES.includes(own.state as FsrsCardState) && own.state !== 'new') {
    return {
      stability: finite(own.stability) ? own.stability : null,
      difficulty: finite(own.difficulty) ? own.difficulty : null,
      dueAt: validDate(own.dueAt),
      lastReviewAt: validDate(own.lastReviewAt),
      reps: finite(own.reps) ? own.reps : row.reps,
      lapses: finite(own.lapses) ? own.lapses : row.lapses,
      state: own.state as FsrsCardState,
    };
  }

  const state: FsrsCardState =
    row.type === 1 ? 'learning' : row.type === 3 ? 'relearning' : 'review';
  // Queue 2 counts days since the collection was created; queue 1 counts epoch seconds.
  const dueAt =
    row.type === 2 || row.queue === 2
      ? new Date(crtSecs * 1000 + row.due * DAY_MS)
      : new Date(row.due * 1000);
  const intervalDays = Math.max(row.ivl, 0);
  const easeDifficulty = Math.min(10, Math.max(1, 1 + 9 * (1 - (row.factor - 1300) / 1700)));

  const stability = finite(data.s) ? data.s : Math.max(intervalDays, 1);
  const difficulty = finite(data.d) ? data.d : row.factor > 0 ? easeDifficulty : 5;
  return {
    stability,
    difficulty,
    dueAt,
    lastReviewAt: intervalDays > 0 ? new Date(dueAt.getTime() - intervalDays * DAY_MS) : null,
    reps: row.reps,
    lapses: row.lapses,
    state,
  };
}

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

const CARD_CSS =
  '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }\n.cloze { font-weight: bold; color: blue; }';

const LATEX_PRE =
  '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n';

function field(name: string, ord: number) {
  return { name, ord, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] };
}

function model(
  id: number,
  deckId: number,
  now: number,
  name: string,
  kind: 0 | 1,
  fieldNames: string[],
  qfmt: string,
  afmt: string,
) {
  return {
    id,
    name,
    type: kind,
    mod: now,
    usn: -1,
    sortf: 0,
    did: deckId,
    tmpls: [
      { name: 'Card 1', ord: 0, qfmt, afmt, bqfmt: '', bafmt: '', did: null, bfont: '', bsize: 0 },
    ],
    flds: fieldNames.map(field),
    css: CARD_CSS,
    latexPre: LATEX_PRE,
    latexPost: '\\end{document}',
    latexsvg: false,
    req: [[0, 'any', [0]]],
    tags: [],
    vers: [],
  };
}

const sha1First32 = (text: string) =>
  parseInt(createHash('sha1').update(text).digest('hex').slice(0, 8), 16);

/** Builds an `.apkg` holding `cards` as one deck. `now` is injectable so tests are deterministic. */
export async function buildApkg(
  cards: AnkiExportCard[],
  options: { deckName: string; now?: Date },
): Promise<Uint8Array> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const nowSecs = Math.floor(nowMs / 1000);
  // Day 0 for review `due` values: midnight UTC of today (Anki only needs it to be consistent).
  const crtSecs = Math.floor(nowMs / DAY_MS) * 86400;
  const deckId = nowMs;
  const basicId = nowMs + 1;
  const clozeId = nowMs + 2;

  const models = {
    [basicId]: model(
      basicId,
      deckId,
      nowSecs,
      'StudyHub Basic',
      0,
      ['Front', 'Back', 'Hint'],
      '{{Front}}',
      '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}{{#Hint}}<br><br><i>{{Hint}}</i>{{/Hint}}',
    ),
    [clozeId]: model(
      clozeId,
      deckId,
      nowSecs,
      'StudyHub Cloze',
      1,
      ['Text', 'Back Extra'],
      '{{cloze:Text}}',
      '{{cloze:Text}}<br>\n{{Back Extra}}',
    ),
  };
  const decks = {
    '1': deckEntry(1, 'Default', nowSecs),
    [deckId]: deckEntry(deckId, options.deckName, nowSecs),
  };
  const conf = {
    activeDecks: [1],
    curDeck: 1,
    newSpread: 0,
    collapseTime: 1200,
    timeLim: 0,
    estTimes: true,
    dueCounts: true,
    curModel: String(basicId),
    nextPos: 1,
    sortType: 'noteFld',
    sortBackwards: false,
    addToCur: true,
  };
  const dconf = {
    '1': {
      id: 1,
      mod: 0,
      name: 'Default',
      usn: 0,
      maxTaken: 60,
      autoplay: true,
      timer: 0,
      replayq: true,
      new: {
        bury: true,
        delays: [1, 10],
        initialFactor: 2500,
        ints: [1, 4, 7],
        order: 1,
        perDay: 20,
        separate: true,
      },
      lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 },
      rev: {
        bury: true,
        ease4: 1.3,
        fuzz: 0.05,
        ivlFct: 1,
        maxIvl: 36500,
        minSpace: 1,
        perDay: 100,
      },
    },
  };

  const dir = await mkdtemp(join(tmpdir(), 'studyhub-apkg-'));
  const dbPath = join(dir, 'collection.anki2');
  try {
    const db = openDatabase(dbPath);
    try {
      db.exec(SCHEMA);
      db.prepare('INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)').run(
        crtSecs,
        nowMs,
        nowMs,
        JSON.stringify(conf),
        JSON.stringify(models),
        JSON.stringify(decks),
        JSON.stringify(dconf),
        '{}',
      );

      const insertNote = db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, ?)');
      const insertCard = db.prepare(
        'INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)',
      );

      let lastId = 0;
      cards.forEach((card, i) => {
        // Anki ids are millisecond timestamps and must be unique: cards created in the same
        // millisecond (a bulk generation) get the next free id instead of colliding.
        const noteId = Math.max(card.createdAt.getTime(), lastId + 1);
        lastId = noteId;
        const cloze = card.type === 'cloze' ? clozeToAnki(card.front, card.back) : null;
        const fields = cloze
          ? [toAnkiHtml(cloze.text), toAnkiHtml(cloze.extra)]
          : [toAnkiHtml(card.front), toAnkiHtml(card.back), toAnkiHtml(card.hint ?? '')];
        const first = fields[0]!;
        const tags =
          card.tags.length > 0 ? ` ${card.tags.map((t) => t.replace(/\s+/g, '_')).join(' ')} ` : '';

        insertNote.run(
          noteId,
          card.id,
          cloze ? clozeId : basicId,
          nowSecs,
          tags,
          fields.join(FIELD_SEP),
          first.replace(/<[^>]*>/g, ''),
          sha1First32(first.replace(/<[^>]*>/g, '')),
          '',
        );

        const row = scheduleToAnkiRow(card.schedule, card.suspended, crtSecs, i + 1);
        insertCard.run(
          noteId,
          noteId,
          deckId,
          nowSecs,
          row.type,
          row.queue,
          row.due,
          row.ivl,
          row.factor,
          row.reps,
          row.lapses,
          row.left,
          row.data,
        );
      });
    } finally {
      db.close();
    }

    const collection = new Uint8Array(await readFile(dbPath));
    return zipSync({ 'collection.anki2': collection, media: new TextEncoder().encode('{}') });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function deckEntry(id: number, name: string, nowSecs: number) {
  return {
    id,
    mod: nowSecs,
    name,
    usn: -1,
    lrnToday: [0, 0],
    revToday: [0, 0],
    newToday: [0, 0],
    timeToday: [0, 0],
    collapsed: false,
    browserCollapsed: false,
    desc: '',
    dyn: 0,
    conf: 1,
    extendNew: 10,
    extendRev: 50,
  };
}

// ---------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------

interface AnkiModel {
  type?: number;
  flds?: { name: string }[];
  tmpls?: { qfmt?: string }[];
}

/** 50 MB compressed / 200 MB expanded: a real deck with media is big, a zip bomb is not a deck. */
const MAX_APKG_ENTRY_BYTES = 200 * 1024 * 1024;

export async function parseApkg(bytes: Uint8Array): Promise<ParsedApkg> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      // Only the collection matters; skipping media keeps memory bounded on decks with images.
      filter: (f) => f.name.startsWith('collection.') && f.originalSize <= MAX_APKG_ENTRY_BYTES,
    });
  } catch {
    throw new ApkgError('Il file non è un archivio .apkg valido');
  }

  const collection = files['collection.anki21'] ?? files['collection.anki2'];
  if (!collection) {
    if (files['collection.anki21b']) {
      throw new ApkgError(
        'Questo .apkg usa il formato Anki recente (compresso). In Anki: Esporta → spunta «Supporta versioni precedenti di Anki» e riprova.',
      );
    }
    throw new ApkgError('Nessuna collezione trovata nel file .apkg');
  }

  const dir = await mkdtemp(join(tmpdir(), `studyhub-apkg-${randomUUID()}-`));
  const dbPath = join(dir, 'collection.anki2');
  try {
    await writeFile(dbPath, collection);
    const db = openDatabase(dbPath);
    try {
      return readCollection(db);
    } catch (err) {
      if (err instanceof ApkgError) throw err;
      throw new ApkgError('La collezione Anki nel file non è leggibile');
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function readCollection(db: DatabaseSync): ParsedApkg {
  const col = db.prepare('SELECT crt, models, decks FROM col LIMIT 1').get() as
    { crt: number; models: string; decks: string } | undefined;
  if (!col) throw new ApkgError('Collezione Anki vuota');

  const models = JSON.parse(col.models) as Record<string, AnkiModel>;
  const decks = JSON.parse(col.decks) as Record<string, { name: string }>;
  const warnings: string[] = [];

  const rows = db
    .prepare(
      `SELECT c.did, c.ord, c.type, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses, c."left" AS "left", c.data,
              n.mid, n.tags, n.flds
       FROM cards c JOIN notes n ON n.id = c.nid
       ORDER BY c.id`,
    )
    .all() as unknown as (AnkiCardRow & {
    did: number;
    ord: number;
    mid: number;
    tags: string;
    flds: string;
  })[];

  const cards: AnkiImportedCard[] = [];
  const deckCounts = new Map<number, number>();
  let skipped = 0;

  for (const row of rows) {
    const mdl = models[String(row.mid)];
    const fieldValues = row.flds.split(FIELD_SEP).map(fromAnkiHtml);
    const tags = row.tags.split(/\s+/).filter(Boolean);
    const schedule = importedSchedule(row, col.crt);
    const suspended = row.queue === -1;
    const common = { tags, schedule, suspended };

    let card: AnkiImportedCard | null = null;
    if (mdl?.type === 1) {
      const text = fieldValues[0] ?? '';
      const extra = fieldValues[1] ?? '';
      if (text) {
        const front = isolateCloze(text, row.ord + 1);
        // `back` is Anki's "Back Extra" when there is one; otherwise the complete sentence, the
        // same shape as the generator's cloze cards (the column is NOT NULL). The review screen
        // (`revealPlan`) shows the solved `front`, and the back only if it adds something.
        card = {
          type: 'cloze',
          front,
          back: extra || stripCloze(text),
          hint: null,
          ...common,
        };
      }
    } else {
      const names = (mdl?.flds ?? []).map((f) => f.name);
      const qfmt = mdl?.tmpls?.[row.ord]?.qfmt ?? mdl?.tmpls?.[0]?.qfmt ?? '';
      const hintIdx = names.indexOf('Hint');
      const frontIdx = Math.max(
        0,
        names.findIndex((n) => qfmt.includes(`{{${n}}}`)),
      );
      const rest = fieldValues.filter((v, i) => i !== frontIdx && i !== hintIdx && v !== '');
      const front = fieldValues[frontIdx] ?? '';
      const back = rest.join('\n');
      if (front && back) {
        const hint = hintIdx >= 0 ? (fieldValues[hintIdx] ?? '') : '';
        card = { type: 'basic', front, back, hint: hint || null, ...common };
      }
    }

    if (!card) {
      skipped += 1;
      continue;
    }
    cards.push(card);
    deckCounts.set(row.did, (deckCounts.get(row.did) ?? 0) + 1);
  }

  if (skipped > 0) warnings.push(`${skipped} carte senza fronte o retro non sono state importate`);
  if (cards.some((c) => /\[immagine: /.test(c.front + c.back))) {
    warnings.push(
      'Le immagini non vengono importate: al loro posto resta un segnaposto [immagine: nome]',
    );
  }

  let deckName: string | null = null;
  let best = 0;
  for (const [did, count] of deckCounts) {
    const name = decks[String(did)]?.name;
    if (name && count > best) {
      best = count;
      deckName = name.split('::').pop() ?? name;
    }
  }
  return { deckName: deckName === 'Default' ? null : deckName, cards, warnings };
}
