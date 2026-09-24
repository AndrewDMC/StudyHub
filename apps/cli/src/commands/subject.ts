import { randomUUID } from 'node:crypto';
import { subjects, type Database } from '@studyhub/db';
import {
  createManifest,
  disambiguateSlug,
  listSubjectSlugsOnDisk,
  scaffoldSubject,
  slugify,
  type SubjectColor,
} from '@studyhub/core';

export interface AddSubjectInput {
  name: string;
  color: SubjectColor;
  professor?: string | undefined;
  cfu?: number | undefined;
}

export interface SubjectRow {
  id: string;
  slug: string;
  name: string;
  color: string;
  professor: string | null;
  cfu: number | null;
  folderPath: string;
}

/**
 * Same create-subject flow as apps/web/src/lib/subjects.ts (FS first, then
 * DB index) exposed as a CLI command — "apps/cli è lo stesso codice del
 * worker invocato one-shot" (docs/01-architettura.md §1).
 */
export async function addSubject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  input: AddSubjectInput,
): Promise<SubjectRow> {
  const dbSlugRows: { slug: string }[] = await db.select({ slug: subjects.slug }).from(subjects);
  const taken = new Set<string>(dbSlugRows.map((r) => r.slug));
  for (const s of await listSubjectSlugsOnDisk(dataRoot)) taken.add(s);

  const slug = disambiguateSlug(slugify(input.name), taken);
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

  return row as SubjectRow;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function listSubjectRows(db: any): Promise<SubjectRow[]> {
  return db.select().from(subjects).orderBy(subjects.name);
}

export type { Database };
