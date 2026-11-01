'use client';

import type { ReactNode } from 'react';

/**
 * The fixed bar at the bottom of the verify on a phone. The open question draws its buttons into
 * `setSlot` (Correggi, Non me lo ricordo, Avanti); a finished check passes its two arrows as `children`.
 */
export function VerifyActionBar({
  setSlot,
  children,
}: {
  setSlot?: (el: HTMLDivElement | null) => void;
  children?: ReactNode;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Azioni della verifica"
      className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-border bg-bg-base px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]"
    >
      {setSlot ? (
        <div ref={setSlot} className="flex min-w-0 flex-1 items-center gap-2" />
      ) : (
        children
      )}
    </div>
  );
}
