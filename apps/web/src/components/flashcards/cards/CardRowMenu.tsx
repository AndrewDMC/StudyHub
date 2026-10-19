'use client';

import { Fragment } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { FlashcardDto } from '@studyhub/contracts';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { plainCardText } from '@/lib/flashcardMobile';
import { cardActions, type CardAction } from '../shared/cardActions';
import { ICON_BTN } from '../shared/styles';

/** The ⋯ menu of one card row. */
export function CardRowMenu({
  card,
  onAction,
}: {
  card: FlashcardDto;
  onAction: (card: FlashcardDto, id: CardAction['id']) => void;
}) {
  return (
    <Menu
      label="Azioni sulla card"
      trigger={
        <button
          type="button"
          aria-label={`Altre azioni: ${plainCardText(card.front)}`}
          className={ICON_BTN}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </button>
      }
    >
      {cardActions(card).map((a) => (
        <Fragment key={a.id}>
          {a.separatorBefore && <MenuSeparator />}
          <MenuItem {...(a.tone ? { tone: a.tone } : {})} onSelect={() => onAction(card, a.id)}>
            {a.label}
          </MenuItem>
        </Fragment>
      ))}
    </Menu>
  );
}
