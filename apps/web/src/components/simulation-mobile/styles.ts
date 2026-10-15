import type { Tone } from '@/lib/simulationMobile';

export const primaryButton =
  'flex w-full items-center justify-center rounded-[var(--radius-control)] bg-accent px-4 font-semibold text-bg-base disabled:opacity-50';
export const secondaryButton =
  'flex w-full items-center justify-center rounded-[var(--radius-control)] border border-border-strong bg-bg-raised px-4 text-sm font-semibold text-fg-primary disabled:opacity-50';
export const fieldClass =
  'min-h-11 w-full rounded-[var(--radius-control)] border border-border bg-bg-inset px-3 text-base text-fg-primary outline-none focus:border-accent';
export const cardClass = 'rounded-[var(--radius-card)] border border-border bg-bg-surface';

export const toneBg: Record<Tone, string> = {
  accent: 'bg-accent',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
};
export const toneText: Record<Tone, string> = {
  accent: 'text-accent',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
};
