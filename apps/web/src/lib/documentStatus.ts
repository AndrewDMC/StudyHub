import type { DocumentDto } from '@studyhub/contracts';

export type DocumentStatusKey =
  | 'missing'
  | 'failed'
  | 'uploaded'
  | 'parsing'
  | 'conflict'
  | 'verify'
  | 'ready'
  | 'ready-original';

export interface DocumentStatusView {
  key: DocumentStatusKey;
  label: string;
  /** CSS color token (`var(--…)`) used for pill text and border. */
  tone: string;
  /** Where tapping the document leads. */
  href: (slug: string) => string;
}

type StatusFields = Pick<
  DocumentDto,
  'status' | 'type' | 'mdPath' | 'mdConflict' | 'blockedBlocks' | 'verificationStatus'
>;

const docHref = (slug: string, id: string, suffix = '') =>
  `/materie/${slug}/documenti/${id}${suffix}`;

/** Pill + tap destination of a document, first matching rule wins (spec §4). */
export function documentStatusView(
  doc: StatusFields & Pick<DocumentDto, 'id'>,
): DocumentStatusView {
  const to =
    (suffix = '') =>
    (slug: string) =>
      docHref(slug, doc.id, suffix);

  if (doc.status === 'missing')
    return { key: 'missing', label: 'Mancante', tone: 'var(--warn)', href: to() };
  if (doc.status === 'failed')
    return { key: 'failed', label: 'Errore', tone: 'var(--danger)', href: to() };
  if (doc.status === 'uploaded')
    return { key: 'uploaded', label: 'Caricato', tone: 'var(--fg-muted)', href: to() };
  if (doc.status === 'parsing')
    return { key: 'parsing', label: 'Estrazione…', tone: 'var(--info)', href: to() };
  if (doc.mdConflict)
    return { key: 'conflict', label: 'Conflitto', tone: 'var(--warn)', href: to() };
  if (
    doc.type === 'schemi' &&
    (doc.blockedBlocks > 0 ||
      doc.verificationStatus === 'pending' ||
      doc.verificationStatus === 'partial')
  )
    return { key: 'verify', label: 'Da verificare', tone: 'var(--warn)', href: to('/verifica') };
  if (doc.mdPath && (doc.type === 'appunti' || doc.type === 'altro' || doc.type === 'slide'))
    return { key: 'ready', label: 'Pronto', tone: 'var(--ok)', href: to() };
  return { key: 'ready-original', label: 'Pronto', tone: 'var(--ok)', href: to('/originale') };
}

/** Human type label for the list meta ("Appunti", "Schema a mano", "Esame passato"…). */
export function documentTypeLabel(doc: Pick<DocumentDto, 'type' | 'mime'>): string {
  switch (doc.type) {
    case 'appunti':
      return 'Appunti';
    case 'schemi':
      return doc.mime.startsWith('image/') ? 'Schema a mano' : 'Schema';
    case 'esami':
      return 'Esame passato';
    case 'slide':
      return 'Slide';
    default:
      return 'Altro';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "oggi", "ieri", "N giorni fa", "N settimane fa", then an it-IT date. */
export function formatDocDate(iso: string, now: Date = new Date()): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(new Date(iso))) / DAY_MS);
  if (days <= 0) return 'oggi';
  if (days === 1) return 'ieri';
  if (days < 7) return `${days} giorni fa`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return '1 settimana fa';
  if (weeks < 5) return `${weeks} settimane fa`;
  return new Date(iso).toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** 45 → "45 min", 60 → "1 ora", 180 → "3 ore", 90 → "1 h 30 min". */
export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return h === 1 ? '1 ora' : `${h} ore`;
  return `${h} h ${m} min`;
}
