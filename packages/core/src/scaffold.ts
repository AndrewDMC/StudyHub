import { promises as fs } from 'node:fs';
import { resolveSubjectPath, resolveSubjectsRoot, resolveSubjectSubpath } from './paths.js';
import { writeManifest, type SubjectManifest } from './manifest.js';

/** Relative sub-folders created for every new subject (docs/02-filesystem-e-dati.md §1). */
export const SUBJECT_SUBFOLDERS: readonly string[][] = [
  ['sources', 'appunti'],
  ['sources', 'schemi'],
  ['sources', 'esami'],
  ['sources', 'slide'],
  ['sources', 'altro'],
  ['derived'],
  ['artifacts', 'flashcards'],
  ['artifacts', 'schemas'],
  ['artifacts', 'summaries'],
  ['artifacts', 'simulations'],
  ['plans'],
  ['.studyhub'],
];

/**
 * Creates the on-disk folder tree for a subject and writes its manifest.
 * Idempotent: safe to call again on an existing subject folder (e.g. to heal
 * a partially-created one).
 */
export async function scaffoldSubject(
  dataRoot: string,
  manifest: SubjectManifest,
): Promise<string> {
  const subjectDir = resolveSubjectPath(manifest.slug, dataRoot);
  await fs.mkdir(subjectDir, { recursive: true });

  for (const segments of SUBJECT_SUBFOLDERS) {
    const dir = resolveSubjectSubpath(manifest.slug, segments, dataRoot);
    await fs.mkdir(dir, { recursive: true });
  }

  await writeManifest(subjectDir, manifest);
  return subjectDir;
}

/** Lists slugs of subject folders already present on disk (used to disambiguate new ones). */
export async function listSubjectSlugsOnDisk(dataRoot: string): Promise<string[]> {
  const subjectsRoot = resolveSubjectsRoot(dataRoot);
  try {
    const entries = await fs.readdir(subjectsRoot, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}
