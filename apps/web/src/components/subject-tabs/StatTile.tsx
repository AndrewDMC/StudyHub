import type { ReactNode } from 'react';
import { CARD_BOX } from './styles';

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint: string;
}) {
  return (
    <div className={`${CARD_BOX} flex flex-col gap-1 px-5 py-4`}>
      <p className="text-xs uppercase tracking-[0.05em] text-fg-secondary">{label}</p>
      <p className="text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-fg-primary">
        {value}
      </p>
      <p className="text-[13px] text-fg-secondary">{hint}</p>
    </div>
  );
}
