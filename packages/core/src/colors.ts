import { z } from 'zod';

/**
 * The 8 identity accents from docs/05-design-system.md §2.
 * Pure/browser-safe: kept in its own file, separate from manifest.ts (which
 * pulls in node:fs), so client components can import just this.
 */
export const SUBJECT_COLORS = [
  'violet',
  'blue',
  'cyan',
  'teal',
  'green',
  'amber',
  'rose',
  'magenta',
] as const;

export const SubjectColorSchema = z.enum(SUBJECT_COLORS);
export type SubjectColor = z.infer<typeof SubjectColorSchema>;
