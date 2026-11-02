import type { ReactNode } from 'react';

/** Tab intro line: description on the left, tab actions on the right. */
export function TabHeader({
  description,
  actions,
}: {
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {description ? (
        <p className="max-w-[620px] text-[13px] text-fg-secondary">{description}</p>
      ) : (
        <span />
      )}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
