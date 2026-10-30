'use client';

import { Button } from '@/components/ui/button';
import { NEXT_ACTION, previousPhase, type StandardPhase } from '@/lib/lessonClient';

/** Back / forward between phases. Forward is never blocked: the student decides when a phase is enough. */
export function PhaseNav({
  phase,
  onGo,
  primary = true,
}: {
  phase: StandardPhase;
  onGo: (phase: StandardPhase) => void;
  /** Forward is the quiet kind (Studia, until the blocks are done). */
  primary?: boolean;
}) {
  const prev = previousPhase(phase);
  const next = NEXT_ACTION[phase];
  if (!prev && !next) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 max-md:flex-col-reverse max-md:items-stretch">
      {prev ? (
        <Button
          type="button"
          variant="secondary"
          aria-label={`Indietro: ${prev.label}`}
          onClick={() => onGo(prev.id)}
        >
          ← {prev.label}
        </Button>
      ) : (
        <span />
      )}
      {next && (
        <Button
          type="button"
          size="lg"
          variant={primary ? 'primary' : 'secondary'}
          onClick={() => onGo(next.to)}
        >
          {next.label}
        </Button>
      )}
    </div>
  );
}
