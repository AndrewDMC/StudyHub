export const MOBILE_TABS = [
  'panoramica',
  'materiale',
  'flashcard',
  'simulazioni',
  'lacune',
] as const;
export type MobileTab = (typeof MOBILE_TABS)[number];

export const MATERIAL_FILTERS = ['tutti', 'appunti', 'schemi', 'esami', 'altro'] as const;
export type MaterialFilter = (typeof MATERIAL_FILTERS)[number];

export const MATERIAL_FILTER_LABELS: Record<MaterialFilter, string> = {
  tutti: 'Tutti',
  appunti: 'Appunti',
  schemi: 'Schemi',
  esami: 'Esami',
  altro: 'Altro',
};

type ParamReader = { get(name: string): string | null };

function isFilter(value: string | null): value is MaterialFilter {
  return MATERIAL_FILTERS.includes(value as MaterialFilter);
}

/**
 * Maps `?tab=` (+ `?filtro=`) onto the six mobile tabs. The legacy desktop values
 * appunti/schemi/esami/altro all open Materiale with the matching filter.
 */
export function parseSubjectTab(params: ParamReader): { tab: MobileTab; filter: MaterialFilter } {
  const raw = params.get('tab');
  if (raw === 'materiale') {
    const f = params.get('filtro');
    return { tab: 'materiale', filter: isFilter(f) ? f : 'tutti' };
  }
  if (raw === 'appunti' || raw === 'schemi' || raw === 'esami' || raw === 'altro') {
    return { tab: 'materiale', filter: raw };
  }
  if (raw === 'flashcard' || raw === 'simulazioni' || raw === 'lacune') {
    return { tab: raw, filter: 'tutti' };
  }
  return { tab: 'panoramica', filter: 'tutti' };
}

export interface TabLink {
  key: MobileTab | 'piano';
  label: string;
  href: string;
}

/** The six mobile tab links, in design order; Piano leaves the page. */
export function tabLinks(slug: string): TabLink[] {
  const base = `/materie/${slug}`;
  return [
    { key: 'panoramica', label: 'Panoramica', href: base },
    { key: 'materiale', label: 'Materiale', href: `${base}?tab=materiale` },
    { key: 'flashcard', label: 'Flashcard', href: `${base}?tab=flashcard` },
    { key: 'simulazioni', label: 'Simulazioni', href: `${base}?tab=simulazioni` },
    { key: 'lacune', label: 'Lacune', href: `${base}?tab=lacune` },
    { key: 'piano', label: 'Piano', href: `${base}/piano` },
  ];
}

/** Href for a Materiale filter chip (`tutti` = no `filtro` parameter). */
export function materialHref(slug: string, filter: MaterialFilter): string {
  return `/materie/${slug}?tab=materiale${filter === 'tutti' ? '' : `&filtro=${filter}`}`;
}
