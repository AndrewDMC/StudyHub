import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, X } from 'lucide-react';

export const iconButton =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-fg-secondary hover:text-fg-primary disabled:opacity-40';

/**
 * Sticky header shared by Documento / Originale / Verifica (it replaces the global header below md):
 * back to Materiale, a centre block (title or custom content) and an action slot.
 */
export function DocHeader({
  backHref,
  title,
  subtitle,
  center,
  actions,
  backLabel = 'Torna al materiale',
  backIcon = 'back',
}: {
  backHref: string;
  title?: string | undefined;
  subtitle?: string | undefined;
  /** Replaces the title block (Originale puts the Testo | Originale switch here). */
  center?: ReactNode;
  actions?: ReactNode;
  backLabel?: string;
  backIcon?: 'back' | 'close';
}) {
  const BackIcon = backIcon === 'close' ? X : ArrowLeft;
  return (
    <div className="sticky top-0 z-10 border-b border-border bg-bg-surface pt-[env(safe-area-inset-top)]">
      <div className="flex h-[52px] items-center gap-1 px-1">
        <Link href={backHref} aria-label={backLabel} className={iconButton}>
          <BackIcon className="h-5 w-5" aria-hidden="true" />
        </Link>
        {center ?? (
          <div className="min-w-0 flex-1 px-1">
            {subtitle && <p className="truncate text-xs text-fg-muted">{subtitle}</p>}
            {title ? (
              <h1 className="truncate text-[15px] font-semibold leading-tight">{title}</h1>
            ) : (
              <div aria-hidden="true" className="h-4 w-40 animate-pulse rounded bg-bg-raised" />
            )}
          </div>
        )}
        {actions}
      </div>
    </div>
  );
}
