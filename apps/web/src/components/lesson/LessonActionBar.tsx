'use client';

import type { RefObject } from 'react';
import { ChevronLeft, MessageSquare } from 'lucide-react';
import type { LessonPhase } from '@studyhub/contracts';
import { cn } from '@/lib/utils';
import type { BarBack, BarPrimary } from '@/lib/lessonClient';

const SECONDARY =
  'flex size-[52px] shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border-strong bg-bg-raised text-fg-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';

/**
 * The fixed bar at the bottom of the lesson on a phone: back, Materiale e tutor and the primary
 * button of the phase. The block being studied draws its own buttons into `setSlot` (Controlla,
 * Blocco successivo): that way the form and its button stay one component.
 */
export function LessonActionBar({
  back,
  primary,
  onBack,
  onPhase,
  onOpenSide,
  sideRef,
  setSlot,
}: {
  back: BarBack | null;
  primary: BarPrimary;
  onBack: () => void;
  onPhase: (to: LessonPhase) => void;
  onOpenSide: () => void;
  sideRef: RefObject<HTMLButtonElement | null>;
  setSlot: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Azioni della lezione"
      className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-border bg-bg-base px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]"
    >
      {back && (
        <button type="button" aria-label={back.label} onClick={onBack} className={SECONDARY}>
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
      )}
      <button
        ref={sideRef}
        type="button"
        aria-label="Apri materiale e tutor"
        aria-haspopup="dialog"
        data-testid="lesson-open-side"
        onClick={onOpenSide}
        className={SECONDARY}
      >
        <MessageSquare className="size-5" aria-hidden="true" />
      </button>
      {primary.kind === 'phase' && (
        <button
          type="button"
          onClick={() => onPhase(primary.to)}
          className={cn(
            'h-[52px] min-w-0 flex-1 rounded-[var(--radius-control)] px-3 text-base font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
            primary.quiet
              ? 'border border-border-strong bg-bg-raised text-fg-primary'
              : 'bg-accent text-bg-base',
          )}
        >
          {primary.label}
        </button>
      )}
      {primary.kind === 'block' && <div ref={setSlot} className="flex min-w-0 flex-1" />}
    </div>
  );
}
