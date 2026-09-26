import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * shadcn-style variant button, restyled onto this project's own design
 * tokens (docs/05-design-system.md) rather than shadcn's default palette —
 * same classes CreateSubjectForm.tsx already used by hand.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-medium transition-colors duration-120 disabled:pointer-events-none disabled:opacity-60 outline-none focus-visible:border-accent',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white hover:bg-accent-hover',
        secondary: 'border border-border text-fg-secondary hover:text-fg-primary',
        ghost: 'text-fg-secondary hover:bg-bg-raised hover:text-fg-primary',
        danger: 'bg-danger text-white hover:opacity-90',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-8 px-3 py-1.5',
        lg: 'h-10 px-4',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';
