import type { ReactNode } from 'react';
import { BTN_PRIMARY, BTN_SECONDARY, CARD_BOX } from './styles';

/** Subject without any card: the two ways to get started. */
export function EmptyState({
  title = 'Nessuna flashcard ancora',
  text = 'Genera un mazzo dal materiale o scrivi la prima card a mano.',
  onGenerate,
  onWrite,
  writeLabel = 'Scrivi a mano',
  extra,
}: {
  title?: string;
  text?: string;
  onGenerate: () => void;
  onWrite: () => void;
  writeLabel?: string;
  extra?: ReactNode;
}) {
  return (
    <div className={`${CARD_BOX} flex flex-col items-center gap-3 border-dashed p-8 text-center`}>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-fg-secondary">{text}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={onGenerate} className={BTN_PRIMARY}>
          Genera con l&apos;AI
        </button>
        <button type="button" onClick={onWrite} className={BTN_SECONDARY}>
          {writeLabel}
        </button>
      </div>
      {extra}
    </div>
  );
}
