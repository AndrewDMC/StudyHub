'use client';

import { Fragment } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { DeckSummaryDto } from '@studyhub/contracts';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/menu';
import { deckActions, type DeckDialogState } from '../shared/deckActions';
import { ICON_BTN } from '../shared/styles';

/** The ⋯ menu of an approved deck (desktop). */
export function DeckActionsMenu({
  slug,
  deck,
  onAction,
}: {
  slug: string;
  deck: DeckSummaryDto;
  onAction: (state: NonNullable<DeckDialogState>) => void;
}) {
  return (
    <Menu
      label="Azioni sul mazzo"
      trigger={
        <button type="button" aria-label={`Azioni sul mazzo ${deck.title}`} className={ICON_BTN}>
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </button>
      }
    >
      {deckActions(slug, deck).map((a) => (
        <Fragment key={a.id}>
          {a.separatorBefore && <MenuSeparator />}
          {a.groupLabel && <MenuLabel>{a.groupLabel}</MenuLabel>}
          {a.href ? (
            <MenuItem asChild>
              <a href={a.href} download>
                <span className="flex min-w-0 flex-col">
                  <span>{a.label}</span>
                  {a.description && (
                    <span className="text-xs text-fg-secondary">{a.description}</span>
                  )}
                </span>
              </a>
            </MenuItem>
          ) : (
            <MenuItem
              {...(a.tone ? { tone: a.tone } : {})}
              onSelect={() => onAction({ kind: a.id as 'rename' | 'merge' | 'archive', deck })}
            >
              {a.label}
            </MenuItem>
          )}
        </Fragment>
      ))}
    </Menu>
  );
}
