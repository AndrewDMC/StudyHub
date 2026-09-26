import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn/ui's standard className merge helper (clsx + tailwind-merge). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
