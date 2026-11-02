import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CARD_BOX, SECTION_TITLE } from './styles';

/**
 * Surface card with an optional small uppercase title. With `label` the section is named by the
 * title; `aria-label` overrides the accessible name (e.g. when the title must not be the name).
 */
export function TabCard({
  label,
  labelId,
  className,
  children,
  'aria-label': ariaLabel,
}: {
  label?: string;
  labelId?: string;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
}) {
  const named = ariaLabel
    ? { 'aria-label': ariaLabel }
    : label && labelId
      ? { 'aria-labelledby': labelId }
      : {};
  return (
    <section {...named} className={cn(CARD_BOX, 'flex min-w-0 flex-col gap-4 p-5', className)}>
      {label && (
        <h2 id={labelId} className={SECTION_TITLE}>
          {label}
        </h2>
      )}
      {children}
    </section>
  );
}
