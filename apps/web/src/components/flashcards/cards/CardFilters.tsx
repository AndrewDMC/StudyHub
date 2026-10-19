'use client';

import { useMemo } from 'react';
import { Search } from 'lucide-react';
import type { DeckSummaryDto, TopicDto } from '@studyhub/contracts';
import { NO_TOPIC } from '@/lib/deckGroups';
import type { FlashcardsParams } from '@/lib/flashcardsView';
import { useFlashcardTags } from '../api';
import { PlainStateDot } from '../shared/StateDot';
import { FOCUS } from '../shared/styles';
import { FilterButton, type FilterOption } from './FilterButton';

const STATES = ['new', 'learning', 'review', 'relearning'] as const;
const STATE_TEXT = {
  new: 'Nuova',
  learning: 'In apprendimento',
  review: 'In ripasso',
  relearning: 'Da rinforzare',
} as const;

/** Topics ordered parent-first with children indented one level. */
export function topicOptions(topics: TopicDto[]): { topic: TopicDto; depth: 0 | 1 }[] {
  const byId = new Set(topics.map((t) => t.id));
  const roots = topics.filter((t) => !t.parentId || !byId.has(t.parentId));
  const out: { topic: TopicDto; depth: 0 | 1 }[] = [];
  for (const r of roots) {
    out.push({ topic: r, depth: 0 });
    for (const c of topics.filter((t) => t.parentId === r.id)) out.push({ topic: c, depth: 1 });
  }
  const seen = new Set(out.map((o) => o.topic.id));
  for (const t of topics) if (!seen.has(t.id)) out.push({ topic: t, depth: 1 });
  return out;
}

export function deckSuffix(d: DeckSummaryDto): string {
  return d.status === 'draft' ? ' · bozza' : d.status === 'archived' ? ' · archiviato' : '';
}

/** Search box, the four filter buttons and the "only excluded" toggle. */
export function CardFilters({
  slug,
  topics,
  decks,
  params,
  q,
  onQChange,
  onChange,
}: {
  slug: string;
  topics: TopicDto[];
  decks: DeckSummaryDto[];
  params: FlashcardsParams;
  q: string;
  onQChange: (q: string) => void;
  onChange: (
    patch: Partial<
      Record<'argomento' | 'mazzo' | 'stato' | 'tag' | 'escluse', string | boolean | null>
    >,
  ) => void;
}) {
  const tags = useFlashcardTags(slug).data ?? [];
  const stateOptions: FilterOption[] = useMemo(
    () => [
      { value: '', label: 'Tutti', text: 'Tutti' },
      ...STATES.map((s) => ({
        value: s,
        label: <PlainStateDot state={s} />,
        text: STATE_TEXT[s],
      })),
    ],
    [],
  );
  const topicOpts: FilterOption[] = useMemo(
    () => [
      { value: '', label: 'Tutti gli argomenti', text: 'Tutti' },
      { value: NO_TOPIC, label: 'Senza argomento', text: 'Senza argomento' },
      ...topicOptions(topics).map(({ topic, depth }) => ({
        value: topic.id,
        label: topic.name,
        text: topic.name,
        depth,
      })),
    ],
    [topics],
  );
  const deckOpts: FilterOption[] = useMemo(
    () => [
      { value: '', label: 'Tutti i mazzi', text: 'Tutti' },
      ...decks.map((d) => ({
        value: d.id,
        label: `${d.title}${deckSuffix(d)}`,
        text: d.title,
      })),
    ],
    [decks],
  );
  const tagOpts: FilterOption[] = useMemo(
    () => [
      { value: '', label: 'Tutti i tag', text: 'Tutti' },
      ...tags.map((t) => ({
        value: t.tag,
        label: `#${t.tag} · ${t.count}`,
        text: `#${t.tag}`,
      })),
    ],
    [tags],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex h-10 flex-1 basis-[240px] items-center gap-2 rounded-[var(--radius-control)] border border-border bg-bg-inset px-3 focus-within:outline-2 focus-within:outline-accent max-md:h-11">
        <Search className="size-4 shrink-0 text-fg-secondary" aria-hidden="true" />
        <span className="sr-only">Cerca nelle card</span>
        <input
          type="search"
          value={q}
          placeholder="Cerca in domande e risposte"
          onChange={(e) => onQChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && q) {
              e.preventDefault();
              onQChange('');
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-fg-primary outline-none max-md:text-base"
        />
      </label>
      <FilterButton
        label="Stato"
        groupLabel="Filtra per stato"
        value={params.stato ?? ''}
        options={stateOptions}
        onChange={(v) => onChange({ stato: v || null })}
      />
      <FilterButton
        label="Argomento"
        groupLabel="Filtra per argomento"
        value={params.argomento ?? ''}
        options={topicOpts}
        onChange={(v) => onChange({ argomento: v || null })}
      />
      <FilterButton
        label="Mazzo"
        groupLabel="Filtra per mazzo"
        value={params.mazzo ?? ''}
        options={deckOpts}
        onChange={(v) => onChange({ mazzo: v || null })}
      />
      <FilterButton
        label="Tag"
        groupLabel="Filtra per tag"
        value={params.tag ?? ''}
        options={tagOpts}
        onChange={(v) => onChange({ tag: v || null })}
      />
      <button
        type="button"
        aria-pressed={params.escluse}
        onClick={() => onChange({ escluse: !params.escluse })}
        className={`inline-flex h-10 items-center rounded-[var(--radius-control)] border px-3 text-[13px] transition-colors duration-120 max-md:h-11 ${FOCUS} ${
          params.escluse
            ? 'border-accent/40 bg-accent-subtle text-accent-hover'
            : 'border-border bg-bg-surface text-fg-primary hover:bg-bg-raised'
        }`}
      >
        Solo escluse dal ripasso
      </button>
    </div>
  );
}
