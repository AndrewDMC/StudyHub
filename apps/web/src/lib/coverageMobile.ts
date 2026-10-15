import type { CoverageTopicDto } from '@studyhub/contracts';
import type { Tone } from './simulationMobile';

export type CoverageFlag = CoverageTopicDto['flags'][number];
export type GapFilter = 'tutte' | CoverageFlag;
export type TopicActionKind = 'upload' | 'flashcards' | 'review' | 'drill';

export const FLAG_LABELS: Record<CoverageFlag, string> = {
  no_material: 'Senza materiale',
  no_cards: 'Senza flashcard',
  weak: 'Debole',
};

/** Pill label of each flag: "Debole" / "Senza flashcard" / "Senza materiale". */
export const FLAG_TONES: Record<CoverageFlag, 'danger' | 'warn' | 'info'> = {
  weak: 'danger',
  no_cards: 'warn',
  no_material: 'info',
};

/** Order the flags by urgency: missing material, then missing cards, then weak mastery. */
const FLAG_ORDER: CoverageFlag[] = ['no_material', 'no_cards', 'weak'];

/** Most urgent flag, or null when the topic has no gap. */
export function gapPriority(flags: CoverageFlag[]): CoverageFlag | null {
  return FLAG_ORDER.find((f) => flags.includes(f)) ?? null;
}

/** The single primary action of a topic, by precedence no_material > no_cards > weak. */
export function topicAction(
  t: Pick<CoverageTopicDto, 'flags' | 'cards' | 'materialDocs'>,
): TopicActionKind | null {
  if (t.flags.includes('no_material')) return 'upload';
  if (t.flags.includes('no_cards') && t.materialDocs > 0) return 'flashcards';
  if (t.cards > 0) return 'review';
  if (t.flags.includes('weak') && t.materialDocs > 0) return 'drill';
  return null;
}

export const ACTION_LABELS: Record<TopicActionKind, string> = {
  upload: 'Carica materiale',
  flashcards: 'Genera flashcard',
  review: 'Ripassa le card',
  drill: 'Fai un drill',
};

export function filterCounts(topics: Pick<CoverageTopicDto, 'flags'>[]): Record<GapFilter, number> {
  const counts: Record<GapFilter, number> = {
    tutte: topics.length,
    weak: 0,
    no_cards: 0,
    no_material: 0,
  };
  for (const t of topics) for (const f of new Set(t.flags)) counts[f] += 1;
  return counts;
}

export function matchesFilter(t: Pick<CoverageTopicDto, 'flags'>, f: GapFilter): boolean {
  return f === 'tutte' || t.flags.includes(f);
}

/** Mastery thresholds of the design: >= 70% ok, >= 40% warn, else danger. */
export function masteryTone(m: number | null): Tone | null {
  if (m === null) return null;
  if (m >= 0.7) return 'ok';
  if (m >= 0.4) return 'warn';
  return 'danger';
}

export function formatMastery(m: number | null): string {
  return m === null ? 'N/D' : `${Math.round(m * 100)}%`;
}

export function examsLabel(t: Pick<CoverageTopicDto, 'examTotal' | 'examMentions' | 'recurring'>) {
  if (t.examTotal === 0) return t.recurring ? 'ricorrente' : '—';
  return `${t.examMentions}/${t.examTotal}`;
}

/** "5 volte negli esami"; null when the topic never appears. */
export function mentionsLabel(t: Pick<CoverageTopicDto, 'examTotal' | 'examMentions'>) {
  if (t.examTotal === 0 || t.examMentions === 0) return null;
  return `${t.examMentions} ${t.examMentions === 1 ? 'volta' : 'volte'} negli esami`;
}
