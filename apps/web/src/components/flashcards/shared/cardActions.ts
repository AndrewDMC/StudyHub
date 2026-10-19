import type { FlashcardDto } from '@studyhub/contracts';

/** One action of the card menu, shared by the desktop `Menu` and any sheet. */
export interface CardAction {
  id: 'unflag' | 'suspend' | 'unsuspend' | 'move' | 'topic' | 'delete';
  label: string;
  tone?: 'danger';
  separatorBefore?: boolean;
}

export function cardActions(card: Pick<FlashcardDto, 'flaggedAt' | 'suspended'>): CardAction[] {
  const actions: CardAction[] = [];
  if (card.flaggedAt) actions.push({ id: 'unflag', label: 'Rimetti nel ripasso' });
  actions.push(
    card.suspended ? { id: 'unsuspend', label: 'Riattiva' } : { id: 'suspend', label: 'Sospendi' },
    { id: 'move', label: 'Sposta in un altro mazzo…' },
    { id: 'topic', label: 'Cambia argomento…' },
    { id: 'delete', label: 'Elimina card', tone: 'danger', separatorBefore: true },
  );
  return actions;
}

/** Why a card is out of the review, or null when it is in. `deckStatus` comes from the decks query. */
export function exclusionReason(
  card: Pick<FlashcardDto, 'flaggedAt' | 'suspended'>,
  deckStatus: string | undefined,
): 'flagged' | 'suspended' | 'deck' | null {
  if (card.flaggedAt) return 'flagged';
  if (card.suspended) return 'suspended';
  if (deckStatus !== undefined && deckStatus !== 'approved') return 'deck';
  return null;
}
