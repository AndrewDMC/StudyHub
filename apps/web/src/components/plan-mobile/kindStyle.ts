import type { CSSProperties } from 'react';
import type { TaskDto } from '@studyhub/contracts';
import { kindColor, type KindColor } from '@/lib/planMobile';

const BAR_CLASS: Record<KindColor, string> = {
  accent: 'bg-accent',
  subject: '',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  muted: 'bg-border-strong',
};

/** Background of the colour bar / dot of a task kind; `flashcards` takes the subject colour inline. */
export function kindBar(
  kind: TaskDto['kind'],
  subjectHex: string | undefined,
): { className: string; style: CSSProperties | undefined } {
  const color = kindColor(kind);
  return {
    className: BAR_CLASS[color],
    style: color === 'subject' && subjectHex ? { backgroundColor: subjectHex } : undefined,
  };
}
