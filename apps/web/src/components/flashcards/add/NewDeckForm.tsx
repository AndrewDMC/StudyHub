'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createDeck } from '@/lib/deckEditorClient';
import { invalidateFlashcards } from '../api';
import { useNotify } from '../Notifier';
import { BTN_PRIMARY, INPUT, LABEL } from '../shared/styles';
import { FOOTER } from './ManualForm';

/** "Nuovo mazzo vuoto". */
export function NewDeckForm({ slug, onClose }: { slug: string; onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useNotify();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (title.trim() === '') {
      setError('Scrivi un nome.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const deck = await createDeck(slug, title.trim());
      invalidateFlashcards(qc, slug);
      notify.success(`Mazzo «${deck.title}» creato.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Creazione non riuscita.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className={LABEL}>
        Nome del mazzo
        <input
          data-autofocus
          value={title}
          maxLength={120}
          required
          placeholder="Es. Esercizi d'esame"
          onChange={(e) => setTitle(e.target.value)}
          className={INPUT}
        />
      </label>
      <p className="text-[13px] text-fg-secondary">
        Utile per tenere separate card di fonti diverse. Per unire due mazzi usa il menu ⋯ del
        mazzo.
      </p>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className={`${FOOTER} justify-end`}>
        <button type="submit" disabled={busy} className={`${BTN_PRIMARY} max-md:h-12`}>
          {busy ? 'Creo…' : 'Crea mazzo'}
        </button>
      </div>
    </form>
  );
}
