import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { attemptAnswerPhotos, type AttemptAnswerPhotoRow } from '@studyhub/db';
import {
  assertRealpathWithinRoot,
  resolveSubjectPath,
  resolveSubjectSubpath,
} from '@studyhub/core';
import type { AttemptAnswerPhotoDto } from '@studyhub/contracts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route params come from the URL: anything that is not a UUID can never be an id of ours. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function photoUrl(
  slug: string,
  row: Pick<AttemptAnswerPhotoRow, 'id' | 'attemptId' | 'itemId'>,
) {
  return `/api/subjects/${slug}/attempts/${row.attemptId}/items/${row.itemId}/photos/${row.id}/file`;
}

export function photoToDto(slug: string, row: AttemptAnswerPhotoRow): AttemptAnswerPhotoDto {
  return {
    id: row.id,
    itemId: row.itemId,
    mime: row.mime,
    size: row.size,
    createdAt: row.createdAt.toISOString(),
    transcriptStatus: row.transcriptStatus,
    url: photoUrl(slug, row),
  };
}

export async function loadPhotoRows(
  db: AnyDb,
  attemptId: string,
): Promise<AttemptAnswerPhotoRow[]> {
  return db
    .select()
    .from(attemptAnswerPhotos)
    .where(eq(attemptAnswerPhotos.attemptId, attemptId))
    .orderBy(asc(attemptAnswerPhotos.createdAt), asc(attemptAnswerPhotos.id));
}

/** itemId -> photos (oldest first); items without photos are absent. */
export async function loadPhotoMap(
  db: AnyDb,
  slug: string,
  attemptId: string,
): Promise<Record<string, AttemptAnswerPhotoDto[]>> {
  const out: Record<string, AttemptAnswerPhotoDto[]> = {};
  for (const row of await loadPhotoRows(db, attemptId)) {
    (out[row.itemId] ??= []).push(photoToDto(slug, row));
  }
  return out;
}

/** Subject-relative location of a photo: `.studyhub/attempts/<attemptId>/<photoId>.<ext>`. */
export function photoRelPath(attemptId: string, photoId: string, ext: string): string[] {
  return ['.studyhub', 'attempts', attemptId, `${photoId}.${ext}`];
}

/** Absolute path of a stored photo, validated against the subject folder (lexically and through symlinks). */
export async function resolvePhotoPath(
  dataRoot: string,
  slug: string,
  relPath: string,
): Promise<string> {
  const abs = resolveSubjectSubpath(slug, relPath.split('/'), dataRoot);
  const root = resolveSubjectPath(slug, dataRoot);
  await assertRealpathWithinRoot(dirname(abs), root);
  await assertRealpathWithinRoot(abs, root); // a symlinked file pointing outside the subject
  return abs;
}

export async function removePhotoFiles(dataRoot: string, slug: string, relPaths: string[]) {
  for (const rel of relPaths) {
    try {
      await fs.unlink(await resolvePhotoPath(dataRoot, slug, rel));
    } catch {
      // Already gone (or never written): the row is what mattered.
    }
  }
}
