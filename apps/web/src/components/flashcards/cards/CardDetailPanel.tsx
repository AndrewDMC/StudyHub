'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, Flag, Pause, X } from 'lucide-react';
import type { DeckSummaryDto, FlashcardDto, TopicDto } from '@studyhub/contracts';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { deleteCard, updateCard } from '@/lib/deckEditorClient';
import { cardHistoryLabel, formatCardDueLong } from '@/lib/flashcardMobile';
import { cardSourceHref } from '@/lib/quickReview';
import { invalidateFlashcards } from '../api';
import { useNotify } from '../Notifier';
import { exclusionReason } from '../shared/cardActions';
import { StateDot } from '../shared/StateDot';
import {
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  FOCUS,
  ICON_BTN,
  INPUT,
  LABEL,
  TEXTAREA,
} from '../shared/styles';
import { topicOptions } from './CardFilters';
import { TagInput } from './TagInput';

interface Values {
  front: string;
  back: string;
  hint: string;
  topicId: string;
  deckId: string;
  tags: string[];
}

const fromCard = (c: FlashcardDto): Values => ({
  front: c.front,
  back: c.back,
  hint: c.hint ?? '',
  topicId: c.topicId ?? '',
  deckId: c.deckId,
  tags: c.tags,
});

const same = (a: Values, b: Values) =>
  a.front === b.front &&
  a.back === b.back &&
  a.hint === b.hint &&
  a.topicId === b.topicId &&
  a.deckId === b.deckId &&
  a.tags.join('\n') === b.tags.join('\n');

/**
 * Content of the card detail: summary, exclusion reason, the edit form and the footer actions.
 * The host (inline aside or drawer) provides the frame; `onDirtyChange` feeds its discard guard.
 */
export function CardDetailPanel({
  slug,
  card,
  topics,
  decks,
  inline,
  headingRef,
  onRequestClose,
  onDirtyChange,
  onDeleted,
}: {
  slug: string;
  card: FlashcardDto;
  topics: TopicDto[];
  decks: DeckSummaryDto[];
  /** Inline aside: own header with title and "Chiudi"; the drawer has its own. */
  inline: boolean;
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
  onRequestClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  const [base, setBase] = useState<Values>(() => fromCard(card));
  const [values, setValues] = useState<Values>(() => fromCard(card));
  const [live, setLive] = useState(card);
  const [errors, setErrors] = useState<{ front?: string; back?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const frontRef = useRef<HTMLTextAreaElement>(null);

  const dirty = !same(values, base);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  // The card changes under us (suspend, flag, saved elsewhere): keep the summary fresh, not the form.
  useEffect(() => setLive(card), [card]);

  useEffect(() => {
    if (!inline) frontRef.current?.focus();
  }, [inline]);

  const deck = decks.find((d) => d.id === live.deckId);
  const reason = exclusionReason(live, deck?.status);
  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const save = async () => {
    const next: { front?: string; back?: string } = {};
    if (values.front.trim() === '') next.front = 'Scrivi la domanda.';
    if (values.back.trim() === '') next.back = 'Scrivi la risposta.';
    setErrors(next);
    if (next.front || next.back) return;
    setSaving(true);
    setServerError(null);
    try {
      const saved = await updateCard(slug, live.id, {
        front: values.front,
        back: values.back,
        hint: values.hint.trim() === '' ? null : values.hint,
        topicId: values.topicId || null,
        deckId: values.deckId,
        tags: values.tags,
      });
      const v = fromCard(saved);
      setBase(v);
      setValues(v);
      setLive(saved);
      invalidateFlashcards(qc, slug);
      notify.success('Card salvata.');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Salvataggio non riuscito.');
    } finally {
      setSaving(false);
    }
  };

  const patch = async (p: { suspended?: boolean; flagged?: boolean }, message: string) => {
    setBusy(true);
    try {
      const updated = await updateCard(slug, live.id, p);
      setLive(updated);
      invalidateFlashcards(qc, slug);
      notify.success(message);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Operazione non riuscita.');
    } finally {
      setBusy(false);
    }
  };

  const source = cardSourceHref({ subjectSlug: slug, sourceRef: live.sourceRef });
  const submitOnCtrlEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    }
  };

  const cell = 'flex flex-col gap-0.5 bg-bg-surface px-4 py-3 @[380px]/detail:min-w-0';
  const dt = 'text-xs text-fg-secondary';

  return (
    <div className="@container/detail flex min-w-0 flex-col">
      {inline && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <h2
            id="fc-dett"
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold outline-none"
          >
            Modifica card
          </h2>
          <button type="button" aria-label="Chiudi" onClick={onRequestClose} className={ICON_BTN}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <dl className="grid grid-cols-1 gap-px border-b border-border bg-border @[380px]/detail:grid-cols-3">
        <div className={cell}>
          <dt className={dt}>Stato</dt>
          <dd>
            <StateDot card={live} />
          </dd>
        </div>
        <div className={cell}>
          <dt className={dt}>Prossimo ripasso</dt>
          <dd className="text-[13px]">{reason ? 'esclusa' : formatCardDueLong(live)}</dd>
        </div>
        <div className={cell}>
          <dt className={dt}>Storico</dt>
          <dd className="text-[13px]">{cardHistoryLabel(live.reps ?? 0, live.lapses ?? 0)}</dd>
        </div>
      </dl>

      {reason && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-5 py-2.5 text-[13px]">
          {reason === 'flagged' && (
            <>
              <span className="inline-flex items-center gap-1.5 text-danger">
                <Flag className="size-3.5" aria-hidden="true" />
                Segnalata · esclusa dal ripasso
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void patch(
                    { flagged: false },
                    deck && deck.status !== 'approved'
                      ? 'Card rimessa nel ripasso, ma il mazzo non è ancora approvato.'
                      : 'Card rimessa nel ripasso.',
                  )
                }
                className={BTN_SECONDARY}
              >
                Rimetti nel ripasso
              </button>
            </>
          )}
          {reason === 'suspended' && (
            <span className="inline-flex items-center gap-1.5 text-fg-secondary">
              <Pause className="size-3.5" aria-hidden="true" />
              Sospesa · esclusa dal ripasso
            </span>
          )}
          {reason === 'deck' && deck && (
            <>
              <span className="text-fg-secondary">
                Il mazzo «{deck.title}» non è approvato · esclusa dal ripasso
              </span>
              {deck.status === 'draft' && (
                <Link
                  href={`/materie/${slug}/artifacts/${deck.id}`}
                  className="text-accent-hover underline"
                >
                  Rivedi e approva
                </Link>
              )}
            </>
          )}
        </div>
      )}

      <form
        noValidate
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className={LABEL}>
          Domanda
          <textarea
            ref={frontRef}
            rows={2}
            value={values.front}
            aria-invalid={errors.front ? true : undefined}
            aria-describedby={errors.front ? 'fc-front-err' : undefined}
            onChange={(e) => set('front', e.target.value)}
            onKeyDown={submitOnCtrlEnter}
            className={TEXTAREA}
          />
          {errors.front && (
            <span id="fc-front-err" className="text-xs text-danger">
              {errors.front}
            </span>
          )}
        </label>
        <label className={LABEL}>
          Risposta
          <textarea
            rows={4}
            value={values.back}
            aria-invalid={errors.back ? true : undefined}
            aria-describedby={errors.back ? 'fc-back-err' : undefined}
            onChange={(e) => set('back', e.target.value)}
            onKeyDown={submitOnCtrlEnter}
            className={TEXTAREA}
          />
          {errors.back && (
            <span id="fc-back-err" className="text-xs text-danger">
              {errors.back}
            </span>
          )}
        </label>
        <p className="-mt-2 text-xs text-fg-secondary">
          Puoi usare $LaTeX$, cloze (c1::…) e immagini.
        </p>
        <label className={LABEL}>
          <span>
            Suggerimento <span className="text-fg-secondary">(facoltativo)</span>
          </span>
          <input
            value={values.hint}
            placeholder="Un aiuto che compare prima della risposta"
            onChange={(e) => set('hint', e.target.value)}
            className={INPUT}
          />
        </label>
        <div className="grid grid-cols-1 gap-4 @[380px]/detail:grid-cols-2">
          <label className={LABEL}>
            Argomento
            <select
              value={values.topicId}
              onChange={(e) => set('topicId', e.target.value)}
              className={INPUT}
            >
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
            <select
              value={values.deckId}
              onChange={(e) => set('deckId', e.target.value)}
              className={INPUT}
            >
              {decks
                .filter((d) => d.status === 'approved' || d.id === values.deckId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                    {d.status === 'draft'
                      ? ' · bozza'
                      : d.status === 'archived'
                        ? ' · archiviato'
                        : ''}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <TagInput value={values.tags} onChange={(t) => set('tags', t)} />

        {live.sourceRef && (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] bg-bg-inset px-3 py-2.5 text-[13px] text-fg-secondary">
            <FileText className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">
              {live.sourceRef.docTitle ? `Da “${live.sourceRef.docTitle}”` : 'Da un documento'}
              {live.sourceRef.page ? `, pagina ${live.sourceRef.page}` : ''}
            </span>
            {source && (
              <a
                href={source}
                className={`inline-flex min-h-10 items-center text-accent-hover hover:underline ${FOCUS}`}
              >
                Apri la fonte
              </a>
            )}
          </div>
        )}

        {serverError && (
          <p role="alert" className="text-[13px] text-danger">
            {serverError}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={!dirty || saving} className={BTN_PRIMARY}>
            {saving ? 'Salvo…' : 'Salva'}
          </button>
          <button type="button" onClick={onRequestClose} className={BTN_GHOST}>
            Annulla
          </button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3.5">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void patch(
              { suspended: !live.suspended },
              live.suspended ? 'Card riattivata.' : 'Card sospesa.',
            )
          }
          className={BTN_SECONDARY}
        >
          <Pause className="size-4" aria-hidden="true" />
          {live.suspended ? 'Riattiva' : 'Sospendi'}
        </button>
        <p className="min-w-40 flex-1 text-xs text-fg-secondary">
          {live.suspended
            ? 'Questa card è sospesa e non compare nel ripasso.'
            : 'Non comparirà nel ripasso finché non la riattivi.'}
        </p>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className={`${BTN_GHOST} text-danger`}
        >
          Elimina card
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Eliminare questa card?"
        description="L'azione non è reversibile."
        confirmLabel="Elimina"
        onConfirm={async () => {
          await deleteCard(slug, live.id);
          invalidateFlashcards(qc, slug);
          notify.success('Card eliminata.');
          onDeleted();
        }}
      />
    </div>
  );
}
