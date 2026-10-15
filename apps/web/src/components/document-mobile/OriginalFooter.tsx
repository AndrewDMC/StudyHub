import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { iconButton } from './DocHeader';

/** Zoom and (for PDFs with a known page count) page controls of the Originale viewer. */
export function OriginalFooter({
  zoomLabel,
  canZoomOut,
  canZoomIn,
  onZoomOut,
  onZoomIn,
  pager,
}: {
  zoomLabel: string;
  canZoomOut: boolean;
  canZoomIn: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  pager?: undefined | { page: number; pages: number; onPrev: () => void; onNext: () => void };
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-bg-surface px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2">
      <div className="flex items-center">
        <button
          type="button"
          aria-label="Riduci"
          disabled={!canZoomOut}
          onClick={onZoomOut}
          className={iconButton}
        >
          <Minus className="h-5 w-5" aria-hidden="true" />
        </button>
        <span
          aria-live="polite"
          className="min-w-12 text-center font-mono text-xs text-fg-secondary"
        >
          {zoomLabel}
        </span>
        <button
          type="button"
          aria-label="Ingrandisci"
          disabled={!canZoomIn}
          onClick={onZoomIn}
          className={iconButton}
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {pager && (
        <div className="flex items-center">
          <button
            type="button"
            aria-label="Pagina precedente"
            disabled={pager.page <= 1}
            onClick={pager.onPrev}
            className={iconButton}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <span aria-live="polite" className="min-w-14 text-center font-mono text-sm">
            {pager.page} / {pager.pages}
          </span>
          <button
            type="button"
            aria-label="Pagina successiva"
            disabled={pager.page >= pager.pages}
            onClick={pager.onNext}
            className={iconButton}
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
