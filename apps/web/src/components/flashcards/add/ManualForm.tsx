'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DeckSummaryDto, TopicDto } from '@studyhub/contracts';
import { createCard } from '@/lib/deckEditorClient';
import { invalidateFlashcards } from '../api';
import { topicOptions } from '../cards/CardFilters';
import { useNotify } from '../Notifier';
import { BTN_PRIMARY, BTN_SECONDARY, INPUT, LABEL, TEXTAREA } from '../shared/styles';

export const FOOTER =
  'flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 max-md:sticky max-md:bottom-0 max-md:-mx-6 max-md:bg-bg-surface max-md:px-6 max-md:pb-[calc(env(safe-area-inset-bottom)+12px)]';

/** "Scrivi a mano": one card at a time, optionally staying open for the next one. */
export function ManualForm({
  slug,
  topics,
  decks,
  decksLoading,
  defaultTopicId,
  defaultDeckId,
  onClose,
  onNeedDeck,
}: {
  slug: string;
  topics: TopicDto[];
  decks: DeckSummaryDto[];
  decksLoading: boolean;
  defaultTopicId: string;
  defaultDeckId: string;
  onClose: () => void;
  onNeedDeck: () => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  const approved = decks.filter((d) => d.status === 'approved');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [topicId, setTopicId] = useState(defaultTopicId);
  // The decks may arrive after the dialog opens: until the user picks one, follow the data.
  const [pickedDeck, setPickedDeck] = useState<string | null>(null);
  const deckId =
    pickedDeck && approved.some((d) => d.id === pickedDeck)
      ? pickedDeck
      : approved.some((d) => d.id === defaultDeckId)
        ? defaultDeckId
        : (approved[0]?.id ?? '');
  const [again, setAgain] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const frontRef = useRef<HTMLTextAreaElement>(null);

  if (decksLoading && approved.length === 0) {
    return (
      <p role="status" className="text-sm text-fg-secondary">
        Caricamento…
      </p>
    );
  }
  if (approved.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-fg-secondary">Non hai ancora un mazzo.</p>
        <button type="button" onClick={onNeedDeck} className={BTN_SECONDARY}>
          Crea un mazzo
        </button>
      </div>
    );
  }

  const submit = async () => {
    if (front.trim() === '' || back.trim() === '') {
      setError(front.trim() === '' ? 'Scrivi la domanda.' : 'Scrivi la risposta.');
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await createCard(slug, { deckId, type: 'basic', front, back, topicId: topicId || null });
      invalidateFlashcards(qc, slug);
      if (again) {
        setFront('');
        setBack('');
        setDone('Card aggiunta.');
        frontRef.current?.focus();
      } else {
        notify.success('Card aggiunta.');
        onClose();
      }
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
        Domanda
        <textarea
          ref={frontRef}
          data-autofocus
          rows={2}
          value={front}
          placeholder="Es. Enunciato del teorema di Rolle"
          onChange={(e) => setFront(e.target.value)}
          className={TEXTAREA}
        />
      </label>
      <label className={LABEL}>
        Risposta
        <textarea
          rows={4}
          value={back}
          onChange={(e) => setBack(e.target.value)}
          className={TEXTAREA}
        />
      </label>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={LABEL}>
          Argomento
          <select value={topicId} onChange={(e) => setTopicId(e.target.value)} className={INPUT}>
            <option value="">Senza argomento</option>
            {topicOptions(topics).map(({ topic, depth }) => (
              <option key={topic.id} value={topic.id}>
                {depth === 1 ? '↳ ' : ''}
                {topic.name}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Mazzo
          <select value={deckId} onChange={(e) => setPickedDeck(e.target.value)} className={INPUT}>
            {approved.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-fg-secondary">
        Puoi usare $LaTeX$, cloze (c1::…) e immagini. Tag e suggerimento si aggiungono dopo, dal
        dettaglio della card.
      </p>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-[13px] text-ok">
          {done}
        </p>
      )}
      <div className={FOOTER}>
        <label className="flex min-h-10 items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={again}
            onChange={(e) => setAgain(e.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          Dopo, scrivine un&apos;altra
        </label>
        <button type="submit" disabled={busy} className={`${BTN_PRIMARY} max-md:h-12`}>
          {busy ? 'Aggiungo…' : 'Aggiungi card'}
        </button>
      </div>
    </form>
  );
}
