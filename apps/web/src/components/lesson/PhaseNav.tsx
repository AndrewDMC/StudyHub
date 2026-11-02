'use client';

import { Button } from '@/components/ui/button';
import { NEXT_ACTION, previousPhase, type StandardPhase } from '@/lib/lessonClient';

/**
 * Back / forward between phases. Forward is never blocked: the student decides when a phase is enough.
 * A standard lesson passes its `phase`; a sprint lesson passes `prev` and `next` itself.
 */
export function PhaseNav<P extends string = StandardPhase>({
  phase,
  prev: prevProp,
  next: nextProp,
  onGo,
  primary = true,
}: {
  phase?: StandardPhase | undefined;
  prev?: { id: P; label: string } | null | undefined;
  next?: { to: P; label: string } | null | undefined;
  onGo: (phase: P) => void;
  /** Forward is the quiet kind (Studia, until the blocks are done). */
  primary?: boolean;
}) {
  const prev =
    prevProp !== undefined
      ? prevProp
      : phase
        ? (previousPhase(phase) as { id: P; label: string } | null)
        : null;
  const next =
    nextProp !== undefined
      ? nextProp
      : phase
        ? (NEXT_ACTION[phase] as { to: P; label: string } | null)
        : null;
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
