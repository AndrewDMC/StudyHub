'use client';

import { useId, useRef } from 'react';
import { Camera, Images, X } from 'lucide-react';
import { ATTEMPT_PHOTO_MAX_PER_ITEM } from '@studyhub/core/browser';
import { photoSlotCount, type PhotoEntry } from '@/lib/useAttemptPhotos';
import { PhotoImage } from './PhotoImage';

const actionButton =
  'flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-border-strong bg-bg-raised px-4 text-[13px] font-semibold text-fg-primary disabled:opacity-50';

/** Photos of the handwritten sheet for one exercise: capture / gallery, thumbnails, removal. */
export function AnswerPhotos({
  itemId,
  ord,
  entries,
  locked,
  onPick,
  onRetry,
  onRemove,
  rowError,
}: {
  itemId: string;
  ord: number;
  entries: PhotoEntry[];
  locked: boolean;
  onPick: (files: FileList | null) => void;
  onRetry: (localId: string) => void;
  onRemove: (entry: PhotoEntry) => void;
  rowError: string | null;
}) {
  const helpId = useId();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraButtonRef = useRef<HTMLButtonElement>(null);
  const count = photoSlotCount(entries);
  const full = count >= ATTEMPT_PHOTO_MAX_PER_ITEM;
  const help =
    full && !locked
      ? `Massimo ${ATTEMPT_PHOTO_MAX_PER_ITEM} foto per esercizio.`
      : count === 0
        ? 'Facoltativo. Il testo della foto viene letto per la correzione.'
        : `Foto del foglio · ${count} di ${ATTEMPT_PHOTO_MAX_PER_ITEM}. JPEG o PNG: la foto viene ridimensionata prima dell'invio.`;

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    onPick(e.currentTarget.files);
    e.currentTarget.value = '';
  };
  const remove = (entry: PhotoEntry) => {
    onRemove(entry);
    cameraButtonRef.current?.focus();
  };

  return (
    <section
      aria-label="Foto del foglio"
      data-testid="answer-photos"
      data-item-id={itemId}
      className="mt-3 flex flex-col gap-2"
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          ref={cameraButtonRef}
          data-testid="attach-photo"
          disabled={locked || full}
          aria-describedby={helpId}
          onClick={() => cameraRef.current?.click()}
          className={actionButton}
        >
          <Camera className="size-4" aria-hidden="true" />
          Scatta foto
        </button>
        <button
          type="button"
          data-testid="attach-photo-gallery"
          disabled={locked || full}
          aria-describedby={helpId}
          onClick={() => galleryRef.current?.click()}
          className={actionButton}
        >
          <Images className="size-4" aria-hidden="true" />
          Scegli dalla galleria
        </button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          tabIndex={-1}
          data-testid="photo-input"
          onChange={pick}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          tabIndex={-1}
          data-testid="photo-gallery-input"
          onChange={pick}
        />
      </div>
      <p id={helpId} className="text-xs text-fg-muted">
        {help}
      </p>
      {rowError && (
        <p role="alert" className="text-[13px] text-danger">
          {rowError}
        </p>
      )}
      {entries.length > 0 && (
        <ul className="grid grid-cols-2 gap-2">
          {entries.map((entry, i) => (
            <li
              key={entry.localId}
              data-testid="photo-tile"
              data-status={entry.status}
              aria-busy={entry.status === 'uploading' ? 'true' : undefined}
              className={`relative aspect-[4/3] overflow-hidden rounded-[var(--radius-control)] border bg-bg-inset ${
                entry.status === 'error' ? 'border-danger' : 'border-border'
              } ${entry.status === 'removing' ? 'opacity-50' : ''}`}
            >
              <PhotoImage src={entry.previewUrl} alt={`Foto ${i + 1} dell'esercizio ${ord + 1}`} />
              {entry.status === 'uploading' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-bg-base/60 text-xs text-fg-primary">
                  <span
                    aria-hidden="true"
                    className="size-5 animate-spin rounded-full border-2 border-info border-t-transparent motion-reduce:animate-none"
                  />
                  Caricamento…
                </div>
              )}
              {entry.status === 'error' && (
                <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-bg-surface p-1.5">
                  <p role="alert" className="text-xs text-danger">
                    {entry.error}
                  </p>
                  <div className="flex gap-1">
                    {entry.file && (
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => onRetry(entry.localId)}
                        className="min-h-11 flex-1 rounded-[var(--radius-control)] border border-border-strong text-xs font-semibold text-fg-primary disabled:opacity-50"
                      >
                        Riprova
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(entry)}
                      className="min-h-11 flex-1 rounded-[var(--radius-control)] border border-border-strong text-xs text-fg-primary"
                    >
                      Rimuovi
                    </button>
                  </div>
                </div>
              )}
              {entry.status !== 'error' && (
                <button
                  type="button"
                  aria-label={`Rimuovi foto ${i + 1}`}
                  data-testid="photo-remove"
                  disabled={locked || entry.status === 'removing' || entry.status === 'uploading'}
                  onClick={() => remove(entry)}
                  className="absolute right-1 top-1 flex size-11 items-center justify-center rounded-[var(--radius-control)] border border-border-strong bg-bg-surface text-fg-primary disabled:opacity-50"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
