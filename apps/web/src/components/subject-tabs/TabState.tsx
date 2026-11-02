import { BlockError, SkeletonRows } from '@/components/flashcards/shared/Skeletons';

export function TabLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Caricamento…</span>
      <SkeletonRows count={rows} />
    </div>
  );
}

export function TabError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <BlockError message={message} onRetry={onRetry} />;
}
