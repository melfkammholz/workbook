import { useSyncExternalStore } from 'react';
import { readPref, writePref } from './shell';

/**
 * How an exercise with code is laid out. Standard: the task and the workspace side by side, the editor over its
 * feedback. Wide: the task folds into a strip, the editor takes the middle, and feedback (and, for an SLD tree, its
 * picture) moves to the right. Remembered per browser.
 */
export type WorkLayout = 'standard' | 'wide';

const KEY = 'wb-work-layout';
const LAYOUTS = ['standard', 'wide'] as const;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changed it.
  const onStorage = (e: StorageEvent) => e.key === KEY && listener();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useWorkLayout(): [WorkLayout, (layout: WorkLayout) => void] {
  const layout = useSyncExternalStore(
    subscribe,
    () => readPref<WorkLayout>(KEY, LAYOUTS, 'standard'),
    (): WorkLayout => 'standard',
  );
  return [
    layout,
    (next) => {
      writePref(KEY, next);
      for (const l of listeners) l();
    },
  ];
}
