import { promises as fs } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { resolveDataRoot, resolveSubjectPath, resolveSubjectSubpath } from './paths.js';
import { resolveDocumentDerivedDir } from './documentPaths.js';

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

export interface TrashedDocument {
  /** Folder under `<dataRoot>/.trash/` holding what was moved (`source/` and `derived/`). */
  dest: string;
  /** Puts everything back where it was — used when the DB delete fails after the files moved. */
  undo: () => Promise<void>;
}

async function moveIfExists(from: string, to: string): Promise<boolean> {
  try {
    await fs.mkdir(dirname(to), { recursive: true });
    await fs.rename(from, to);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Deleting a document moves its original file and its derived folder (extracted
 * text, pages, OCR) to `<dataRoot>/.trash/<timestamp>-<slug>-doc-<id>/` instead
 * of removing them — same recoverable-by-hand policy as a deleted subject.
 *
 * `storedPath` comes from the database, so it is only moved when it really sits
 * inside the subject's `sources/` folder; anything else is left alone rather
 * than trusted. Missing files are fine (a failed ingest may never have produced
 * a derived folder).
 */
export async function moveDocumentToTrash(
  slug: string,
  documentId: string,
  storedPath: string,
  dataRoot: string = resolveDataRoot(),
): Promise<TrashedDocument> {
  const sourcesDir = resolveSubjectSubpath(slug, ['sources'], dataRoot);
  const derivedDir = resolveDocumentDerivedDir(slug, documentId, dataRoot);
  const trashRoot = resolve(dataRoot, '.trash');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(trashRoot, `${timestamp}-${slug}-doc-${documentId}`);

  const resolvedSource = resolve(storedPath);
  const rel = relative(sourcesDir, resolvedSource);
  const sourceIsInside = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);

  const moved: { from: string; to: string }[] = [];
  const move = async (from: string, to: string) => {
    if (await moveIfExists(from, to)) moved.push({ from, to });
  };

  const undo = async () => {
    for (const { from, to } of [...moved].reverse()) await moveIfExists(to, from);
    moved.length = 0;
  };

  try {
    if (sourceIsInside) await move(resolvedSource, join(dest, 'source', basename(resolvedSource)));
    await move(derivedDir, join(dest, 'derived'));
  } catch (err) {
    await undo();
    throw err;
  }
  return { dest, undo };
}
