import { useSyncExternalStore } from 'react';

/**
 * Writes are shown before the server has answered. When one fails, the change is taken back and this says so:
 * never silently. One notice at a time; a new failure starts it again.
 */
let failedAt: number | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function reportSaveFailed(): void {
  failedAt = Date.now();
  emit();
}

export function dismissSaveFailed(): void {
  failedAt = null;
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** When the last failure happened, or null while there is nothing to say. */
export const useSaveFailed = () => useSyncExternalStore(subscribe, () => failedAt);
