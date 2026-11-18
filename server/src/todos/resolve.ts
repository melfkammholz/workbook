import type { Todo, TodoLink, TodoTarget } from '@wb/shared';
import type { Deps } from '../api/deps.js';

/**
 * Where a todo's link leads now. Items are looked up in the open workbook only: a link into another workbook keeps its
 * stored title and has no route until that workbook is open.
 */
export function resolveTodoLink(d: Deps, link: TodoLink, course: string | null): TodoTarget {
  const stored = link.title ?? link.ref;
  switch (link.kind) {
    case 'item':
    case 'page': {
      const content = d.courses.active ? d.content.current : null;
      const item = content?.get(link.ref);
      if (item) {
        const type = item.meta.type;
        return { title: item.meta.title, kind: type, href: `/item/${encodeURIComponent(link.ref)}`, gone: false };
      }
      const here = content?.outline.id;
      const elsewhere = course !== null && here !== undefined && course !== here;
      return { title: stored, kind: link.kind === 'page' ? 'page' : 'exercise', href: null, gone: !elsewhere };
    }
    case 'deck': {
      const title = d.courses.flashcards.titleOf(link.ref);
      return title !== null ? { title, kind: 'deck', href: `/flashcards/deck/${encodeURIComponent(link.ref)}`, gone: false } : { title: stored, kind: 'deck', href: null, gone: true };
    }
    case 'resource': {
      const res = d.courses.resources.list().resources.find((x) => x.id === link.ref);
      return res ? { title: res.title, kind: 'resource', href: `/resources/${encodeURIComponent(link.ref)}`, gone: false } : { title: stored, kind: 'resource', href: null, gone: true };
    }
    default:
      return { title: stored, kind: 'url', href: /^https?:\/\//.test(link.ref) ? link.ref : null, gone: false };
  }
}

/** The same todos with `target` filled in, parts included. */
export function withTargets(d: Deps, todos: Todo[]): Todo[] {
  return todos.map((t) => ({
    ...t,
    target: t.link ? resolveTodoLink(d, t.link, t.course) : null,
    children: withTargets(d, t.children),
  }));
}
