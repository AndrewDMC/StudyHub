'use client';

import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import type {
  BulkFlashcardsRequest,
  FlashcardDto,
  FlashcardPageDto,
  TopicDto,
} from '@studyhub/contracts';
import { bulkCards, deleteCard, fetchDecks, fetchTags, updateCard } from '@/lib/deckEditorClient';
import { DeckToolsPanel } from './DeckToolsPanel';

interface Filters {
  topicId: string;
  state: string;
  deckId: string;
  tag: string;
  q: string;
  flagged: boolean;
}

async function fetchPage(
  slug: string,
  filters: Filters,
  cursor: string | undefined,
): Promise<FlashcardPageDto> {
  const qs = new URLSearchParams();
  if (filters.topicId) qs.set('topicId', filters.topicId);
  if (filters.state) qs.set('state', filters.state);
  if (filters.deckId) qs.set('deckId', filters.deckId);
  if (filters.tag) qs.set('tag', filters.tag);
  if (filters.q) qs.set('q', filters.q);
  if (filters.flagged) qs.set('flagged', 'true');
  if (cursor) qs.set('cursor', cursor);
  const res = await fetch(`/api/subjects/${slug}/flashcards?${qs.toString()}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare le flashcard');
  return body.page as FlashcardPageDto;
}

const STATE_LABELS: Record<string, string> = {
  new: 'Nuova',
  learning: 'In apprendimento',
  review: 'In ripasso',
  relearning: 'Da rinforzare',
};

const SELECT =
  'rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-xs text-fg-primary';
const LINK_BTN = 'shrink-0 text-[11px] text-fg-muted hover:text-fg-primary disabled:opacity-50';

/** Debounces a fast-changing value (the search box) so each keystroke isn't a request. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Flashcard list + deck editor (docs/fasi/F4-flashcard.md "Editor deck": crea/modifica/sposta/
 * elimina card, merge di deck, tag). Virtualized (`@tanstack/react-virtual`) so a deck of
 * thousands stays reactive — only the rows in (or near) the visible window are mounted, cursor
 * pages load lazily as the user scrolls near the end.
 */
export function FlashcardListPanel({
  subjectSlug,
  topics,
}: {
  subjectSlug: string;
  topics: TopicDto[];
}) {
  const [filters, setFilters] = useState<Filters>({
    topicId: '',
    state: '',
    deckId: '',
    tag: '',
    q: '',
    flagged: false,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const parentRef = useRef<HTMLDivElement>(null);

  const debouncedQ = useDebounced(filters.q, 250);
  const effective = { ...filters, q: debouncedQ };

  const query = useInfiniteQuery({
    queryKey: ['flashcard-list', subjectSlug, effective],
    queryFn: ({ pageParam }) => fetchPage(subjectSlug, effective, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const decksQuery = useQuery({
    queryKey: ['decks', subjectSlug],
    queryFn: () => fetchDecks(subjectSlug),
  });
  const tagsQuery = useQuery({
    queryKey: ['flashcard-tags', subjectSlug],
    queryFn: () => fetchTags(subjectSlug),
  });
  const decks = decksQuery.data ?? [];
  const deckTitle = (id: string) => decks.find((d) => d.id === id)?.title ?? '—';
  const topicName = (id: string | null) => topics.find((t) => t.id === id)?.name ?? null;

  // A change in the filters (or after a bulk action) can drop cards that were selected.
  const cards = query.data?.pages.flatMap((p) => p.items) ?? [];
  const visibleIds = new Set(cards.map((c) => c.id));
  const activeSelection = [...selected].filter((id) => visibleIds.has(id));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['flashcard-list', subjectSlug] });
    void queryClient.invalidateQueries({ queryKey: ['flashcard-tags', subjectSlug] });
    void queryClient.invalidateQueries({ queryKey: ['flashcard-stats', subjectSlug] });
    void queryClient.invalidateQueries({ queryKey: ['stats', subjectSlug] });
  };

  const updateMutation = useMutation({
    mutationFn: ({ cardId, patch }: { cardId: string; patch: Parameters<typeof updateCard>[2] }) =>
      updateCard(subjectSlug, cardId, patch),
    onSuccess: () => {
      setEditingId(null);
      refresh();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (cardId: string) => deleteCard(subjectSlug, cardId),
    onSuccess: refresh,
  });
  const bulkMutation = useMutation({
    mutationFn: (action: BulkFlashcardsRequest['action']) =>
      bulkCards(subjectSlug, { ids: activeSelection, action }),
    onSuccess: () => {
      setSelected(new Set());
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['decks', subjectSlug] });
    },
  });

  // One extra virtual row for the "carica altre" sentinel, only when there's actually more to load.
  const rowCount = cards.length + (query.hasNextPage ? 1 : 0);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 84,
    overscan: 10,
  });

  // Auto-load the next page once the sentinel row scrolls into (or near) view.
  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastItem = virtualItems[virtualItems.length - 1];
  if (
    lastItem &&
    lastItem.index >= cards.length &&
    query.hasNextPage &&
    !query.isFetchingNextPage
  ) {
    void query.fetchNextPage();
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const mutationError = (updateMutation.error ??
    deleteMutation.error ??
    bulkMutation.error) as Error | null;
  const busy = updateMutation.isPending || deleteMutation.isPending || bulkMutation.isPending;

  return (
    <div className="space-y-3">
      <DeckToolsPanel subjectSlug={subjectSlug} topics={topics} />

      <div className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">Flashcard</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              placeholder="Cerca nel testo…"
              aria-label="Cerca nelle card"
              className={`${SELECT} w-40`}
            />
            <select
              value={filters.topicId}
              onChange={(e) => setFilters({ ...filters, topicId: e.target.value })}
              aria-label="Filtra per argomento"
              className={SELECT}
            >
              <option value="">Tutti gli argomenti</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <select
              value={filters.deckId}
              onChange={(e) => setFilters({ ...filters, deckId: e.target.value })}
              aria-label="Filtra per mazzo"
              className={SELECT}
            >
              <option value="">Tutti i mazzi</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
            <select
              value={filters.state}
              onChange={(e) => setFilters({ ...filters, state: e.target.value })}
              aria-label="Filtra per stato"
              className={SELECT}
            >
              <option value="">Tutti gli stati</option>
              {Object.entries(STATE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <select
              value={filters.tag}
              onChange={(e) => setFilters({ ...filters, tag: e.target.value })}
              aria-label="Filtra per tag"
              className={SELECT}
            >
              <option value="">Tutti i tag</option>
              {(tagsQuery.data ?? []).map((t) => (
                <option key={t.tag} value={t.tag}>
                  {t.tag} ({t.count})
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-fg-secondary">
              <input
                type="checkbox"
                checked={filters.flagged}
                onChange={(e) => setFilters({ ...filters, flagged: e.target.checked })}
              />
              Segnalate
            </label>
          </div>
        </div>

        {activeSelection.length > 0 && (
          <BulkBar
            count={activeSelection.length}
            decks={decks.map((d) => ({ id: d.id, title: d.title }))}
            topics={topics}
            busy={busy}
            onAction={(action) => bulkMutation.mutate(action)}
            onClear={() => setSelected(new Set())}
          />
        )}

        {query.isLoading && <p className="px-1 text-xs text-fg-muted">Caricamento…</p>}
        {query.isError && (
          <p role="alert" className="px-1 text-xs text-danger">
            {(query.error as Error).message}
          </p>
        )}
        {query.isSuccess && cards.length === 0 && (
          <p className="px-1 text-xs text-fg-muted">Nessuna flashcard corrisponde ai filtri.</p>
        )}

        {query.isSuccess && cards.length > 0 && (
          <div ref={parentRef} className="max-h-[70vh] overflow-y-auto">
            <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
              {virtualItems.map((virtualRow) => {
                const rowStyle = {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                } as const;
                if (virtualRow.index >= cards.length) {
                  return (
                    <div
                      key="sentinel"
                      style={rowStyle}
                      className="px-1 py-3 text-center text-xs text-fg-muted"
                    >
                      Caricamento altre…
                    </div>
                  );
                }
                const card = cards[virtualRow.index]!;
                return (
                  <div
                    key={card.id}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    style={rowStyle}
                    className="border-b border-border px-1 py-2"
                  >
                    {editingId === card.id ? (
                      <CardEditForm
                        card={card}
                        topics={topics}
                        decks={decks.map((d) => ({ id: d.id, title: d.title }))}
                        busy={updateMutation.isPending}
                        onCancel={() => setEditingId(null)}
                        onSave={(patch) => updateMutation.mutate({ cardId: card.id, patch })}
                      />
                    ) : (
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selected.has(card.id)}
                          onChange={() => toggle(card.id)}
                          aria-label="Seleziona card"
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-fg-primary">{card.front}</p>
                          <p className="mt-0.5 truncate text-xs text-fg-muted">{card.back}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge>
                              {STATE_LABELS[card.state]}
                              {card.suspended ? ' · sospesa' : ''}
                            </Badge>
                            {card.flaggedAt && <Badge tone="danger">segnalata</Badge>}
                            <Badge>{deckTitle(card.deckId)}</Badge>
                            {topicName(card.topicId) && <Badge>{topicName(card.topicId)}</Badge>}
                            {card.tags.map((t) => (
                              <Badge key={t}>#{t}</Badge>
                            ))}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          <button
                            type="button"
                            onClick={() => setEditingId(card.id)}
                            disabled={busy}
                            className={LINK_BTN}
                          >
                            Modifica
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateMutation.mutate({
                                cardId: card.id,
                                patch: { suspended: !card.suspended },
                              })
                            }
                            disabled={busy}
                            className={LINK_BTN}
                          >
                            {card.suspended ? 'Riattiva' : 'Sospendi'}
                          </button>
                          {card.flaggedAt && (
                            <button
                              type="button"
                              onClick={() =>
                                updateMutation.mutate({
                                  cardId: card.id,
                                  patch: { flagged: false },
                                })
                              }
                              disabled={busy}
                              className={LINK_BTN}
                            >
                              Rimuovi segnalazione
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm('Eliminare questa card? L’azione non è reversibile.')
                              )
                                deleteMutation.mutate(card.id);
                            }}
                            disabled={busy}
                            className={`${LINK_BTN} hover:!text-danger`}
                          >
                            Elimina
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {mutationError && (
          <p role="alert" className="mt-1 px-1 text-xs text-danger">
            {mutationError.message}
          </p>
        )}
      </div>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: 'danger' }) {
  return (
    <span
      className={`inline-block rounded-full border px-1.5 py-0.5 text-[10px] ${
        tone === 'danger' ? 'border-danger text-danger' : 'border-border text-fg-secondary'
      }`}
    >
      {children}
    </span>
  );
}

function BulkBar({
  count,
  decks,
  topics,
  busy,
  onAction,
  onClear,
}: {
  count: number;
  decks: { id: string; title: string }[];
  topics: TopicDto[];
  busy: boolean;
  onAction: (action: BulkFlashcardsRequest['action']) => void;
  onClear: () => void;
}) {
  const [tag, setTag] = useState('');
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] bg-accent-subtle px-2 py-1.5 text-xs">
      <span className="font-medium text-fg-primary">{count} selezionate</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => onAction({ type: 'suspend', suspended: true })}
        className={LINK_BTN}
      >
        Sospendi
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onAction({ type: 'suspend', suspended: false })}
        className={LINK_BTN}
      >
        Riattiva
      </button>
      <select
        aria-label="Sposta nel mazzo"
        value=""
        disabled={busy}
        onChange={(e) => e.target.value && onAction({ type: 'move', deckId: e.target.value })}
        className={SELECT}
      >
        <option value="">Sposta nel mazzo…</option>
        {decks.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title}
          </option>
        ))}
      </select>
      <select
        aria-label="Assegna argomento"
        value=""
        disabled={busy}
        onChange={(e) =>
          e.target.value &&
          onAction({ type: 'topic', topicId: e.target.value === '__none' ? null : e.target.value })
        }
        className={SELECT}
      >
        <option value="">Assegna argomento…</option>
        <option value="__none">Nessun argomento</option>
        {topics.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <input
        value={tag}
        onChange={(e) => setTag(e.target.value)}
        placeholder="tag"
        aria-label="Tag da applicare"
        className={`${SELECT} w-24`}
      />
      <button
        type="button"
        disabled={busy || !tag.trim()}
        onClick={() => onAction({ type: 'addTag', tag })}
        className={LINK_BTN}
      >
        + tag
      </button>
      <button
        type="button"
        disabled={busy || !tag.trim()}
        onClick={() => onAction({ type: 'removeTag', tag })}
        className={LINK_BTN}
      >
        − tag
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (window.confirm(`Eliminare ${count} card? L’azione non è reversibile.`))
            onAction({ type: 'delete' });
        }}
        className={`${LINK_BTN} hover:!text-danger`}
      >
        Elimina
      </button>
      <button type="button" onClick={onClear} className={`${LINK_BTN} ml-auto`}>
        Deseleziona
      </button>
    </div>
  );
}

function CardEditForm({
  card,
  topics,
  decks,
  busy,
  onSave,
  onCancel,
}: {
  card: FlashcardDto;
  topics: TopicDto[];
  decks: { id: string; title: string }[];
  busy: boolean;
  onSave: (patch: {
    front: string;
    back: string;
    hint: string | null;
    topicId: string | null;
    deckId: string;
    tags: string[];
  }) => void;
  onCancel: () => void;
}) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [hint, setHint] = useState(card.hint ?? '');
  const [topicId, setTopicId] = useState(card.topicId ?? '');
  const [deckId, setDeckId] = useState(card.deckId);
  const [tags, setTags] = useState(card.tags.join(', '));

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          front,
          back,
          hint: hint.trim() || null,
          topicId: topicId || null,
          deckId,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <textarea
        value={front}
        onChange={(e) => setFront(e.target.value)}
        rows={2}
        aria-label="Fronte"
        className={`${SELECT} w-full`}
      />
      <textarea
        value={back}
        onChange={(e) => setBack(e.target.value)}
        rows={2}
        aria-label="Retro"
        className={`${SELECT} w-full`}
      />
      <input
        value={hint}
        onChange={(e) => setHint(e.target.value)}
        placeholder="Suggerimento (opzionale)"
        aria-label="Suggerimento"
        className={`${SELECT} w-full`}
      />
      <div className="flex flex-wrap gap-2">
        <select
          value={deckId}
          onChange={(e) => setDeckId(e.target.value)}
          aria-label="Mazzo"
          className={SELECT}
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
          className={SELECT}
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
          className={`${SELECT} min-w-40 flex-1`}
        />
      </div>
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy || !front.trim() || !back.trim()}
          className="rounded-[var(--radius-control)] bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Salva
        </button>
        <button type="button" onClick={onCancel} className={LINK_BTN}>
          Annulla
        </button>
      </div>
    </form>
  );
}
