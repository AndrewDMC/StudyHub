import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-[var(--radius-control)] border border-border bg-bg-inset px-3 py-2 text-sm text-fg-primary outline-none focus:border-accent disabled:opacity-60',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
