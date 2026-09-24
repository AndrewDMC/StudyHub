import type { SubjectColor } from '@studyhub/core/browser';

/**
 * Hex values for the 8 identity accents (docs/05-design-system.md §2 names
 * them but does not fix hex codes — decided here, F0).
 */
export const SUBJECT_COLOR_HEX: Record<SubjectColor, string> = {
  violet: '#8B5CF6',
  blue: '#4C8DFF',
  cyan: '#22D3EE',
  teal: '#2DD4BF',
  green: '#3DD68C',
  amber: '#F5B544',
  rose: '#FB7185',
  magenta: '#E879F9',
};
