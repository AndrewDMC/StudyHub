/** Query params of the Flashcard tab of a subject: shared by desktop and mobile. */

export type FlashcardView = 'panoramica' | 'card' | 'statistiche';
export type FlashcardGroup = 'argomento' | 'mazzo';
export type FlashcardOrder = 'due' | 'recenti';
export type FlashcardState = 'new' | 'learning' | 'review' | 'relearning';

export const FLASHCARD_VIEWS: readonly FlashcardView[] = ['panoramica', 'card', 'statistiche'];
const STATES: readonly FlashcardState[] = ['new', 'learning', 'review', 'relearning'];

/** Every param owned by the tab: cleared when the subject tab changes. */
export const FLASHCARD_PARAMS = [
  'view',
  'group',
  'card',
  'argomento',
  'mazzo',
  'stato',
  'tag',
  'escluse',
  'ordine',
] as const;

/** Filters of the Card view: dropped when the user leaves it. */
const FILTER_PARAMS = ['argomento', 'mazzo', 'stato', 'tag', 'escluse', 'ordine'] as const;

export interface FlashcardsParams {
  view: FlashcardView;
  group: FlashcardGroup;
  /** A topic id, or `none` = cards without a topic. */
  argomento: string | null;
  mazzo: string | null;
  stato: FlashcardState | null;
  tag: string | null;
  escluse: boolean;
  ordine: FlashcardOrder;
  card: string | null;
}

export const DEFAULT_FLASHCARDS_PARAMS: FlashcardsParams = {
  view: 'panoramica',
  group: 'argomento',
  argomento: null,
  mazzo: null,
  stato: null,
  tag: null,
  escluse: false,
  ordine: 'due',
  card: null,
};

type ParamReader = { get(name: string): string | null };

export function parseFlashcardsParams(sp: ParamReader): FlashcardsParams {
  const view = sp.get('view');
  const group = sp.get('group');
  const stato = sp.get('stato');
  return {
    view: FLASHCARD_VIEWS.includes(view as FlashcardView) ? (view as FlashcardView) : 'panoramica',
    group: group === 'mazzo' ? 'mazzo' : 'argomento',
    argomento: sp.get('argomento') || null,
    mazzo: sp.get('mazzo') || null,
    stato: STATES.includes(stato as FlashcardState) ? (stato as FlashcardState) : null,
    tag: sp.get('tag') || null,
    escluse: sp.get('escluse') === '1',
    ordine: sp.get('ordine') === 'recenti' ? 'recenti' : 'due',
    card: sp.get('card') || null,
  };
}

export type FlashcardsPatch = Partial<{
  [K in keyof FlashcardsParams]: FlashcardsParams[K] | null | undefined;
}>;

function writeParam(qs: URLSearchParams, key: keyof FlashcardsParams, value: unknown) {
  const def = DEFAULT_FLASHCARDS_PARAMS[key];
  if (value === null || value === undefined || value === false || value === def || value === '') {
    qs.delete(key);
  } else {
    qs.set(key, value === true ? '1' : String(value));
  }
}

/**
 * Href of the tab with `patch` applied on top of the current query string (`base`), keeping the
 * params that are not ours. Defaults are omitted. Changing `view` drops `card`, and leaving the
 * Card view drops its filters.
 */
export function flashcardsHref(
  slug: string,
  base: ParamReader & { toString(): string },
  patch: FlashcardsPatch = {},
): string {
  const qs = new URLSearchParams(base.toString());
  qs.set('tab', 'flashcard');
  const currentView = parseFlashcardsParams(qs).view;
  if (patch.view !== undefined && patch.view !== currentView) {
    qs.delete('card');
    if (patch.view !== 'card') for (const k of FILTER_PARAMS) qs.delete(k);
  }
  for (const [key, value] of Object.entries(patch)) {
    writeParam(qs, key as keyof FlashcardsParams, value);
  }
  const rest = qs.toString();
  return `/materie/${slug}${rest ? `?${rest}` : ''}`;
}

/** Deep link of a plain href that does not depend on the current URL (links built on the server or in lists). */
export function flashcardsLink(slug: string, patch: FlashcardsPatch = {}): string {
  return flashcardsHref(slug, new URLSearchParams(), patch);
}

/** `/ripasso` limited to one deck. */
export function reviewDeckHref(slug: string, deckId: string): string {
  return `/ripasso?materia=${encodeURIComponent(slug)}&mazzo=${deckId}`;
}

/** True when any filter of the Card view (not the sort) is set. */
export function hasCardFilters(p: FlashcardsParams): boolean {
  return !!(p.argomento || p.mazzo || p.stato || p.tag || p.escluse);
}

/**
 * Mirror of `DEFAULT_NEW_LIMIT` (@studyhub/contracts). The contracts barrel cannot be imported by
 * client code as a value (it drags `node:path` into the bundle), so this copy is pinned to it by
 * `test/flashcardsView.test.ts`.
 */
export const NEW_CARDS_PER_DAY = 20;
