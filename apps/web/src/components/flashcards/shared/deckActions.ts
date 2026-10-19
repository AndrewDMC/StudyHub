import type { DeckSummaryDto } from '@studyhub/contracts';

/** One action of the deck menu: the same model feeds the desktop `Menu` and the mobile sheet. */
export interface DeckAction {
  id: 'rename' | 'merge' | 'export-apkg' | 'export-csv' | 'archive';
  label: string;
  description?: string;
  tone?: 'danger';
  /** Present on links (exports); the others are run through `onAction`. */
  href?: string;
  /** Heading shown before the first item of the group. */
  groupLabel?: string;
  /** A separator goes before this item. */
  separatorBefore?: boolean;
}

/** Actions of an approved deck, in menu order. */
export function deckActions(slug: string, deck: DeckSummaryDto): DeckAction[] {
  const base = `/api/subjects/${slug}/artifacts/${deck.id}`;
  return [
    { id: 'rename', label: 'Rinomina' },
    { id: 'merge', label: 'Unisci in un altro mazzo…' },
    {
      id: 'export-apkg',
      label: 'Per Anki (.apkg)',
      description: 'Mantiene i progressi del ripasso',
      href: `${base}/export.apkg`,
      groupLabel: 'Esporta',
      separatorBefore: true,
    },
    {
      id: 'export-csv',
      label: 'Foglio CSV',
      description: 'Solo testo, i progressi ripartono',
      href: `${base}/export.csv`,
    },
    { id: 'archive', label: 'Archivia mazzo', tone: 'danger', separatorBefore: true },
  ];
}

export type DeckDialogState = {
  kind: 'rename' | 'merge' | 'archive';
  deck: DeckSummaryDto;
} | null;
