'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ATTEMPT_PHOTO_MAX_PER_ITEM, ATTEMPT_PHOTO_MIMES } from '@studyhub/core/browser';
import type { AttemptAnswerPhotoDto } from '@studyhub/contracts';
import { compressPhoto, PhotoCompressError } from './photoCompress';

export type PhotoStatus = 'uploading' | 'ready' | 'error' | 'removing';

export type PhotoEntry = {
  localId: string;
  status: PhotoStatus;
  /** Blob URL while uploading, the server URL afterwards. */
  previewUrl: string;
  photo?: AttemptAnswerPhotoDto | undefined;
  /** Kept in memory for "Riprova" after a failed upload. */
  file?: File | undefined;
  error?: string | undefined;
};

export type PhotosByItem = Record<string, PhotoEntry[]>;

/** Phone photos are far bigger than the server limit; they are shrunk before the upload. */
export const PHOTO_RAW_MAX_BYTES = 30 * 1024 * 1024;
// HEIC/HEIF are not accepted by the server, but the browser may decode them for the compression.
const PICKABLE_MIMES: readonly string[] = [...ATTEMPT_PHOTO_MIMES, 'image/heic', 'image/heif'];

export const PHOTO_ERRORS = {
  size: 'La foto è troppo grande (massimo 30 MB).',
  format: 'Formato non supportato: usa JPEG o PNG.',
  limit: `Massimo ${ATTEMPT_PHOTO_MAX_PER_ITEM} foto per esercizio.`,
  upload: 'Caricamento non riuscito. Riprova.',
  remove: 'Impossibile rimuovere la foto.',
} as const;

/** Client-side check before the POST (the server stays the authority); returns the message or null. */
export function validatePhotoFile(file: { size: number; type: string }): string | null {
  if (file.size > PHOTO_RAW_MAX_BYTES) return PHOTO_ERRORS.size;
  if (file.type !== '' && !PICKABLE_MIMES.includes(file.type)) return PHOTO_ERRORS.format;
  return null;
}

/** Photos that take a slot of the per-exercise limit. */
export function photoSlotCount(entries: PhotoEntry[] | undefined): number {
  return (entries ?? []).filter((e) => e.status !== 'error').length;
}

function readyEntry(photo: AttemptAnswerPhotoDto): PhotoEntry {
  return { localId: photo.id, status: 'ready', previewUrl: photo.url, photo };
}

async function serverMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Photos of the handwritten sheet for the mobile exam. Local state (not React Query): the
 * initial photos come with the attempt (`AttemptDto.photos`), uploads and removals go straight
 * to `.../attempts/:id/items/:itemId/photos`.
 */
export function useAttemptPhotos({
  slug,
  attemptId,
  initial,
}: {
  slug: string;
  /** Undefined until the attempt is loaded. */
  attemptId: string | undefined;
  initial: Record<string, AttemptAnswerPhotoDto[]> | undefined;
}) {
  const [photosByItem, setPhotosByItem] = useState<PhotosByItem>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [announce, setAnnounce] = useState('');
  const store = useRef<PhotosByItem>({});
  const queues = useRef<Record<string, Promise<void>>>({});
  const blobUrls = useRef(new Set<string>());
  const seededFor = useRef<string | undefined>(undefined);
  const counter = useRef(0);

  const commit = useCallback((next: PhotosByItem) => {
    store.current = next;
    setPhotosByItem(next);
  }, []);

  const patch = useCallback(
    (itemId: string, fn: (entries: PhotoEntry[]) => PhotoEntry[]) => {
      commit({ ...store.current, [itemId]: fn(store.current[itemId] ?? []) });
    },
    [commit],
  );

  const setRowError = useCallback((itemId: string, message: string | null) => {
    setRowErrors((prev) => {
      const next = { ...prev };
      if (message) next[itemId] = message;
      else delete next[itemId];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!attemptId || seededFor.current === attemptId) return;
    seededFor.current = attemptId;
    const seeded: PhotosByItem = {};
    for (const [itemId, list] of Object.entries(initial ?? {})) {
      if (list.length > 0) seeded[itemId] = list.map(readyEntry);
    }
    commit(seeded);
  }, [attemptId, initial, commit]);

  useEffect(() => {
    const urls = blobUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const base = attemptId ? `/api/subjects/${slug}/attempts/${attemptId}/items` : null;

  const runUpload = useCallback(
    async (itemId: string, localId: string, file: File) => {
      if (!base) return;
      const setEntry = (fn: (e: PhotoEntry) => PhotoEntry) =>
        patch(itemId, (list) => list.map((e) => (e.localId === localId ? fn(e) : e)));
      const current = () => store.current[itemId]?.find((e) => e.localId === localId);
      if (!current()) return; // removed locally while queued
      const blobUrl = current()!.previewUrl;
      try {
        let toSend: File;
        try {
          toSend = await compressPhoto(file);
        } catch (err) {
          if (err instanceof PhotoCompressError) {
            // Format / size problems will not go away by retrying: no tile, message on the row.
            if (blobUrls.current.delete(blobUrl)) URL.revokeObjectURL(blobUrl);
            patch(itemId, (list) => list.filter((e) => e.localId !== localId));
            setRowError(itemId, err.message);
            return;
          }
          setEntry((e) => ({ ...e, status: 'error', error: PHOTO_ERRORS.upload, file }));
          return;
        }
        const form = new FormData();
        form.append('file', toSend);
        const res = await fetch(`${base}/${itemId}/photos`, { method: 'POST', body: form });
        if (!res.ok) {
          const message = await serverMessage(res, PHOTO_ERRORS.upload);
          setEntry((e) => ({ ...e, status: 'error', error: message, file }));
          return;
        }
        const { photo } = (await res.json()) as { photo: AttemptAnswerPhotoDto };
        setEntry((e) => ({
          ...e,
          status: 'ready',
          previewUrl: photo.url,
          photo,
          file: undefined,
          error: undefined,
        }));
        if (blobUrls.current.delete(blobUrl)) URL.revokeObjectURL(blobUrl);
        setRowError(itemId, null);
        setAnnounce('Foto aggiunta');
      } catch {
        setEntry((e) => ({ ...e, status: 'error', error: PHOTO_ERRORS.upload, file }));
      }
    },
    [base, patch, setRowError],
  );

  const enqueue = useCallback(
    (itemId: string, localId: string, file: File) => {
      const prev = queues.current[itemId] ?? Promise.resolve();
      queues.current[itemId] = prev.then(() => runUpload(itemId, localId, file));
    },
    [runUpload],
  );

  const upload = useCallback(
    (itemId: string, files: FileList | File[] | null) => {
      if (!base || !files) return;
      setRowError(itemId, null);
      for (const file of Array.from(files)) {
        if (photoSlotCount(store.current[itemId]) >= ATTEMPT_PHOTO_MAX_PER_ITEM) {
          setRowError(itemId, PHOTO_ERRORS.limit);
          break;
        }
        const invalid = validatePhotoFile(file);
        if (invalid) {
          setRowError(itemId, invalid);
          continue;
        }
        const previewUrl = URL.createObjectURL(file);
        blobUrls.current.add(previewUrl);
        const localId = `local-${++counter.current}`;
        patch(itemId, (list) => [...list, { localId, status: 'uploading', previewUrl }]);
        enqueue(itemId, localId, file);
      }
    },
    [base, patch, enqueue, setRowError],
  );

  const retry = useCallback(
    (itemId: string, localId: string) => {
      const entry = store.current[itemId]?.find((e) => e.localId === localId);
      if (!entry?.file) return;
      if (photoSlotCount(store.current[itemId]) >= ATTEMPT_PHOTO_MAX_PER_ITEM) {
        setRowError(itemId, PHOTO_ERRORS.limit);
        return;
      }
      const file = entry.file;
      setRowError(itemId, null);
      patch(itemId, (list) =>
        list.map((e) =>
          e.localId === localId ? { ...e, status: 'uploading', error: undefined } : e,
        ),
      );
      enqueue(itemId, localId, file);
    },
    [patch, enqueue, setRowError],
  );

  const remove = useCallback(
    async (itemId: string, entry: PhotoEntry) => {
      const drop = () => {
        if (blobUrls.current.delete(entry.previewUrl)) URL.revokeObjectURL(entry.previewUrl);
        patch(itemId, (list) => list.filter((e) => e.localId !== entry.localId));
      };
      // Failed upload: nothing on the server, just drop the local tile.
      if (!entry.photo || !base) {
        drop();
        return;
      }
      const setStatus = (status: PhotoStatus) =>
        patch(itemId, (list) =>
          list.map((e) => (e.localId === entry.localId ? { ...e, status } : e)),
        );
      setRowError(itemId, null);
      setStatus('removing');
      try {
        const res = await fetch(`${base}/${itemId}/photos/${entry.photo.id}`, {
          method: 'DELETE',
        });
        if (!res.ok && res.status !== 404) {
          setStatus('ready');
          setRowError(itemId, await serverMessage(res, PHOTO_ERRORS.remove));
          return;
        }
        drop();
        setAnnounce('Foto rimossa');
      } catch {
        setStatus('ready');
        setRowError(itemId, PHOTO_ERRORS.remove);
      }
    },
    [base, patch, setRowError],
  );

  const uploadingCount = Object.values(photosByItem).reduce(
    (n, list) => n + list.filter((e) => e.status === 'uploading').length,
    0,
  );

  return {
    photosByItem,
    rowErrors,
    upload,
    retry,
    remove,
    uploadingCount,
    announce,
    clearRowError: (itemId: string) => setRowError(itemId, null),
  };
}
