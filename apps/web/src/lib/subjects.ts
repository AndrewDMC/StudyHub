import { randomUUID } from 'node:crypto';
import { eq, isNull, sql } from 'drizzle-orm';
import { documents, exams, subjects, type Database } from '@studyhub/db';
import {
  disambiguateSlug,
  listSubjectSlugsOnDisk,
  moveSubjectFolderToTrash,
  scaffoldSubject,
  slugify,
  createManifest,
} from '@studyhub/core';
import type { CreateSubjectRequest, SubjectDto, SubjectSummaryDto } from '@studyhub/contracts';
import { SubjectNotFoundError } from './errors';

// Both the real Postgres client and the pglite test client expose the same
// query-builder surface; see apps/web/test/subjects.test.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = Database | any;

function toDto(row: typeof subjects.$inferSelect): SubjectDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    color: row.color as SubjectDto['color'],
    professor: row.professor,
    cfu: row.cfu,
    folderPath: row.folderPath,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * List-view aggregation for the Materie grid (docs/fasi/F2-materie.md):
 * document count and the soonest upcoming exam per subject. Archived
 * subjects are hidden by default — "archivio una materia: sparisce dalla
 * dashboard, la cartella resta intatta".
 */
export async function listSubjectSummaries(
  db: AnyDb,
  options: { includeArchived?: boolean } = {},
): Promise<SubjectSummaryDto[]> {
  const rows = await db
    .select({
      subject: subjects,
      documentCount: sql<number>`count(distinct ${documents.id})`.mapWith(Number),
      nextExamAt: sql<
        string | null
      >`min(${exams.date}) filter (where ${exams.status} = 'scheduled' and ${exams.date} > now())`,
    })
    .from(subjects)
    .leftJoin(documents, eq(documents.subjectId, subjects.id))
    .leftJoin(exams, eq(exams.subjectId, subjects.id))
    .where(options.includeArchived ? undefined : isNull(subjects.archivedAt))
    .groupBy(subjects.id)
    .orderBy(subjects.name);

  return rows.map(
    (r: {
      subject: typeof subjects.$inferSelect;
      documentCount: number;
      nextExamAt: string | Date | null;
    }) => ({
      ...toDto(r.subject),
      documentCount: r.documentCount,
      nextExamAt: r.nextExamAt ? new Date(r.nextExamAt).toISOString() : null,
    }),
  );
}

/**
 * Creates a subject end-to-end: disambiguates the slug against both the DB
 * and the filesystem, scaffolds the folder tree (filesystem first — it is
 * the source of truth per docs/01-architettura.md §1), then inserts the DB
 * index row. If the DB insert fails, the folder is left in place: a later
 * `reconcile` will pick it up rather than silently losing it.
 */
export async function createSubject(
  db: AnyDb,
  dataRoot: string,
  input: CreateSubjectRequest,
): Promise<SubjectDto> {
  const dbSlugRows: { slug: string }[] = await db.select({ slug: subjects.slug }).from(subjects);
  const existingDbSlugs = new Set<string>(dbSlugRows.map((r) => r.slug));
  const onDiskSlugs = new Set<string>(await listSubjectSlugsOnDisk(dataRoot));
  for (const s of onDiskSlugs) existingDbSlugs.add(s);

  const baseSlug = slugify(input.name);
  const slug = disambiguateSlug(baseSlug, existingDbSlugs);

  const manifest = createManifest({
    id: randomUUID(),
    name: input.name,
    slug,
    color: input.color,
    professor: input.professor,
    cfu: input.cfu,
  });

  const folderPath = await scaffoldSubject(dataRoot, manifest);

  const [row] = await db
    .insert(subjects)
    .values({
      id: manifest.id,
      slug: manifest.slug,
      name: manifest.name,
      color: manifest.color,
      professor: manifest.professor ?? null,
      cfu: manifest.cfu ?? null,
      folderPath,
    })
    .returning();

  return toDto(row);
}

export async function getSubjectBySlug(db: AnyDb, slug: string): Promise<SubjectDto | null> {
  const [row] = await db.select().from(subjects).where(eq(subjects.slug, slug));
  return row ? toDto(row) : null;
}

/** Archive is soft and reversible: sets/clears `archived_at`, never touches the filesystem. */
export async function setSubjectArchived(
  db: AnyDb,
  slug: string,
  archived: boolean,
): Promise<SubjectDto> {
  const [row] = await db
    .update(subjects)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(subjects.slug, slug))
    .returning();
  if (!row) throw new SubjectNotFoundError(slug);
  return toDto(row);
}

/**
 * "Elimina definitivamente" (docs/fasi/F2-materie.md): moves the folder to
 * `/data/.trash/` (never `rm -rf`), then drops the DB row — cascades remove
 * documents/chunks/exams/topics/jobs for this subject.
 */
export async function deleteSubjectPermanently(
  db: AnyDb,
  dataRoot: string,
  slug: string,
): Promise<void> {
  const [row] = await db.select().from(subjects).where(eq(subjects.slug, slug));
  if (!row) throw new SubjectNotFoundError(slug);
  await moveSubjectFolderToTrash(slug, dataRoot);
  await db.delete(subjects).where(eq(subjects.id, row.id));
}
