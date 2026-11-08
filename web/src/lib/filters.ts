import type { ExerciseKind, ItemMeta, Status, TagInfo, ThreadInfo } from '@wb/shared';
import { useCallback, useEffect, useState } from 'react';

/** What an item is, as the filter offers it. */
export type ItemType = ItemMeta['type'];
export const ITEM_TYPES: ItemType[] = ['exercise', 'lesson', 'page', 'checklist'];

export interface Filters {
  q: string;
  /** Which kinds of item to show: exercises, lessons, pages, self-evaluations. Empty is all of them. */
  types: ItemType[];
  statuses: Status[];
  tags: string[];
  /** Adventures the exercise has to be part of. */
  threads: string[];
  levels: (1 | 2 | 3)[];
  kinds: ExerciseKind[];
  hideLong: boolean;
}

export const NO_FILTERS: Filters = { q: '', types: [], statuses: [], tags: [], threads: [], levels: [], kinds: [], hideLong: false };

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
  return f.types.length + f.statuses.length + f.tags.length + f.threads.length + f.levels.length + f.kinds.length + (f.hideLong ? 1 : 0);
}

export function matches(item: ItemMeta, status: Status, f: Filters, tags: TagInfo[] = [], threads: ThreadInfo[] = []): boolean {
  const q = f.q.trim().toLowerCase();
  const label = (id: string) => tags.find((t) => t.id === id)?.label.toLowerCase() ?? '';
  const tagged = 'tags' in item ? item.tags : [];
  if (q && !item.title.toLowerCase().includes(q) && !item.id.includes(q) && !tagged.some((t) => t.toLowerCase().includes(q) || label(t).includes(q))) return false;
  if (f.types.length && !f.types.includes(item.type)) return false;
  // Exercises and lessons have a status; pages and self-evaluations have none to filter by.
  if (f.statuses.length && (!(item.type === 'exercise' || item.type === 'lesson') || !f.statuses.includes(status))) return false;
  if (f.tags.length && !f.tags.some((t) => tagged.includes(t))) return false;
  if (f.threads.length && !threads.some((t) => f.threads.includes(t.id) && t.steps.some((step) => step.includes(item.id)))) return false;
  // Difficulty, kind and pace only describe exercises: with any of them on, the rest steps aside.
  const exerciseOnly = f.levels.length + f.kinds.length + (f.hideLong ? 1 : 0) > 0;
  if (item.type !== 'exercise') return !exerciseOnly;
  if (f.levels.length && !f.levels.includes(item.level)) return false;
  if (f.kinds.length && !f.kinds.includes(item.kind)) return false;
  if (f.hideLong && item.long) return false;
  return true;
}
