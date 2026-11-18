import { useSyncExternalStore } from 'react';

/** What the ticket line just did with a `!command`: the toast says it. */
export type LineNote = { kind: 'todo'; id: number } | { kind: 'unknown'; id: number; cmd: string };

let current: LineNote | null = null;
let seq = 0;
const listeners = new Set<() => void>();

export function showLineNote(n: { kind: 'todo' } | { kind: 'unknown'; cmd: string }) {
  current = { ...n, id: ++seq };
  listeners.forEach((l) => l());
}
export function dismissLineNote() {
  current = null;
  listeners.forEach((l) => l());
}
export const useLineNote = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => current,
  );
