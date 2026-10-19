'use client';

import * as React from 'react';
import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * Action menu (Radix DropdownMenu): arrow keys, Home/End, typeahead, Esc with focus back on the
 * trigger. `trigger` is a real `button` that carries its own contextual name.
 */
export function Menu({
  label,
  trigger,
  align = 'end',
  children,
}: {
  label: string;
  trigger: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  children: React.ReactNode;
}) {
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger asChild>{trigger}</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content
          aria-label={label}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 min-w-[220px] max-w-[min(320px,calc(100vw-2rem))] rounded-[var(--radius-card)] border border-border-strong bg-bg-raised p-1.5 text-fg-primary shadow-lg outline-none"
        >
          {children}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

const ITEM =
  'relative flex min-h-10 w-full cursor-pointer select-none items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-1.5 text-left text-[13px] outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-bg-surface';

/** A plain action (`onSelect`), or with `asChild` a link whose child element gets the item role. */
export function MenuItem({
  onSelect,
  tone,
  description,
  asChild,
  disabled,
  children,
}: {
  onSelect?: (event: Event) => void;
  tone?: 'danger';
  description?: string;
  asChild?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const cls = cn(ITEM, tone === 'danger' && 'text-danger', description && 'min-h-11');
  const body = description ? (
    <span className="flex min-w-0 flex-col">
      <span>{children}</span>
      <span className="text-xs text-fg-secondary">{description}</span>
    </span>
  ) : (
    children
  );
  if (asChild) {
    return (
      <MenuPrimitive.Item asChild className={cls} disabled={disabled}>
        {children as React.ReactElement}
      </MenuPrimitive.Item>
    );
  }
  return (
    <MenuPrimitive.Item className={cls} disabled={disabled} onSelect={onSelect}>
      {body}
    </MenuPrimitive.Item>
  );
}

export function MenuSeparator() {
  return <MenuPrimitive.Separator className="my-1.5 h-px bg-border" />;
}

/** Non-focusable heading of a group of items. */
export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <MenuPrimitive.Label className="px-2.5 pb-1 pt-1.5 text-xs text-fg-secondary">
      {children}
    </MenuPrimitive.Label>
  );
}

export function MenuRadioGroup({
  value,
  onValueChange,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <MenuPrimitive.RadioGroup value={value} onValueChange={onValueChange}>
      {children}
    </MenuPrimitive.RadioGroup>
  );
}

/** `role="menuitemradio"`. */
export function MenuRadioItem({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <MenuPrimitive.RadioItem value={value} className={cn(ITEM, 'pl-7')}>
      <MenuPrimitive.ItemIndicator className="absolute left-2.5 text-accent-hover">
        <span aria-hidden="true">✓</span>
      </MenuPrimitive.ItemIndicator>
      {children}
    </MenuPrimitive.RadioItem>
  );
}
