import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class names — `clsx` for conditional logic, `twMerge` to
 * dedupe conflicting utilities (so `cn('p-2', condition && 'p-4')` ends
 * up with just `p-4`).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
