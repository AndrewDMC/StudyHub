'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { FlashcardDto, TopicDto } from '@studyhub/contracts';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SidePanel } from '@/components/ui/side-panel';
import { bulkCards, updateCard } from '@/lib/deckEditorClient';
import { NO_TOPIC } from '@/lib/deckGroups';
import { hasCardFilters, type FlashcardsPatch } from '@/lib/flashcardsView';
import {
  invalidateFlashcards,
  pagesToCards,
  useDebounced,
  useDeckSummaries,
  useFlashcard,
  useFlashcardPages,
  type Filters,
} from '../api';
import { useNotify } from '../Notifier';
import type { CardAction } from '../shared/cardActions';
import { CARD_BOX, SKELETON } from '../shared/styles';
import { useFlashcardsParams } from '../useFlashcardsParams';
import { BulkDialogs, type BulkDialogState } from './BulkDialogs';
import { CardDetailPanel } from './CardDetailPanel';
import { CardFilters } from './CardFilters';
import { CardList } from './CardList';
import { CardSummaryBar } from './CardSummaryBar';
import { SelectionBar } from './SelectionBar';

const WIDE = 672; // @2xl: full rows
const SPLIT = 896; // @4xl: detail next to the list

/** Vista "Card": filters, summary, list, multi-selection and the detail (inline or drawer). */
export function CardsView({
  slug,
  topics,
  onAdd,
}: {
  slug: string;
  topics: TopicDto[];
  onAdd: (mode: 'ai' | 'manual') => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  const { params, replace, push } = useFlashcardsParams(slug);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnRef = useRef<HTMLElement | null>(null);
  const dirtyRef = useRef(false);

  const [width, setWidth] = useState(0);
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<BulkDialogState>(null);
  const [pendingOpen, setPendingOpen] = useState<{
    id: string | null;
    then?: FlashcardsPatch;
  } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const wide = width >= WIDE;
  const split = width >= SPLIT;

  const q = useDebounced(text.trim(), 250);
  const filters: Filters = useMemo(
    () => ({
      topicId: params.argomento ?? '',
      state: params.stato ?? '',
      deckId: params.mazzo ?? '',
      tag: params.tag ?? '',
      q,
      flagged: false,
      excluded: params.escluse,
      sort: params.ordine === 'due' ? 'due' : 'recent',
    }),
    [params.argomento, params.stato, params.mazzo, params.tag, params.escluse, params.ordine, q],
  );
  const filterKey = JSON.stringify(filters);
  useEffect(() => setSelected(new Set()), [filterKey]);

  const pages = useFlashcardPages(slug, filters);
  const cards = pagesToCards(pages.data);
  const total = pages.data?.pages[0]?.total ?? null;
  const decksQuery = useDeckSummaries(slug);
  const decks = useMemo(() => decksQuery.data ?? [], [decksQuery.data]);
  const deckStatus = useMemo(() => new Map(decks.map((d) => [d.id, d.status])), [decks]);

  const filtered = hasCardFilters(params) || q !== '';
  const scope = params.argomento
    ? params.argomento === NO_TOPIC
      ? 'Senza argomento'
      : (topics.find((t) => t.id === params.argomento)?.name ?? null)
    : params.mazzo
      ? (decks.find((d) => d.id === params.mazzo)?.title ?? null)
      : null;

  // ---- detail ----
  const fromList = params.card ? cards.find((c) => c.id === params.card) : undefined;
  const single = useFlashcard(slug, params.card, !fromList && (pages.isSuccess || pages.isError));
  const openCard = fromList ?? single.data ?? null;
  const detailOpen = params.card !== null;
  const inlineDetail = detailOpen && split;
  const compact = !wide || inlineDetail;

  // A `card` param that does not exist anymore is dropped without noise.
  useEffect(() => {
    if (params.card && !fromList && single.isError) replace({ card: null });
  }, [params.card, fromList, single.isError, replace]);

  const closeNow = useCallback(() => {
    dirtyRef.current = false;
    replace({ card: null });
    const el = returnRef.current;
    if (el) requestAnimationFrame(() => (el.isConnected ? el.focus() : listRef.current?.focus()));
  }, [replace]);

  const requestOpen = (id: string | null) => {
    if (dirtyRef.current && id !== params.card) {
      setPendingOpen({ id });
      return;
    }
    if (id === null) closeNow();
    else push({ card: id });
  };

  useEffect(() => {
    if (inlineDetail && params.card) headingRef.current?.focus();
  }, [inlineDetail, params.card]);

  const onDirtyChange = useCallback((d: boolean) => {
    dirtyRef.current = d;
  }, []);

  const afterDelete = (id: string) => {
    const idx = cards.findIndex((c) => c.id === id);
    const nextId = cards[idx + 1]?.id ?? cards[idx - 1]?.id;
    dirtyRef.current = false;
    replace({ card: null });
    requestAnimationFrame(() => {
      const row = nextId
        ? listRef.current?.querySelector<HTMLElement>(`li[data-card-id="${nextId}"] button`)
        : null;
      (row ?? listRef.current)?.focus();
    });
  };

  // ---- actions ----
  // Changing filters drops the open card: unsaved edits go through the same discard guard.
  const patchFilters = (patch: FlashcardsPatch) => {
    if (dirtyRef.current && params.card) {
      setPendingOpen({ id: null, then: patch });
      return;
    }
    replace({ ...patch, card: null });
  };
  const reset = () => {
    patchFilters({ argomento: null, mazzo: null, stato: null, tag: null, escluse: false });
    setText('');
  };

  const onAction = async (card: FlashcardDto, id: CardAction['id']) => {
    try {
      if (id === 'unflag') {
        await updateCard(slug, card.id, { flagged: false });
        notify.success(
          deckStatus.get(card.deckId) && deckStatus.get(card.deckId) !== 'approved'
            ? 'Card rimessa nel ripasso, ma il mazzo non è ancora approvato.'
            : 'Card rimessa nel ripasso.',
        );
      } else if (id === 'suspend' || id === 'unsuspend') {
        await updateCard(slug, card.id, { suspended: id === 'suspend' });
        notify.success(id === 'suspend' ? 'Card sospesa.' : 'Card riattivata.');
      } else if (id === 'move') {
        setDialog({ kind: 'move', ids: [card.id], fields: 'deck' });
        return;
      } else if (id === 'topic') {
        setDialog({ kind: 'move', ids: [card.id], fields: 'topic' });
        return;
      } else {
        setDialog({ kind: 'delete', ids: [card.id] });
        return;
      }
      invalidateFlashcards(qc, slug);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Operazione non riuscita.');
    }
  };

  const ids = [...selected].filter((id) => cards.some((c) => c.id === id));
  const bulkSuspend = async (suspended: boolean) => {
    setBulkBusy(true);
    try {
      await bulkCards(slug, { ids, action: { type: 'suspend', suspended } });
      invalidateFlashcards(qc, slug);
      notify.success(suspended ? 'Card sospese.' : 'Card riattivate.');
      setSelected(new Set());
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Operazione non riuscita.');
    } finally {
      setBulkBusy(false);
    }
  };

  const clearSelection = () => {
    const first = cards.find((c) => selected.has(c.id));
    setSelected(new Set());
    requestAnimationFrame(() => {
      const box = first
        ? listRef.current?.querySelector<HTMLElement>(`li[data-card-id="${first.id}"] input`)
        : null;
      (box ?? listRef.current)?.focus();
    });
  };

  const detail = openCard && (
    <CardDetailPanel
      key={openCard.id}
      slug={slug}
      card={openCard}
      topics={topics}
      decks={decks}
      inline={inlineDetail}
      headingRef={headingRef}
      onRequestClose={() => requestOpen(null)}
      onDirtyChange={onDirtyChange}
      onDeleted={() => afterDelete(openCard.id)}
    />
  );

  const list = (
    <div className="flex min-w-0 flex-col gap-3">
      <CardFilters
        slug={slug}
        topics={topics}
        decks={decks}
        params={params}
        q={text}
        onQChange={setText}
        onChange={(patch) => patchFilters(patch as FlashcardsPatch)}
      />
      <CardSummaryBar
        total={total}
        scope={scope}
        filtered={filtered}
        order={params.ordine}
        onReset={reset}
        onOrderChange={(ordine) => patchFilters({ ordine })}
      />
      <CardList
        cards={cards}
        deckStatus={deckStatus}
        compact={compact}
        selected={selected}
        currentId={params.card}
        loading={pages.isLoading}
        error={pages.isError ? (pages.error as Error) : null}
        onRetry={() => void pages.refetch()}
        hasNext={!!pages.hasNextPage}
        fetchingNext={pages.isFetchingNextPage}
        onFetchNext={() => void pages.fetchNextPage()}
        nextError={pages.isFetchNextPageError ? (pages.error as Error) : null}
        filtered={filtered}
        onlyExcluded={params.escluse}
        onReset={reset}
        onToggle={(id) =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onToggleAll={() =>
          setSelected(ids.length === cards.length ? new Set() : new Set(cards.map((c) => c.id)))
        }
        onOpen={(card, el) => {
          returnRef.current = el;
          requestOpen(card.id);
        }}
        onAction={(card, id) => void onAction(card, id)}
        onGenerate={() => onAdd('ai')}
        onWrite={() => onAdd('manual')}
        listRef={listRef}
      />
      {ids.length > 0 && (
        <SelectionBar
          count={ids.length}
          anySuspended={cards.some((c) => selected.has(c.id) && c.suspended)}
          moreNotLoaded={ids.length === cards.length && !!pages.hasNextPage}
          busy={bulkBusy}
          onSuspend={() => void bulkSuspend(true)}
          onUnsuspend={() => void bulkSuspend(false)}
          onMove={() => setDialog({ kind: 'move', ids, fields: 'both' })}
          onTags={() => setDialog({ kind: 'tags', ids })}
          onDelete={() => setDialog({ kind: 'delete', ids })}
          onClear={clearSelection}
        />
      )}
    </div>
  );

  return (
    <div ref={rootRef} className="min-w-0">
      {inlineDetail ? (
        <div className="flex items-start gap-5">
          <div className="min-w-0 flex-[999_1_420px]">{list}</div>
          <aside
            aria-labelledby="fc-dett"
            onKeyDown={(e) => {
              if (e.key === 'Escape' && e.currentTarget.contains(e.target as Node)) {
                e.stopPropagation();
                requestOpen(null);
              }
            }}
            className={`${CARD_BOX} sticky top-6 max-h-[calc(100dvh-3rem)] min-w-0 flex-1 basis-[400px] overflow-y-auto border-border-strong`}
          >
            {detail ||
              (single.isLoading ? (
                <div aria-hidden="true" className={`m-5 h-64 rounded ${SKELETON}`} />
              ) : (
                <div className="flex items-center gap-3 p-5">
                  <h2 id="fc-dett" className="text-base font-semibold">
                    Modifica card
                  </h2>
                </div>
              ))}
          </aside>
        </div>
      ) : (
        <>
          {list}
          {detailOpen && (
            <SidePanel
              open
              onOpenChange={(o) => !o && requestOpen(null)}
              title="Modifica card"
              returnFocusRef={returnRef}
            >
              {detail ||
                (single.isLoading ? (
                  <div aria-hidden="true" className={`m-5 h-64 rounded ${SKELETON}`} />
                ) : (
                  <p className="p-5 text-sm text-fg-secondary">Card non trovata.</p>
                ))}
            </SidePanel>
          )}
        </>
      )}

      <BulkDialogs
        slug={slug}
        state={dialog}
        topics={topics}
        decks={decks}
        onDone={() => setSelected(new Set())}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={pendingOpen !== null}
        onOpenChange={(o) => !o && setPendingOpen(null)}
        title="Scartare le modifiche?"
        description="Hai modifiche non salvate a questa card."
        confirmLabel="Scarta"
        cancelLabel="Continua a modificare"
        onConfirm={() => {
          const target = pendingOpen?.id ?? null;
          const then = pendingOpen?.then;
          dirtyRef.current = false;
          if (then) replace({ ...then, card: null });
          else if (target === null) closeNow();
          else push({ card: target });
        }}
      />
    </div>
  );
}
