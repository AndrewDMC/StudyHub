import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveDataRoot, resolveSubjectPath } from './paths.js';

/**
 * "Elimina definitivamente" moves the subject folder to `/data/.trash/`
 * instead of `rm -rf` (docs/fasi/F2-materie.md "Decisioni"): the user can
 * still recover it by hand from the filesystem. Not exposed as an app-level
 * "restore" feature — that would need its own DB reconciliation story.
 */
export async function moveSubjectFolderToTrash(
  slug: string,
  dataRoot: string = resolveDataRoot(),
): Promise<string> {
  const subjectDir = resolveSubjectPath(slug, dataRoot);
  const trashRoot = resolve(dataRoot, '.trash');
  await fs.mkdir(trashRoot, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(trashRoot, `${timestamp}-${slug}`);
  await fs.rename(subjectDir, dest);
  return dest;
}
