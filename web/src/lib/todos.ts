import { useQuery } from '@tanstack/react-query';
import type { Todo, TodoLink } from '@wb/shared';
import { api, askQuestion, keys, type QuestionPlace } from './api';
import { showLineNote } from './lineToast';
import type { Outline } from '@wb/shared';
import { queryClient } from './queryClient';
import { setTagsOn } from './tags';

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

export type TodoPatch = Partial<Pick<Todo, 'title' | 'body' | 'status' | 'due' | 'minutes' | 'nextRank' | 'parentId' | 'course' | 'sort'>> & { manual?: false };

export const patchTodo = (id: string, patch: TodoPatch) =>
  optimistic(
    (l) => mapTree(l, id, (t) => ({ ...t, ...patch, ...(patch.status ? { manual: true } : {}), ...(patch.status ? { doneAt: patch.status === 'done' ? Date.now() : null } : {}) })),
    () => api.patch<Todo>(`/api/todos/${encodeURIComponent(id)}`, patch),
  );

/** Puts exactly these tags on a todo. */
export const setTodoTags = (id: string, tags: string[]) =>
  optimistic(
    (l) => mapTree(l, id, (t) => ({ ...t, tags })),
    () => setTagsOn('todo', id, tags),
  );

export const addTodo = (a: { title: string; parentId?: string | null; course?: string | null; link?: TodoLink; minutes?: number; origin?: Todo['origin'] }) => {
  const id = crypto.randomUUID();
  const now = Date.now();
  const fresh: Todo = { id, parentId: a.parentId ?? null, sort: 1_000_000, title: a.title, body: null, status: 'open', storedStatus: 'open', manual: false, follow: false, tags: [], course: a.course ?? null, link: a.link ?? null, due: null, minutes: a.minutes ?? null, nextRank: null, origin: a.origin ?? 'manual', createdAt: now, updatedAt: now, doneAt: null, children: [] };
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

/**
 * The ticket line: `!todo text` adds a todo (linked to the item being looked at, if any); any other text is a question.
 * An unknown `!x` stays a question, so nothing typed is lost, with a hint.
 */
export function askOrTodo(where: QuestionPlace, text: string) {
  const m = /^!(\S+)\s*([\s\S]*)$/.exec(text.trim());
  if (m && m[1]!.toLowerCase() === 'todo' && m[2]!.trim()) {
    const item = where.item && !where.item.startsWith('chapter/') ? where.item : null;
    const course = queryClient.getQueryData<Outline>(keys.outline)?.id ?? null;
    showLineNote({ kind: 'todo' });
    return addTodo({ title: m[2]!.trim(), course: item ? course : null, origin: 'ticket-line', ...(item ? { link: { kind: 'item' as const, ref: item, title: null } } : {}) });
  }
  if (m) showLineNote({ kind: 'unknown', cmd: m[1]! });
  return askQuestion(where, text);
}
