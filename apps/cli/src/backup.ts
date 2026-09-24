import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { eq, isNull } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import {
  artifactSources,
  artifacts,
  attemptItemResults,
  chunks,
  documents,
  examProfiles,
  exams,
  flashcards,
  jobs,
  reviews,
  settings,
  simulationAttempts,
  simulationItems,
  simulations,
  studyPlans,
  subjects,
  tasks,
  topics,
} from '@studyhub/db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

/**
 * `studyhub backup`/`restore` (docs/fasi/F7-dashboard-polish.md "Polish e
 * distribuzione"). The filesystem is the source of truth for *file*
 * existence (docs/01-architettura.md §1 "Ordine di verità"), but most rows
 * here (flashcards, reviews, tasks, chunks, exams, topics…) have no on-disk
 * equivalent — restoring "identical state" needs both a copy of `/data` and
 * a full DB dump. No `pg_dump` dependency: this reads/writes every table
 * through Drizzle as plain JSON, which also makes it exercisable against
 * pglite in tests without a real Postgres server.
 *
 * Table order matters for `restore` (parent rows before the children that
 * reference them) — this list is that order. `topics` is the one
 * self-referencing table (`parentId` -> `topics.id`); handled as two passes
 * (insert with `parentId` stripped, then a second update pass) rather than
 * a topological sort, since a two-level pass is simpler and this is the
 * only self-reference in the schema.
 */
const EXPORT_TABLES: { name: string; table: AnyPgTable }[] = [
  { name: 'subjects', table: subjects },
  { name: 'settings', table: settings },
  { name: 'jobs', table: jobs },
  { name: 'documents', table: documents },
  { name: 'chunks', table: chunks },
  { name: 'exams', table: exams },
  { name: 'topics', table: topics },
  { name: 'artifacts', table: artifacts },
  { name: 'artifactSources', table: artifactSources },
  { name: 'flashcards', table: flashcards },
  { name: 'reviews', table: reviews },
  { name: 'examProfiles', table: examProfiles },
  { name: 'simulations', table: simulations },
  { name: 'simulationItems', table: simulationItems },
  { name: 'simulationAttempts', table: simulationAttempts },
  { name: 'attemptItemResults', table: attemptItemResults },
  { name: 'studyPlans', table: studyPlans },
  { name: 'tasks', table: tasks },
];

const BACKUP_VERSION = 1;
const DATA_DIRNAME = 'data';
const MANIFEST_FILENAME = 'backup.json';

export interface BackupResult {
  destDir: string;
  tables: Record<string, number>;
}

export async function backupData(
  db: AnyDb,
  dataRoot: string,
  destDir: string,
): Promise<BackupResult> {
  await fs.mkdir(destDir, { recursive: true });
  const dataCopyDest = join(destDir, DATA_DIRNAME);
  await fs.rm(dataCopyDest, { recursive: true, force: true });
  await fs.cp(dataRoot, dataCopyDest, { recursive: true });

  const dump: Record<string, AnyRow[]> = {};
  const tables: Record<string, number> = {};
  for (const spec of EXPORT_TABLES) {
    const rows: AnyRow[] = await db.select().from(spec.table);
    dump[spec.name] = rows;
    tables[spec.name] = rows.length;
  }

  await fs.writeFile(
    join(destDir, MANIFEST_FILENAME),
    JSON.stringify(
      { version: BACKUP_VERSION, exportedAt: new Date().toISOString(), tables: dump },
      null,
      2,
    ),
    'utf-8',
  );

  return { destDir, tables };
}

// Matches the ISO-8601-with-milliseconds shape Postgres timestamp columns
// serialize to; the only `text` columns that look date-like (`tasks.date`,
// `study_plans.startDate/targetDate`) are plain `YYYY-MM-DD`, which this
// does not match, so they correctly survive the round trip as strings.
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function reviveDates(rows: AnyRow[]): AnyRow[] {
  return rows.map((row) => {
    const out: AnyRow = { ...row };
    for (const [key, value] of Object.entries(out)) {
      if (typeof value === 'string' && ISO_DATETIME.test(value)) out[key] = new Date(value);
    }
    return out;
  });
}

/** Deletes every row this backup covers. `subjects` cascades to everything scoped to a subject; only global rows (jobs with no subject, settings) need their own delete. */
async function clearAll(db: AnyDb): Promise<void> {
  await db.delete(jobs).where(isNull(jobs.subjectId));
  await db.delete(settings);
  await db.delete(subjects);
}

export interface RestoreResult {
  tables: Record<string, number>;
}

/**
 * Replaces the current state (DB rows this backup covers + everything
 * under `dataRoot`) with the backup's — not a merge. "Backup e restore su
 * macchina diversa: stato identico" (docs/fasi/F7 criteri) means starting
 * from nothing, so a full wipe-then-restore is the correct, simplest
 * semantics: restoring twice, or onto a dirty database, gives the same result.
 */
export async function restoreData(
  db: AnyDb,
  dataRoot: string,
  srcDir: string,
): Promise<RestoreResult> {
  const raw = await fs.readFile(join(srcDir, MANIFEST_FILENAME), 'utf-8');
  const backup = JSON.parse(raw) as { version: number; tables: Record<string, AnyRow[]> };
  if (backup.version !== BACKUP_VERSION) {
    throw new Error(
      `Versione di backup non supportata: ${backup.version} (attesa ${BACKUP_VERSION})`,
    );
  }

  await fs.rm(dataRoot, { recursive: true, force: true });
  await fs.cp(join(srcDir, DATA_DIRNAME), dataRoot, { recursive: true });

  await clearAll(db);

  const tables: Record<string, number> = {};
  for (const spec of EXPORT_TABLES) {
    const rows = reviveDates(backup.tables[spec.name] ?? []);
    tables[spec.name] = rows.length;
    if (rows.length === 0) continue;

    if (spec.name === 'topics') {
      await db.insert(topics).values(rows.map((r) => ({ ...r, parentId: null })));
      for (const r of rows) {
        if (r.parentId)
          await db.update(topics).set({ parentId: r.parentId }).where(eq(topics.id, r.id));
      }
    } else {
      await db.insert(spec.table).values(rows);
    }
  }

  return { tables };
}
