import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { documents, subjects } from '@studyhub/db';
import { resolveDocumentDerivedDir } from '@studyhub/core';
import { SubjectNotFoundError } from './errors';
import { DocumentNotFoundError } from './documentTopics';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export class NoCanonicalMarkdownError extends Error {
  constructor(documentId: string) {
    super(`Il documento ${documentId} non ha ancora un content.md (non è stato ancora ingerito)`);
    this.name = 'NoCanonicalMarkdownError';
  }
}

export interface DocumentContent {
  markdown: string;
  edited: boolean;
  /** Present only when a re-ingest found `mdEdited` and wrote a fresh version alongside — a conflict to resolve. */
  conflict: { newMarkdown: string } | null;
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function requireDocumentAndDerivedDir(
  db: AnyDb,
  subjectSlug: string,
  documentId: string,
  dataRoot: string,
) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);

  const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!document || document.subjectId !== subject.id) throw new DocumentNotFoundError(documentId);

  return { document, derivedDir: resolveDocumentDerivedDir(subject.slug, document.id, dataRoot) };
}

/** Reads `content.md` (+ `content.new.md` when a conflict is pending) — the editor/viewer page's data source. */
export async function getDocumentContent(
  db: AnyDb,
  dataRoot: string,
  subjectSlug: string,
  documentId: string,
): Promise<DocumentContent> {
  const { document, derivedDir } = await requireDocumentAndDerivedDir(
    db,
    subjectSlug,
    documentId,
    dataRoot,
  );
  const markdown = await readIfExists(join(derivedDir, 'content.md'));
  if (markdown === null) throw new NoCanonicalMarkdownError(documentId);

  const newMarkdown = document.mdConflict
    ? await readIfExists(join(derivedDir, 'content.new.md'))
    : null;

  return {
    markdown,
    edited: document.mdEdited,
    conflict: newMarkdown !== null ? { newMarkdown } : null,
  };
}

/** Saves the user's edit and marks `mdEdited` — from here on, a re-ingest never overwrites it silently. */
export async function saveDocumentContent(
  db: AnyDb,
  dataRoot: string,
  subjectSlug: string,
  documentId: string,
  markdown: string,
): Promise<void> {
  const { document, derivedDir } = await requireDocumentAndDerivedDir(
    db,
    subjectSlug,
    documentId,
    dataRoot,
  );
  await fs.writeFile(join(derivedDir, 'content.md'), markdown, 'utf-8');
  await db.update(documents).set({ mdEdited: true }).where(eq(documents.id, document.id));
}

/**
 * Resolves a stickiness conflict (docs/02-filesystem-e-dati.md §6.1): `keep: 'mine'` discards the
 * re-ingested `content.new.md`; `keep: 'new'` overwrites `content.md` with it and drops the user's
 * edit flag (their edit is exactly what's being replaced). Either way the conflict is cleared.
 */
export async function resolveDocumentContentConflict(
  db: AnyDb,
  dataRoot: string,
  subjectSlug: string,
  documentId: string,
  keep: 'mine' | 'new',
): Promise<void> {
  const { document, derivedDir } = await requireDocumentAndDerivedDir(
    db,
    subjectSlug,
    documentId,
    dataRoot,
  );
  const newPath = join(derivedDir, 'content.new.md');

  if (keep === 'new') {
    const newMarkdown = await readIfExists(newPath);
    if (newMarkdown !== null) {
      await fs.writeFile(join(derivedDir, 'content.md'), newMarkdown, 'utf-8');
    }
    await db
      .update(documents)
      .set({ mdConflict: false, mdEdited: false })
      .where(eq(documents.id, document.id));
  } else {
    await db.update(documents).set({ mdConflict: false }).where(eq(documents.id, document.id));
  }
  await fs.rm(newPath, { force: true });
}
