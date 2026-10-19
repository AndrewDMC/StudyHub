'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DeckSummaryDto } from '@studyhub/contracts';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { mergeDecks, patchDeck } from '@/lib/deckEditorClient';
import { invalidateFlashcards } from '../api';
import { useNotify } from '../Notifier';
import type { DeckDialogState } from '../shared/deckActions';
import { BTN_PRIMARY, BTN_SECONDARY, INPUT, LABEL } from '../shared/styles';

function RenameDeckDialog({
  slug,
  deck,
  onClose,
}: {
  slug: string;
  deck: DeckSummaryDto;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  const [title, setTitle] = useState(deck.title);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    if (title.trim() === '') {
      setError('Scrivi un nome.');
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await patchDeck(slug, deck.id, { title: title.trim() });
      invalidateFlashcards(qc, slug);
      notify.success('Mazzo rinominato.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rinomina non riuscita.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        hideClose
        className="max-w-sm"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
        }}
      >
        <DialogTitle className="text-base font-semibold">Rinomina mazzo</DialogTitle>
        <DialogDescription className="sr-only">Cambia il nome del mazzo.</DialogDescription>
        <form
          noValidate
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className={LABEL}>
            Nome del mazzo
            <input
              ref={inputRef}
              value={title}
              maxLength={120}
              required
              aria-invalid={error ? true : undefined}
              onChange={(e) => setTitle(e.target.value)}
              className={INPUT}
            />
          </label>
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={BTN_SECONDARY}>
              Annulla
            </button>
            <button type="submit" disabled={busy} className={BTN_PRIMARY}>
              {busy ? 'Salvo…' : 'Salva'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MergeDeckDialog({
  slug,
  deck,
  decks,
  onClose,
}: {
  slug: string;
  deck: DeckSummaryDto;
  decks: DeckSummaryDto[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  const candidates = decks.filter((d) => d.status === 'approved' && d.id !== deck.id);
  const [target, setTarget] = useState(candidates[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    selectRef.current?.focus();
  }, []);

  const merge = async () => {
    setBusy(true);
    setError(null);
    try {
      const moved = await mergeDecks(slug, deck.id, target);
      invalidateFlashcards(qc, slug);
      notify.success(`${moved} card spostate: mazzi uniti.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unione non riuscita.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent hideClose className="max-w-sm">
        <DialogTitle className="text-base font-semibold">
          Unisci «{deck.title}» in un altro mazzo
        </DialogTitle>
        <DialogDescription className="mt-1 text-[13px]">
          Il mazzo di partenza sparisce; lo stato di ripasso delle card resta intatto.
        </DialogDescription>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (target) void merge();
          }}
        >
          {candidates.length === 0 ? (
            <p className="text-[13px] text-fg-secondary">
              Non c&apos;è un altro mazzo in cui unirlo.
            </p>
          ) : (
            <label className={LABEL}>
              Mazzo di destinazione
              <select
                ref={selectRef}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className={INPUT}
              >
                {candidates.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={BTN_SECONDARY}>
              Annulla
            </button>
            <button type="submit" disabled={busy || !target} className={BTN_PRIMARY}>
              {busy ? 'Unisco…' : 'Unisci'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The three dialogs opened from the deck menu (desktop `Menu` and mobile sheet alike). */
export function DeckDialogs({
  slug,
  state,
  decks,
  onClose,
}: {
  slug: string;
  state: DeckDialogState;
  decks: DeckSummaryDto[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  if (!state) return null;
  const { deck } = state;
  if (state.kind === 'rename') {
    return <RenameDeckDialog key={deck.id} slug={slug} deck={deck} onClose={onClose} />;
  }
  if (state.kind === 'merge') {
    return (
      <MergeDeckDialog key={deck.id} slug={slug} deck={deck} decks={decks} onClose={onClose} />
    );
  }
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Archiviare «${deck.title}»?`}
      description={`Le sue ${deck.cardCount} card escono dal ripasso. Puoi ripristinarlo da «Archiviati».`}
      confirmLabel="Archivia mazzo"
      onConfirm={async () => {
        await patchDeck(slug, deck.id, { status: 'archived' });
        invalidateFlashcards(qc, slug);
        notify.success(`Mazzo «${deck.title}» archiviato.`);
      }}
    />
  );
}
