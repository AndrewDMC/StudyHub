import { BTN_SECONDARY, CARD_BOX, SKELETON } from './styles';

/** Placeholder rows; hidden from AT, the host section carries `aria-busy`. */
export function SkeletonRows({ count, height = 'h-[68px]' }: { count: number; height?: string }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`${height} rounded-[var(--radius-card)] ${SKELETON}`} />
      ))}
    </div>
  );
}

export function SkeletonBlock({ className }: { className: string }) {
  return (
    <div aria-hidden="true" className={`rounded-[var(--radius-card)] ${SKELETON} ${className}`} />
  );
}

/** Error of one block with its retry: the rest of the page keeps working. */
export function BlockError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className={`${CARD_BOX} flex flex-wrap items-center gap-3 border-danger p-4 text-sm`}
    >
      <p className="flex-1 text-danger">{message}</p>
      <button type="button" onClick={onRetry} className={BTN_SECONDARY}>
        Riprova
      </button>
    </div>
  );
}
