import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { documents, type Document } from '@studyhub/db';

export interface WriteCanonicalMarkdownResult {
  mdPath: string;
  /** 'content' — content.md written normally. 'conflict' — the user had edited
   * content.md, so the fresh output went to content.new.md instead. */
  outcome: 'content' | 'conflict';
}

/**
 * Stickiness guard shared by every job that (re)generates a document's
 * canonical markdown (docs/02-filesystem-e-dati.md §6.1, §6.2): once a user
 * has edited `content.md` (`documents.mdEdited`), a re-ingest never
 * overwrites it — the fresh output goes to `content.new.md` and
 * `documents.mdConflict` is set so the UI can show a resolvable diff
 * (apps/web/src/lib/documentContent.ts). `content.orig.md` is written only
 * once, the very first time — genuinely immutable, not just re-copied on
 * every re-run, so it stays a true diff base against the user's edit.
 */
export async function writeCanonicalMarkdown(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  doc: Pick<Document, 'id' | 'mdEdited'>,
  derivedDir: string,
  markdown: string,
): Promise<WriteCanonicalMarkdownResult> {
  await fs.mkdir(derivedDir, { recursive: true });
  const mdPath = join(derivedDir, 'content.md');

  if (doc.mdEdited) {
    await fs.writeFile(join(derivedDir, 'content.new.md'), markdown, 'utf-8');
    await db.update(documents).set({ mdConflict: true }).where(eq(documents.id, doc.id));
    return { mdPath, outcome: 'conflict' };
  }

  await fs.writeFile(mdPath, markdown, 'utf-8');
  const origPath = join(derivedDir, 'content.orig.md');
  const origExists = await fs
    .access(origPath)
    .then(() => true)
    .catch(() => false);
  if (!origExists) {
    await fs.writeFile(origPath, markdown, 'utf-8');
  }
  return { mdPath, outcome: 'content' };
}
