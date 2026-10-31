import { useId, type ReactNode } from 'react';

/** Titled block of a tab (`<section>` labelled by its `<h2>`), optional count and actions. */
export function TabSection({
  title,
  count,
  description,
  actions,
  children,
}: {
  title: string;
  count?: number;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={id} className="text-base font-semibold text-fg-primary">
            {title}
            {count !== undefined && (
              <span className="ml-1 text-sm font-normal text-fg-secondary">· {count}</span>
            )}
          </h2>
          {description && <p className="text-[13px] text-fg-secondary">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
