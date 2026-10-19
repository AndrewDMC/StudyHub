'use client';

import { Segmented } from '@/components/ui/segmented';
import type { FlashcardView, FlashcardsPatch } from '@/lib/flashcardsView';

const OPTIONS: { value: FlashcardView; label: string }[] = [
  { value: 'panoramica', label: 'Panoramica' },
  { value: 'card', label: 'Card' },
  { value: 'statistiche', label: 'Statistiche' },
];

/** `<nav aria-label="Viste flashcard">`: three links, the current one `aria-current="page"`. */
export function ViewSwitcher({
  view,
  href,
  mobile = false,
}: {
  view: FlashcardView;
  href: (patch: FlashcardsPatch) => string;
  mobile?: boolean;
}) {
  return (
    <nav aria-label="Viste flashcard" className={mobile ? 'w-full' : undefined}>
      <Segmented
        aria-label="Viste flashcard"
        value={view}
        className={mobile ? 'grid grid-cols-3' : undefined}
        itemClassName={mobile ? 'h-11 text-sm' : undefined}
        options={OPTIONS.map((o) => ({ ...o, href: href({ view: o.value }) }))}
      />
    </nav>
  );
}
