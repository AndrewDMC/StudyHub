'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TopicDto } from '@studyhub/contracts';
import { createCard, createDeck, fetchDecks, importDeck, mergeDecks } from '@/lib/deckEditorClient';

const INPUT =
  'rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-xs text-fg-primary';

/**
 * Deck-level tools for the Flashcard tab (docs/fasi/F4-flashcard.md "Editor deck"): create a card
 * by hand, create an empty deck, merge two decks. Per-card editing lives in the list below it.
 */
export function DeckToolsPanel({
  subjectSlug,
  topics,
}: {
  subjectSlug: string;
  topics: TopicDto[];
}) {
  const queryClient = useQueryClient();
  const decksQuery = useQuery({
    queryKey: ['decks', subjectSlug],
    queryFn: () => fetchDecks(subjectSlug),
  });
  const decks = decksQuery.data ?? [];

  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [deckId, setDeckId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [tags, setTags] = useState('');
  const [newDeckTitle, setNewDeckTitle] = useState('');
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [importTarget, setImportTarget] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['flashcard-list', subjectSlug] });
    void queryClient.invalidateQueries({ queryKey: ['decks', subjectSlug] });
    void queryClient.invalidateQueries({ queryKey: ['artifacts', subjectSlug] });
    void queryClient.invalidateQueries({ queryKey: ['flashcard-tags', subjectSlug] });
  };

  const createCardMutation = useMutation({
    mutationFn: () =>
      createCard(subjectSlug, {
        deckId: deckId || decks[0]!.id,
        type: 'basic',
        front,
        back,
        topicId: topicId || null,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      setFront('');
      setBack('');
      setNotice('Card creata.');
      refresh();
    },
  });

  const createDeckMutation = useMutation({
    mutationFn: () => createDeck(subjectSlug, newDeckTitle),
    onSuccess: (deck) => {
      setNewDeckTitle('');
      setDeckId(deck.id);
      setNotice(`Mazzo “${deck.title}” creato.`);
      refresh();
    },
  });

  const mergeMutation = useMutation({
    mutationFn: () => mergeDecks(subjectSlug, mergeSource, mergeTarget),
    onSuccess: (moved) => {
      setMergeSource('');
      setMergeTarget('');
      setNotice(`${moved} card spostate: mazzi uniti.`);
      refresh();
    },
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => importDeck(subjectSlug, file, importTarget || undefined),
    onSuccess: (res) => {
      if (fileRef.current) fileRef.current.value = '';
      const extra = [
        res.duplicates > 0 ? `${res.duplicates} già presenti (saltate)` : '',
        ...res.warnings,
      ].filter(Boolean);
      setNotice(
        `${res.imported} card importate in “${res.deck.title}”${extra.length ? ` — ${extra.join('; ')}` : ''}.`,
      );
      refresh();
    },
  });

  const error = (createCardMutation.error ??
    createDeckMutation.error ??
    mergeMutation.error ??
    importMutation.error) as Error | null;
  const canCreateCard = decks.length > 0 && front.trim() !== '' && back.trim() !== '';

  return (
    <details className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3">
      <summary className="cursor-pointer px-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
        Editor mazzi
      </summary>

      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (canCreateCard) createCardMutation.mutate();
          }}
        >
          <h3 className="text-xs font-medium text-fg-secondary">Nuova card</h3>
          {decks.length === 0 ? (
            <p className="text-xs text-fg-muted">
              Nessun mazzo: creane uno qui a destra, poi aggiungi le card.
            </p>
          ) : (
            <>
              <textarea
                value={front}
                onChange={(e) => setFront(e.target.value)}
                placeholder="Fronte (supporta $LaTeX$, {{c1::cloze}}, ![img](url))"
                rows={2}
                className={`${INPUT} w-full`}
              />
              <textarea
                value={back}
                onChange={(e) => setBack(e.target.value)}
                placeholder="Retro"
                rows={2}
                className={`${INPUT} w-full`}
              />
              <div className="flex flex-wrap gap-2">
                <select
                  value={deckId || decks[0]!.id}
                  onChange={(e) => setDeckId(e.target.value)}
                  aria-label="Mazzo"
                  className={INPUT}
                >
                  {decks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
                <select
                  value={topicId}
                  onChange={(e) => setTopicId(e.target.value)}
                  aria-label="Argomento"
                  className={INPUT}
                >
                  <option value="">Nessun argomento</option>
                  {topics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="tag, separati da virgola"
                  aria-label="Tag"
                  className={`${INPUT} min-w-40 flex-1`}
                />
              </div>
              <button
                type="submit"
                disabled={!canCreateCard || createCardMutation.isPending}
                className="rounded-[var(--radius-control)] bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                Aggiungi card
              </button>
            </>
          )}
        </form>

        <div className="space-y-4">
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newDeckTitle.trim()) createDeckMutation.mutate();
            }}
          >
            <h3 className="text-xs font-medium text-fg-secondary">Nuovo mazzo</h3>
            <div className="flex gap-2">
              <input
                value={newDeckTitle}
                onChange={(e) => setNewDeckTitle(e.target.value)}
                placeholder="Titolo del mazzo"
                aria-label="Titolo del mazzo"
                className={`${INPUT} flex-1`}
              />
              <button
                type="submit"
                disabled={!newDeckTitle.trim() || createDeckMutation.isPending}
                className="rounded-[var(--radius-control)] border border-border px-3 py-1 text-xs text-fg-secondary hover:text-fg-primary disabled:opacity-50"
              >
                Crea
              </button>
            </div>
          </form>

          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (mergeSource && mergeTarget && mergeSource !== mergeTarget) mergeMutation.mutate();
            }}
          >
            <h3 className="text-xs font-medium text-fg-secondary">Unisci mazzi</h3>
            <div className="flex flex-wrap gap-2">
              <select
                value={mergeSource}
                onChange={(e) => setMergeSource(e.target.value)}
                aria-label="Mazzo da unire"
                className={INPUT}
              >
                <option value="">Sposta tutte le card di…</option>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                    {d.status === 'draft' ? ' (bozza)' : ''}
                  </option>
                ))}
              </select>
              <select
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                aria-label="Mazzo di destinazione"
                className={INPUT}
              >
                <option value="">…dentro</option>
                {decks
                  .filter((d) => d.id !== mergeSource)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                      {d.status === 'draft' ? ' (bozza)' : ''}
                    </option>
                  ))}
              </select>
              <button
                type="submit"
                disabled={!mergeSource || !mergeTarget || mergeMutation.isPending}
                className="rounded-[var(--radius-control)] border border-border px-3 py-1 text-xs text-fg-secondary hover:text-fg-primary disabled:opacity-50"
              >
                Unisci
              </button>
            </div>
            <p className="text-[11px] text-fg-muted">
              Il mazzo di partenza sparisce; lo stato di ripasso delle card resta intatto.
            </p>
          </form>
        </div>
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <h3 className="mb-2 text-xs font-medium text-fg-secondary">Importa / esporta</h3>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const file = fileRef.current?.files?.[0];
            if (file) importMutation.mutate(file);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".apkg,.csv,.tsv,.txt"
            aria-label="File da importare"
            className="text-xs text-fg-secondary"
          />
          <select
            value={importTarget}
            onChange={(e) => setImportTarget(e.target.value)}
            aria-label="Mazzo di destinazione dell’importazione"
            className={INPUT}
          >
            <option value="">In un nuovo mazzo</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                Dentro “{d.title}”
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={importMutation.isPending}
            className="rounded-[var(--radius-control)] border border-border px-3 py-1 text-xs text-fg-secondary hover:text-fg-primary disabled:opacity-50"
          >
            {importMutation.isPending ? 'Importo…' : 'Importa (.apkg / .csv)'}
          </button>
        </form>
        {decks.length > 0 && (
          <ul className="mt-2 space-y-1">
            {decks.map((d) => (
              <li key={d.id} className="flex items-center gap-3 text-xs text-fg-secondary">
                <span className="min-w-0 flex-1 truncate">{d.title}</span>
                <a
                  href={`/api/subjects/${subjectSlug}/artifacts/${d.id}/export.apkg`}
                  className="text-fg-muted hover:text-fg-primary"
                >
                  Esporta .apkg
                </a>
                <a
                  href={`/api/subjects/${subjectSlug}/artifacts/${d.id}/export.csv`}
                  className="text-fg-muted hover:text-fg-primary"
                >
                  CSV
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-fg-muted">
          L’.apkg porta con sé lo stato di ripasso (FSRS). Il CSV è solo testo: le card ripartono da
          «nuove». Le immagini di un .apkg non vengono importate.
        </p>
      </div>

      {notice && !error && (
        <p role="status" className="mt-2 px-1 text-xs text-ok">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 px-1 text-xs text-danger">
          {error.message}
        </p>
      )}
    </details>
  );
}
