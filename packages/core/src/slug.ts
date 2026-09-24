const MAX_SLUG_LENGTH = 64;

// https://learn.microsoft.com/windows/win32/fileio/naming-a-file — case-insensitive.
const WINDOWS_RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/**
 * Turns an arbitrary display name into a filesystem- and URL-safe slug:
 * lowercase `[a-z0-9-]`, ASCII-only (diacritics stripped, not dropped — "è" -> "e"),
 * never a Windows reserved device name, bounded length.
 *
 * The slug is stable identity for the on-disk folder (see docs/fasi/F0-fondamenta.md
 * "Ordine di verità"): renaming a subject must never change it.
 */
export function slugify(input: string): string {
  const normalized = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase();

  let slug = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');

  if (slug.length === 0) {
    slug = 'subject';
  }

  if (WINDOWS_RESERVED_NAMES.has(slug)) {
    slug = `${slug}-subject`;
  }

  return slug;
}

/**
 * Appends `-2`, `-3`, ... until the slug is not in `taken`. Used when creating a
 * subject whose slugified name collides with an existing folder.
 */
export function disambiguateSlug(baseSlug: string, taken: ReadonlySet<string>): string {
  if (!taken.has(baseSlug)) return baseSlug;

  let n = 2;
  let candidate = `${baseSlug}-${n}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${baseSlug}-${n}`;
  }
  return candidate;
}

export function isValidSlug(value: string): boolean {
  if (value.length === 0 || value.length > MAX_SLUG_LENGTH) return false;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) return false;
  if (WINDOWS_RESERVED_NAMES.has(value)) return false;
  return true;
}
