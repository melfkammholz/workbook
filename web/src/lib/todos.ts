import { useQuery } from '@tanstack/react-query';
import type { Todo, TodoLink } from '@wb/shared';
import { api } from './api';
import { queryClient } from './queryClient';

export const todosKey = ['todos'] as const;
export const useTodos = () => useQuery({ queryKey: todosKey, queryFn: () => api.get<Todo[]>('/api/todos'), staleTime: 60_000 });

const refresh = () => void queryClient.invalidateQueries({ queryKey: todosKey });

/** Applies `f` to the todo with this id wherever it sits in the tree. */
function mapTree(list: Todo[], id: string, f: (t: Todo) => Todo): Todo[] {
  return list.map((t) => (t.id === id ? f(t) : t.children.length ? { ...t, children: mapTree(t.children, id, f) } : t));
}

/** Shows a change at once; the server's answer replaces it, and a refusal takes it back. */
async function optimistic<T>(show: ((list: Todo[]) => Todo[]) | null, send: () => Promise<T>): Promise<T | null> {
  if (show) queryClient.setQueryData<Todo[]>(todosKey, (l) => (l ? show(l) : l));
  try {
    const out = await send();
    refresh();
    return out;
  } catch {
    refresh();
    return null;
  }
}

export type TodoPatch = Partial<Pick<Todo, 'title' | 'body' | 'status' | 'due' | 'minutes' | 'nextRank' | 'parentId' | 'course'>>;

export const patchTodo = (id: string, patch: TodoPatch) =>
  optimistic(
    (l) => mapTree(l, id, (t) => ({ ...t, ...patch, ...(patch.status ? { doneAt: patch.status === 'done' ? Date.now() : null } : {}) })),
    () => api.patch<Todo>(`/api/todos/${encodeURIComponent(id)}`, patch),
  );

export const addTodo = (a: { title: string; parentId?: string | null; course?: string | null; link?: TodoLink; minutes?: number; origin?: Todo['origin'] }) => {
  const id = crypto.randomUUID();
  const now = Date.now();
  const fresh: Todo = { id, parentId: a.parentId ?? null, sort: 1_000_000, title: a.title, body: null, status: 'open', course: a.course ?? null, link: a.link ?? null, due: null, minutes: a.minutes ?? null, nextRank: null, origin: a.origin ?? 'manual', createdAt: now, updatedAt: now, doneAt: null, children: [] };
  return optimistic(
    (l) => (a.parentId ? mapTree(l, a.parentId, (p) => ({ ...p, children: [...p.children, { ...fresh, course: p.course }] })) : [fresh, ...l]),
    () => api.post<Todo>('/api/todos', { id, ...a }),
  );
};

export const deleteTodo = (id: string) => optimistic(null, () => api.delete(`/api/todos/${encodeURIComponent(id)}`));
export const restoreTodo = (id: string) => optimistic(null, () => api.post(`/api/todos/${encodeURIComponent(id)}/restore`));

/** The next block, in this order. */
export const reorderNext = (ids: string[]) =>
  optimistic(
    (l) => l.map((t) => ({ ...t, nextRank: ids.includes(t.id) ? ids.indexOf(t.id) : null })),
    () => api.post('/api/todos/reorder', { ids }),
  );

/** The todo that already points at this, if it is not finished. */
export function useTodoFor(kind: TodoLink['kind'], ref: string): Todo | undefined {
  const { data } = useTodos();
  const find = (l: Todo[]): Todo | undefined => {
    for (const t of l) {
      if (t.link?.kind === kind && t.link.ref === ref && t.status !== 'done') return t;
      const c = find(t.children);
      if (c) return c;
    }
    return undefined;
  };
  return data ? find(data) : undefined;
}
