import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { subjects } from '@studyhub/db';
import {
  listSubjectSlugsOnDisk,
  manifestExists,
  readManifest,
  resolveSubjectPath,
} from '@studyhub/core';
import type { ReconcileJobInput } from '@studyhub/contracts';

export interface ReconcileResult {
  imported: string[];
  alreadyIndexed: string[];
  skippedInvalid: { slug: string; reason: string }[];
}

/**
 * F0 scope of reconcile: import subject folders that exist on disk with a
 * valid manifest but no matching DB row (docs/fasi/F0-fondamenta.md
 * acceptance: "Creo una cartella a mano con manifest valido -> reconcile la
 * importa."). Document-level sha256/missing tracking is F1+ scope
 * (docs/02-filesystem-e-dati.md §2) since the `documents` table doesn't
 * exist yet.
 */
export async function reconcileSubjects(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  input: ReconcileJobInput = {},
): Promise<ReconcileResult> {
  const slugsOnDisk = input.subjectSlug
    ? [input.subjectSlug]
    : await listSubjectSlugsOnDisk(dataRoot);

  const result: ReconcileResult = { imported: [], alreadyIndexed: [], skippedInvalid: [] };

  for (const slug of slugsOnDisk) {
    const subjectDir = resolveSubjectPath(slug, dataRoot);

    if (!(await manifestExists(subjectDir))) {
      result.skippedInvalid.push({ slug, reason: 'missing subject.json' });
      continue;
    }

    let manifest;
    try {
      manifest = await readManifest(subjectDir);
    } catch (err) {
      result.skippedInvalid.push({
        slug,
        reason: err instanceof Error ? err.message : 'invalid manifest',
      });
      continue;
    }

    const [existing] = await db.select().from(subjects).where(eq(subjects.slug, slug));
    if (existing) {
      result.alreadyIndexed.push(slug);
      continue;
    }

    await db.insert(subjects).values({
      id: manifest.id ?? randomUUID(),
      slug: manifest.slug,
      name: manifest.name,
      color: manifest.color,
      professor: manifest.professor ?? null,
      cfu: manifest.cfu ?? null,
      folderPath: subjectDir,
    });
    result.imported.push(slug);
  }

  return result;
}
