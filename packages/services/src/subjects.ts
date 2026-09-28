import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { subjects, type Database } from '@studyhub/db';
import {
  createManifest,
  disambiguateSlug,
  listSubjectSlugsOnDisk,
  scaffoldSubject,
  slugify,
  type SubjectColor,
} from '@studyhub/core';

export interface CreateSubjectInput {
  name: string;
  color: SubjectColor;
  professor?: string | undefined;
  cfu?: number | undefined;
}

export type SubjectRow = typeof subjects.$inferSelect;

// Both the real Postgres client and the pglite test client expose the same
// query-builder surface; see packages/db/src/testDb.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = Database | any;

/**
 * Creates a subject end-to-end: disambiguates the slug against both the DB
 * and the filesystem, scaffolds the folder tree (filesystem first — it is
 * the source of truth per docs/01-architettura.md §1), then inserts the DB
 * index row. If the DB insert fails, the folder is left in place: a later
 * `reconcile` will pick it up rather than silently losing it.
 *
 * Shared by apps/web/src/lib/subjects.ts and apps/cli/src/commands/subject.ts
 * — "apps/cli è lo stesso codice del worker invocato one-shot"
 * (docs/01-architettura.md §1).
 */
export async function createSubjectRow(
  db: AnyDb,
  dataRoot: string,
  input: CreateSubjectInput,
): Promise<SubjectRow> {
  const dbSlugRows: { slug: string }[] = await db.select({ slug: subjects.slug }).from(subjects);
  const existingSlugs = new Set<string>(dbSlugRows.map((r) => r.slug));
  for (const s of await listSubjectSlugsOnDisk(dataRoot)) existingSlugs.add(s);

  const slug = disambiguateSlug(slugify(input.name), existingSlugs);
  const manifest = createManifest({
    id: randomUUID(),
    name: input.name,
    slug,
    color: input.color,
    professor: input.professor,
    cfu: input.cfu,
  });
  const folderPath = await scaffoldSubject(dataRoot, manifest);

  // New subjects append to the end of the Materie grid (docs/fasi/F2-materie.md "riordina"):
  // one after the current highest `sortOrder`, so reordering by hand is never disturbed by
  // a later creation landing in the middle.
  const maxOrderRows: { maxOrder: number }[] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${subjects.sortOrder}), -1)`.mapWith(Number) })
    .from(subjects);
  const maxOrder = maxOrderRows[0]!.maxOrder;

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
      sortOrder: maxOrder + 1,
    })
    .returning();

  return row as SubjectRow;
}
