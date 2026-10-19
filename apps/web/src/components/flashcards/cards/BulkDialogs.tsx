'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DeckSummaryDto, TopicDto } from '@studyhub/contracts';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { bulkCards } from '@/lib/deckEditorClient';
import { NO_TOPIC } from '@/lib/deckGroups';
import { invalidateFlashcards } from '../api';
import { useNotify } from '../Notifier';
import { BTN_PRIMARY, BTN_SECONDARY, INPUT, LABEL } from '../shared/styles';
import { topicOptions } from './CardFilters';

export type BulkDialogState =
  | { kind: 'move'; ids: string[]; fields: 'deck' | 'topic' | 'both' }
  | { kind: 'tags'; ids: string[] }
  | { kind: 'delete'; ids: string[] }
  | null;

const KEEP = '';

function MoveCardsDialog({
  slug,
  ids,
  fields,
  topics,
  decks,
  onDone,
  onClose,
}: {
  slug: string;
  ids: string[];
  fields: 'deck' | 'topic' | 'both';
  topics: TopicDto[];
  decks: DeckSummaryDto[];
  onDone: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  const [deckId, setDeckId] = useState(KEEP);
  const [topicId, setTopicId] = useState(KEEP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showDeck = fields !== 'topic';
  const showTopic = fields !== 'deck';
  const title =
    fields === 'deck'
      ? 'Sposta in un altro mazzo'
      : fields === 'topic'
        ? 'Cambia argomento'
        : ids.length === 1
          ? 'Sposta la card'
          : `Sposta ${ids.length} card`;
  const nothing = (!showDeck || deckId === KEEP) && (!showTopic || topicId === KEEP);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      if (showDeck && deckId !== KEEP)
        await bulkCards(slug, { ids, action: { type: 'move', deckId } });
      if (showTopic && topicId !== KEEP) {
        await bulkCards(slug, {
          ids,
          action: { type: 'topic', topicId: topicId === NO_TOPIC ? null : topicId },
        });
      }
      invalidateFlashcards(qc, slug);
      notify.success(ids.length === 1 ? 'Card spostata.' : `${ids.length} card spostate.`);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Spostamento non riuscito.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent hideClose className="max-w-sm">
        <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          Scegli la destinazione delle card.
        </DialogDescription>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!nothing) void apply();
          }}
        >
          {showDeck && (
            <label className={LABEL}>
              Mazzo
              <select value={deckId} onChange={(e) => setDeckId(e.target.value)} className={INPUT}>
                <option value={KEEP}>Non cambiare</option>
                {decks
                  .filter((d) => d.status === 'approved')
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {showTopic && (
            <label className={LABEL}>
              Argomento
              <select
                value={topicId}
                onChange={(e) => setTopicId(e.target.value)}
                className={INPUT}
              >
                <option value={KEEP}>Non cambiare</option>
                <option value={NO_TOPIC}>Senza argomento</option>
                {topicOptions(topics).map(({ topic, depth }) => (
                  <option key={topic.id} value={topic.id}>
                    {depth === 1 ? '↳ ' : ''}
                    {topic.name}
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
            <button type="submit" disabled={busy || nothing} className={BTN_PRIMARY}>
              {busy ? 'Applico…' : 'Applica'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TagCardsDialog({
  slug,
  ids,
  onDone,
  onClose,
}: {
  slug: string;
  ids: string[];
  onDone: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  const [tag, setTag] = useState('');
  const [mode, setMode] = useState<'addTag' | 'removeTag'>('addTag');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = tag.trim().replace(/^#+/, '').trim();

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await bulkCards(slug, { ids, action: { type: mode, tag: clean } });
      invalidateFlashcards(qc, slug);
      notify.success(mode === 'addTag' ? 'Tag aggiunto.' : 'Tag tolto.');
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operazione non riuscita.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent hideClose className="max-w-sm">
        <DialogTitle className="text-base font-semibold">Tag delle card</DialogTitle>
        <DialogDescription className="sr-only">
          Aggiungi o togli un tag alle card selezionate.
        </DialogDescription>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (clean) void apply();
          }}
        >
          <label className={LABEL}>
            Tag
            <input
              value={tag}
              maxLength={40}
              onChange={(e) => setTag(e.target.value)}
              className={INPUT}
            />
          </label>
          <fieldset className="flex gap-4 text-[13px]">
            <legend className="sr-only">Operazione</legend>
            {(
              [
                ['addTag', 'Aggiungi'],
                ['removeTag', 'Togli'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex min-h-10 items-center gap-2">
                <input
                  type="radio"
                  name="tag-mode"
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="size-4 accent-[var(--accent)]"
                />
                {label}
              </label>
            ))}
          </fieldset>
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={BTN_SECONDARY}>
              Annulla
            </button>
            <button type="submit" disabled={busy || !clean} className={BTN_PRIMARY}>
              {busy ? 'Applico…' : 'Applica'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Move / tag / delete dialogs of the card list (single card or selection). */
export function BulkDialogs({
  slug,
  state,
  topics,
  decks,
  onDone,
  onClose,
}: {
  slug: string;
  state: BulkDialogState;
  topics: TopicDto[];
  decks: DeckSummaryDto[];
  /** After a successful action: clear the selection. */
  onDone: (kind: 'move' | 'tags' | 'delete') => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  if (!state) return null;
  if (state.kind === 'move') {
    return (
      <MoveCardsDialog
        slug={slug}
        ids={state.ids}
        fields={state.fields}
        topics={topics}
        decks={decks}
        onDone={() => onDone('move')}
        onClose={onClose}
      />
    );
  }
  if (state.kind === 'tags') {
    return (
      <TagCardsDialog slug={slug} ids={state.ids} onDone={() => onDone('tags')} onClose={onClose} />
    );
  }
  const n = state.ids.length;
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={n === 1 ? 'Eliminare questa card?' : `Eliminare ${n} card?`}
      description="L'azione non è reversibile."
      confirmLabel="Elimina"
      onConfirm={async () => {
        await bulkCards(slug, { ids: state.ids, action: { type: 'delete' } });
        invalidateFlashcards(qc, slug);
        notify.success(n === 1 ? 'Card eliminata.' : `${n} card eliminate.`);
        onDone('delete');
      }}
    />
  );
}
