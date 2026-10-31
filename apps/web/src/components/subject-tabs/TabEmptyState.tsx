import type { ReactNode } from 'react';
import { CARD_BOX } from './styles';

export function TabEmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className={`${CARD_BOX} flex flex-col items-center gap-3 border-dashed p-8 text-center`}>
      <p className="text-base font-semibold text-fg-primary">{title}</p>
      {text && <p className="max-w-sm text-sm text-fg-secondary">{text}</p>}
      {action}
    </div>
  );
}
