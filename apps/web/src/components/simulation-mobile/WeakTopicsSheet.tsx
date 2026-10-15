'use client';

import type { RefObject } from 'react';
import { BottomSheet } from '../subject-mobile/BottomSheet';
import { secondaryButton } from './styles';

/** Picks the weak topic for the drill when there is more than one. */
export function WeakTopicsSheet({
  open,
  onOpenChange,
  topics,
  onPick,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topics: { id: string; name: string }[];
  onPick: (topicId: string) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Drill sugli errori"
      description="Scegli l'argomento su cui allenarti."
      returnFocusRef={returnFocusRef}
    >
      <ul className="mt-4 flex flex-col gap-2">
        {topics.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => {
                onPick(t.id);
                onOpenChange(false);
              }}
              className={`${secondaryButton} min-h-12 justify-start text-left`}
            >
              <span className="truncate">Drill · {t.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
