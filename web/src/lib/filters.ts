import type { ExerciseKind, ItemMeta, Status, TagInfo, ThreadInfo } from '@wb/shared';
import { useCallback, useEffect, useState } from 'react';

export interface Filters {
  q: string;
  statuses: Status[];
  tags: string[];
  /** Adventures the exercise has to be part of. */
  threads: string[];
  levels: (1 | 2 | 3)[];
  kinds: ExerciseKind[];
  hideLong: boolean;
}

export const NO_FILTERS: Filters = { q: '', statuses: [], tags: [], threads: [], levels: [], kinds: [], hideLong: false };

const KEY = 'wb-filters';

export function load(): Filters {
  try {
    // Only known keys: an older version saved filters that are gone now (such as "recommended first", which the focus replaced).
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Filters>;
    return Object.fromEntries(Object.entries(NO_FILTERS).map(([k, v]) => [k, saved[k as keyof Filters] ?? v])) as unknown as Filters;
  } catch {
    return NO_FILTERS;
  }
}

export function useFilters() {
  const [filters, setFilters] = useState<Filters>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(filters));
    } catch {
      /* ignore */
    }
  }, [filters]);
  const patch = useCallback((p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p })), []);
  const reset = useCallback(() => setFilters(NO_FILTERS), []);
  return { filters, patch, reset };
}

/** Number of active structural filters (the text query is shown in its own box). */
export function activeCount(f: Filters): number {
  return f.statuses.length + f.tags.length + f.threads.length + f.levels.length + f.kinds.length + (f.hideLong ? 1 : 0);
}

export function matches(item: ItemMeta, status: Status, f: Filters, tags: TagInfo[] = [], threads: ThreadInfo[] = []): boolean {
  const q = f.q.trim().toLowerCase();
  const label = (id: string) => tags.find((t) => t.id === id)?.label.toLowerCase() ?? '';
  if (q && !item.title.toLowerCase().includes(q) && !item.id.includes(q) && !(item.type === 'exercise' && item.tags.some((t) => t.toLowerCase().includes(q) || label(t).includes(q)))) return false;
  const structural = activeCount(f) > 0;
  if (item.type !== 'exercise') return !structural;
  if (f.statuses.length && !f.statuses.includes(status)) return false;
  if (f.tags.length && !f.tags.some((t) => item.tags.includes(t))) return false;
  if (f.threads.length && !threads.some((t) => f.threads.includes(t.id) && t.steps.some((step) => step.includes(item.id)))) return false;
  if (f.levels.length && !f.levels.includes(item.level)) return false;
  if (f.kinds.length && !f.kinds.includes(item.kind)) return false;
  if (f.hideLong && item.long) return false;
  return true;
}
