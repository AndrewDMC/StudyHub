import Link from 'next/link';

const base =
  'flex min-h-11 flex-1 items-center justify-center rounded-[var(--radius-control)] text-sm';

/** Testo | Originale: two routes, so links with `aria-current` rather than tabs. */
export function DocumentViewSwitch({
  slug,
  documentId,
  active,
  textAvailable = true,
}: {
  slug: string;
  documentId: string;
  active: 'testo' | 'originale';
  /** False when the document has no extracted text: "Testo" is shown but not a link. */
  textAvailable?: boolean;
}) {
  const href = `/materie/${slug}/documenti/${documentId}`;
  const on = 'bg-bg-raised font-medium text-fg-primary';
  const off = 'text-fg-secondary';
  return (
    <nav
      aria-label="Vista del documento"
      className="flex min-w-0 flex-1 gap-1 rounded-[var(--radius-control)] border border-border bg-bg-inset p-0.5"
    >
      {textAvailable ? (
        <Link
          href={href}
          replace
          aria-current={active === 'testo' ? 'page' : undefined}
          className={`${base} ${active === 'testo' ? on : off}`}
        >
          Testo
        </Link>
      ) : (
        <span aria-disabled="true" className={`${base} text-fg-muted`}>
          Testo
        </span>
      )}
      <Link
        href={`${href}/originale`}
        replace
        aria-current={active === 'originale' ? 'page' : undefined}
        className={`${base} ${active === 'originale' ? on : off}`}
      >
        Originale
      </Link>
    </nav>
  );
}
