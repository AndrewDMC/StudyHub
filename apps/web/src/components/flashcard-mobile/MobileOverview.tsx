'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, MoreHorizontal, Play } from 'lucide-react';
import type { DeckGroupDto, DeckSummaryDto, TopicDto } from '@studyhub/contracts';
import {
  buildDeckTree,
  canReview,
  groupFilterValue,
  groupName,
  reviewHref as topicReviewHref,
} from '@/lib/deckGroups';
import { useDeckGroups } from '@/lib/deckGroupsClient';
import { draftDecksLabel } from '@/lib/flashcardMobile';
import { NEW_CARDS_PER_DAY, flashcardsLink, reviewDeckHref } from '@/lib/flashcardsView';
import { reviewHref } from '@/lib/quickReview';
import { useAutoSort } from '../deck-groups/useAutoSort';
import {
  invalidateFlashcards,
  useDeckSummaries,
  useFlashcardStats,
  useSubjectOverview,
} from '../flashcards/api';
import { heroSummary } from '../flashcards/overview/TodayHero';
import { AutoSortRow } from '../flashcards/overview/AutoSortRow';
import { DeckDialogs } from '../flashcards/overview/DeckDialogs';
import { deckOrigin } from '../flashcards/overview/DeckRows';
import { EmptyState } from '../flashcards/shared/EmptyState';
import { MasteryBar } from '../flashcards/shared/MasteryBar';
import { deckActions, type DeckDialogState } from '../flashcards/shared/deckActions';
import { useFlashcardsParams } from '../flashcards/useFlashcardsParams';
import { useNotify } from '../flashcards/Notifier';
import { patchDeck } from '@/lib/deckEditorClient';
import { BottomSheet } from '../subject-mobile/BottomSheet';
import { SectionError, SkeletonRows } from '../subject-mobile/SectionState';

const CTA =
  'flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-card)] px-4 text-[15px] font-semibold';
const ROW = 'flex items-center gap-3 border-b border-border py-3 pl-4 pr-2 last:border-0';
const ICON_LINK =
  'flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border-strong text-accent-hover';

function Hero({ slug, hasBlockedNew }: { slug: string; hasBlockedNew: boolean }) {
  const overview = useSubjectOverview(slug);
  const data = overview.data;
  const total = data ? data.dueCount + data.newCount : 0;
  return (
    <section
      aria-label="Ripasso di oggi"
      aria-busy={overview.isLoading || undefined}
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-bg-surface p-5"
    >
      <h2 className="text-xs font-medium uppercase tracking-[0.05em] text-fg-secondary">
        Ripasso di oggi
      </h2>
      {overview.isError ? (
        <SectionError
          message="Impossibile caricare il ripasso di oggi."
          onRetry={() => void overview.refetch()}
        />
      ) : !data ? (
        <div aria-hidden="true" className="flex flex-col gap-3">
          <div className="h-10 w-20 animate-pulse rounded bg-bg-raised motion-reduce:animate-none" />
          <div className="h-12 animate-pulse rounded bg-bg-raised motion-reduce:animate-none" />
        </div>
      ) : (
        <>
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-4xl font-semibold leading-none tabular-nums">{total}</span>
            <span className="text-[15px] text-fg-secondary">card da ripassare</span>
          </p>
          <p className="text-sm text-fg-secondary">
            {total === 0
              ? 'Hai finito per oggi.'
              : heroSummary(data.dueCount, data.newCount, data.estimatedMinutes)}
          </p>
          {total > 0 ? (
            <Link href={reviewHref(slug)} className={`${CTA} bg-accent text-bg-base`}>
              <Play className="size-4" aria-hidden="true" />
              Ripassa ora
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className={`${CTA} border border-border text-fg-secondary`}
            >
              Nessuna card da ripassare
            </button>
          )}
          {(data.newCount > 0 || hasBlockedNew) && (
            <p className="text-[13px] text-fg-secondary">
              Le nuove entrano solo per argomenti già trattati nel piano, al massimo{' '}
              {NEW_CARDS_PER_DAY} per sessione.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Attention({ slug }: { slug: string }) {
  const stats = useFlashcardStats(slug).data;
  if (!stats || (stats.draftDeckCount <= 0 && stats.excludedCount <= 0)) return null;
  const row = 'flex min-h-[60px] items-center gap-3 border-b border-border px-4 py-2 last:border-0';
  return (
    <section
      aria-labelledby="fc-att-m"
      className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-bg-surface"
    >
      <h2 id="fc-att-m" className="sr-only">
        Da sistemare
      </h2>
      <ul>
        {stats.draftDeckCount > 0 && (
          <li>
            <Link
              href={flashcardsLink(slug, { view: 'panoramica', group: 'mazzo' })}
              scroll={false}
              className={row}
            >
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warn" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {draftDecksLabel(stats.draftDeckCount)}
                </span>
                <span className="block text-[13px] text-fg-secondary">
                  {stats.draftCardCount} card ancora fuori dal ripasso
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-fg-secondary" aria-hidden="true" />
            </Link>
          </li>
        )}
        {stats.excludedCount > 0 && (
          <li>
            <Link
              href={flashcardsLink(slug, { view: 'card', escluse: true })}
              scroll={false}
              className={row}
            >
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-danger" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {stats.excludedCount === 1
                    ? '1 card esclusa'
                    : `${stats.excludedCount} card escluse`}
                </span>
                <span className="block text-[13px] text-fg-secondary">
                  {stats.flaggedCount} {stats.flaggedCount === 1 ? 'segnalata' : 'segnalate'} ·{' '}
                  {stats.suspendedCount} {stats.suspendedCount === 1 ? 'sospesa' : 'sospese'}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-fg-secondary" aria-hidden="true" />
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}

function TopicRowM({
  slug,
  group,
  depth,
  mastery,
}: {
  slug: string;
  group: DeckGroupDto;
  depth: 0 | 1;
  mastery: number | null | undefined;
}) {
  const name = groupName(group);
  const waiting = (group.newBlockedCount ?? 0) > 0 && group.due + group.new === 0;
  return (
    <li className={`${ROW} ${depth === 1 ? 'pl-8' : ''}`}>
      <Link
        href={flashcardsLink(slug, { view: 'card', argomento: groupFilterValue(group) })}
        scroll={false}
        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-1"
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium">
            {depth === 1 && <span aria-hidden="true">↳ </span>}
            {name}
          </span>
          {group.due > 0 ? (
            <span className="shrink-0 text-[13px] text-accent-hover">{group.due} da ripassare</span>
          ) : group.new > 0 ? (
            <span className="shrink-0 text-[13px] text-fg-secondary">{group.new} nuove</span>
          ) : waiting ? (
            <span className="shrink-0 text-[13px] text-fg-secondary">In attesa del piano</span>
          ) : null}
        </span>
        <MasteryBar mastery={mastery ?? null} />
      </Link>
      {canReview(group) ? (
        <Link
          href={topicReviewHref(slug, group)}
          aria-label={`Ripassa ${name}`}
          className={ICON_LINK}
        >
          <Play className="size-[18px]" aria-hidden="true" />
        </Link>
      ) : (
        <span aria-hidden="true" className="size-11 shrink-0" />
      )}
    </li>
  );
}

function Topics({ slug, topics }: { slug: string; topics: TopicDto[] }) {
  const qc = useQueryClient();
  const query = useDeckGroups(slug);
  const stats = useFlashcardStats(slug);
  const onFinished = useCallback(() => invalidateFlashcards(qc, slug), [qc, slug]);
  const sort = useAutoSort(slug, onFinished);
  const tree = useMemo(() => buildDeckTree(query.data ?? [], topics), [query.data, topics]);
  const mastery = useMemo(
    () => new Map((stats.data?.topicMastery ?? []).map((t) => [t.topicId, t.mastery])),
    [stats.data],
  );
  if (query.isError) {
    return (
      <SectionError
        message="Impossibile caricare gli argomenti."
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (query.isLoading) return <SkeletonRows count={5} />;
  const showUnsorted = (tree.unsorted && tree.unsorted.total > 0) || sort.touched;
  if (tree.rows.length === 0 && !showUnsorted) return null;
  return (
    <ul
      aria-label="Mazzi per argomento"
      className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-bg-surface"
    >
      {tree.rows.map(({ group, depth }) => (
        <TopicRowM
          key={group.topicId}
          slug={slug}
          group={group}
          depth={depth}
          mastery={group.topicId ? mastery.get(group.topicId) : null}
        />
      ))}
      {showUnsorted && (
        <AutoSortRow
          mobile
          slug={slug}
          hasTopics={topics.length > 0}
          sort={sort}
          group={
            tree.unsorted ?? {
              topicId: null,
              topicName: null,
              parentTopicId: null,
              total: 0,
              due: 0,
              new: 0,
              suspended: 0,
            }
          }
        />
      )}
    </ul>
  );
}

function DeckActionsSheet({
  slug,
  deck,
  returnFocusRef,
  onClose,
  onAction,
}: {
  slug: string;
  deck: DeckSummaryDto | null;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onAction: (state: NonNullable<DeckDialogState>) => void;
}) {
  const item =
    'flex min-h-12 w-full flex-col justify-center rounded-[var(--radius-control)] px-2 text-left text-[15px] text-fg-primary hover:bg-bg-raised';
  return (
    <BottomSheet
      open={deck !== null}
      onOpenChange={(o) => !o && onClose()}
      title={deck?.title ?? 'Mazzo'}
      returnFocusRef={returnFocusRef}
    >
      {deck && (
        <div className="mt-2 flex flex-col">
          {deckActions(slug, deck).map((a) =>
            a.href ? (
              <a key={a.id} href={a.href} download className={item} onClick={onClose}>
                <span>{a.label}</span>
                {a.description && (
                  <span className="text-[13px] text-fg-secondary">{a.description}</span>
                )}
              </a>
            ) : (
              <button
                key={a.id}
                type="button"
                className={`${item} ${a.tone === 'danger' ? 'text-danger' : ''}`}
                onClick={() => {
                  onClose();
                  onAction({ kind: a.id as 'rename' | 'merge' | 'archive', deck });
                }}
              >
                {a.label}
              </button>
            ),
          )}
        </div>
      )}
    </BottomSheet>
  );
}

function Decks({ slug, onAdd }: { slug: string; onAdd: (mode: 'ai' | 'deck') => void }) {
  const qc = useQueryClient();
  const notify = useNotify();
  const query = useDeckSummaries(slug);
  const [sheet, setSheet] = useState<DeckSummaryDto | null>(null);
  const [dialog, setDialog] = useState<DeckDialogState>(null);
  const [showArchived, setShowArchived] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const decks = query.data ?? [];

  if (query.isError) {
    return (
      <SectionError message="Impossibile caricare i mazzi." onRetry={() => void query.refetch()} />
    );
  }
  if (query.isLoading) return <SkeletonRows count={4} />;
  if (decks.length === 0) {
    return (
      <EmptyState
        title="Nessun mazzo ancora"
        text="Genera un mazzo dal materiale o creane uno vuoto da riempire."
        onGenerate={() => onAdd('ai')}
        onWrite={() => onAdd('deck')}
        writeLabel="Nuovo mazzo vuoto"
      />
    );
  }
  const drafts = decks.filter((d) => d.status === 'draft');
  const active = decks.filter((d) => d.status === 'approved');
  const archived = decks.filter((d) => d.status === 'archived');
  const box = 'overflow-hidden rounded-[var(--radius-card)] border border-border bg-bg-surface';
  const h3 = 'mb-2 text-xs font-medium uppercase tracking-[0.05em]';

  return (
    <div className="flex flex-col gap-4">
      {drafts.length > 0 && (
        <section aria-labelledby="fc-bozze-m">
          <h3 id="fc-bozze-m" className={`${h3} text-warn`}>
            Da approvare · {drafts.length}
          </h3>
          <ul className={box}>
            {drafts.map((d) => (
              <li
                key={d.id}
                className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
              >
                <div>
                  <p className="font-medium">{d.title}</p>
                  <p className="text-[13px] text-fg-secondary">{deckOrigin(d)}</p>
                </div>
                <Link
                  href={`/materie/${slug}/artifacts/${d.id}`}
                  className="flex h-11 items-center justify-center rounded-[var(--radius-control)] bg-accent px-4 text-sm font-semibold text-bg-base"
                >
                  Rivedi e approva
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {active.length > 0 && (
        <section aria-labelledby="fc-attivi-m">
          <h3 id="fc-attivi-m" className={`${h3} text-fg-secondary`}>
            Attivi · {active.length}
          </h3>
          <ul className={box}>
            {active.map((d) => (
              <li key={d.id} className={ROW}>
                <Link
                  href={flashcardsLink(slug, { view: 'card', mazzo: d.id })}
                  scroll={false}
                  className="flex min-h-11 min-w-0 flex-1 flex-col justify-center"
                >
                  <span className="truncate font-medium">{d.title}</span>
                  <span className="text-[13px] text-fg-secondary">
                    {d.cardCount} card
                    {d.topicCount > 0 &&
                      ` · ${d.topicCount} ${d.topicCount === 1 ? 'argomento' : 'argomenti'}`}
                  </span>
                  <span className="text-[13px] text-accent-hover">
                    {d.dueCount} da ripassare · {d.newCount} nuove
                  </span>
                </Link>
                {d.dueCount + d.newCount > 0 ? (
                  <Link
                    href={reviewDeckHref(slug, d.id)}
                    aria-label={`Ripassa ${d.title}`}
                    className={ICON_LINK}
                  >
                    <Play className="size-[18px]" aria-hidden="true" />
                  </Link>
                ) : (
                  <span aria-hidden="true" className="size-11 shrink-0" />
                )}
                <button
                  type="button"
                  aria-label={`Azioni sul mazzo ${d.title}`}
                  aria-haspopup="dialog"
                  onClick={(e) => {
                    triggerRef.current = e.currentTarget;
                    setSheet(d);
                  }}
                  className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-fg-secondary"
                >
                  <MoreHorizontal className="size-5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {archived.length > 0 && (
        <section>
          <button
            type="button"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
            className="flex min-h-11 items-center gap-1.5 text-sm text-fg-secondary"
          >
            <ChevronRight
              className={`size-4 transition-transform ${showArchived ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
            Archiviati · {archived.length} {archived.length === 1 ? 'mazzo' : 'mazzi'}
          </button>
          {showArchived && (
            <ul className={`${box} mt-2`}>
              {archived.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{d.title}</p>
                    <p className="text-[13px] text-fg-secondary">{d.cardCount} card · archiviato</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Ripristina ${d.title}`}
                    onClick={async () => {
                      try {
                        await patchDeck(slug, d.id, { status: 'approved' });
                        invalidateFlashcards(qc, slug);
                        notify.success(`Mazzo «${d.title}» ripristinato.`);
                      } catch (err) {
                        notify.error(
                          err instanceof Error ? err.message : 'Ripristino non riuscito.',
                        );
                      }
                    }}
                    className="h-11 rounded-[var(--radius-control)] border border-border-strong px-3.5 text-sm"
                  >
                    Ripristina
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <DeckActionsSheet
        slug={slug}
        deck={sheet}
        returnFocusRef={triggerRef}
        onClose={() => setSheet(null)}
        onAction={setDialog}
      />
      <DeckDialogs slug={slug} state={dialog} decks={decks} onClose={() => setDialog(null)} />
    </div>
  );
}

/** Panoramica below md: hero, "Da sistemare" and "Per argomento" / "Per mazzo". */
export function MobileOverview({
  slug,
  topics,
  onAdd,
}: {
  slug: string;
  topics: TopicDto[];
  onAdd: (mode: 'ai' | 'manual' | 'deck') => void;
}) {
  const { params, replace } = useFlashcardsParams(slug);
  const stats = useFlashcardStats(slug);
  const groups = useDeckGroups(slug);
  const decks = useDeckSummaries(slug);
  const byDeck = params.group === 'mazzo';
  const s = stats.data;
  const noCards =
    !!s &&
    Object.values(s.countsByState).reduce((a, b) => a + b, 0) +
      s.suspendedCount +
      s.flaggedCount +
      s.draftCardCount ===
      0;
  const hasBlockedNew = (groups.data ?? []).some((g) => (g.newBlockedCount ?? 0) > 0);

  if (noCards) {
    return <EmptyState onGenerate={() => onAdd('ai')} onWrite={() => onAdd('manual')} />;
  }
  const total = byDeck
    ? decks.data?.filter((d) => d.status === 'approved').reduce((n, d) => n + d.cardCount, 0)
    : groups.data?.reduce((n, g) => n + g.total, 0);

  return (
    <div className="flex flex-col gap-4">
      <Hero slug={slug} hasBlockedNew={hasBlockedNew} />
      <Attention slug={slug} />
      <section aria-labelledby="fc-mazzi-m">
        <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
          <h2 id="fc-mazzi-m" className="text-base font-semibold">
            {byDeck ? 'Per mazzo' : 'Per argomento'}
            {total !== undefined && ` · ${total}`}
          </h2>
          <button
            type="button"
            onClick={() => replace({ group: byDeck ? 'argomento' : 'mazzo' })}
            className="min-h-11 px-1 text-sm text-accent-hover"
          >
            {byDeck ? 'Vedi per argomento' : 'Vedi per mazzo'}
          </button>
        </div>
        {byDeck ? <Decks slug={slug} onAdd={onAdd} /> : <Topics slug={slug} topics={topics} />}
      </section>
    </div>
  );
}
