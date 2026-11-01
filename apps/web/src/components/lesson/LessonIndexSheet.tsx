'use client';

import { useEffect, useRef, type RefObject } from 'react';
import type { LessonBlockDto } from '@studyhub/contracts';
import { BottomSheet } from '@/components/subject-mobile/BottomSheet';
import { LessonOutline } from '@/components/lesson/LessonOutline';

/**
 * The index of the blocks as a bottom sheet (on a phone it replaces the column on the left). Picking a
 * block closes the sheet and, once it is gone, moves the focus to the title of that block.
 */
export function LessonIndexSheet({
  open,
  onOpenChange,
  blocks,
  blockCount,
  currentIndex,
  pendingIndex,
  onSelect,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: LessonBlockDto[];
  blockCount: number | null;
  currentIndex: number;
  pendingIndex: number | null;
  onSelect: (index: number, moveFocus: boolean) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  // Picking a block hands the focus to its title: the sheet must not take it back to the trigger.
  const target = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) target.current = returnFocusRef.current;
  }, [open, returnFocusRef]);

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Indice della lezione"
      returnFocusRef={target}
    >
      <div className="pt-2">
        <LessonOutline
          vertical
          blocks={blocks}
          blockCount={blockCount}
          currentIndex={currentIndex}
          pendingIndex={pendingIndex}
          onSelect={(i) => {
            target.current = null;
            onOpenChange(false);
            // After the exit animation of the sheet, or its focus trap would take the focus back.
            window.setTimeout(() => onSelect(i, true), 260);
          }}
        />
      </div>
    </BottomSheet>
  );
}
