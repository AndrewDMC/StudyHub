/** Class strings shared by the Flashcard tab (desktop sizes; `max-md:` raises targets to 44px). */
export const FOCUS =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export const BTN_PRIMARY = `inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-accent px-4 text-[13px] font-semibold text-bg-base transition-colors duration-120 hover:bg-accent-hover disabled:opacity-60 max-md:h-11 ${FOCUS}`;

export const BTN_SECONDARY = `inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border-strong px-3.5 text-[13px] font-medium text-fg-primary transition-colors duration-120 hover:bg-bg-raised disabled:opacity-60 max-md:h-11 ${FOCUS}`;

export const BTN_GHOST = `inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-[13px] text-fg-secondary transition-colors duration-120 hover:text-fg-primary disabled:opacity-60 max-md:min-h-11 ${FOCUS}`;

export const LINK_TEXT = `inline-flex min-h-10 items-center text-[13px] text-accent-hover hover:underline max-md:min-h-11 ${FOCUS}`;

export const ICON_BTN = `inline-flex size-10 items-center justify-center rounded-[var(--radius-control)] text-fg-secondary transition-colors duration-120 hover:bg-bg-raised hover:text-fg-primary max-md:size-11 ${FOCUS}`;

export const FIELD =
  'w-full rounded-[var(--radius-control)] border border-border-strong bg-bg-inset px-3 text-sm text-fg-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent max-md:text-base';

export const INPUT = `${FIELD} h-10 max-md:h-11`;
export const TEXTAREA = `${FIELD} resize-y py-2.5`;

export const LABEL = 'flex flex-col gap-1.5 text-[13px] text-fg-secondary';

export const CARD_BOX = 'rounded-[var(--radius-card)] border border-border bg-bg-surface';

export const SECTION_TITLE = 'text-xs font-medium uppercase tracking-[0.05em] text-fg-secondary';

export const SKELETON = 'animate-pulse bg-bg-raised motion-reduce:animate-none';
