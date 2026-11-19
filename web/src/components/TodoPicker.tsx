import * as DialogPrimitive from '@radix-ui/react-dialog';
import clsx from 'clsx';
import { useMemo, useState } from 'react';
import type { ItemMeta, ThreadInfo, Todo } from '@wb/shared';
import { useOutline } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { addTodo, addTodoTree } from '@/lib/todos';
import { plainTitle } from './Title';

/** Pages have no done state, so a part linked to one cannot follow anything. */
const follows = (i: ItemMeta) => i.type !== 'page';
const linkOf = (i: ItemMeta) => ({ kind: i.type === 'page' ? ('page' as const) : ('item' as const), ref: i.id, title: plainTitle(i.title) });

/** The items of a path, once each, in order. */
export const threadItemIds = (thread: ThreadInfo): string[] => [...new Set(thread.steps.flat())];
export const threadRef = (id: string) => `thread/${id}`;

function Shell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="wb-overlay fixed inset-0 z-[60] bg-ink/30" />
        <DialogPrimitive.Content aria-describedby={undefined} className="wb-dialog fixed left-1/2 top-[10vh] z-[70] flex max-h-[80vh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 flex-col rounded-xl border border-line-strong bg-sheet shadow-[var(--shadow)]">
          <DialogPrimitive.Title className="px-5 pt-4 text-[16px] font-semibold">{title}</DialogPrimitive.Title>
          {children}
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

const primary = 'h-8 rounded-md bg-accent px-4 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40';

function Row({ item, checked, disabled, note, onToggle }: { item: ItemMeta; checked: boolean; disabled?: boolean; note?: string; onToggle: () => void }) {
  return (
    <label className={clsx('flex items-center gap-2 rounded-md px-2 py-1 text-[13.5px]', disabled ? 'text-ink-3' : 'cursor-pointer hover:bg-sunk/60')}>
      <input type="checkbox" checked={checked || !!disabled} disabled={disabled} onChange={onToggle} className="size-3.5 accent-[var(--accent)]" />
      <span className="min-w-0 flex-1 truncate">{plainTitle(item.title)}</span>
      {note ? <span className="text-[12px]">{note}</span> : null}
    </label>
  );
}

function useToggle(initial: () => string[] = () => []): [Set<string>, (id: string) => void, (ids: string[]) => void] {
  const [set, setSet] = useState<Set<string>>(() => new Set(initial()));
  return [
    set,
    (id) => setSet((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    (ids) => setSet(new Set(ids)),
  ];
}

/** Picker D, left: items of the workbook to link as parts of a todo. Linked ones are grey. */
export function LinkPicker({ parent, onClose }: { parent: Todo; onClose: () => void }) {
  const t = useT();
  const outline = useOutline().data;
  const [q, setQ] = useState('');
  const [chosen, toggle] = useToggle();
  const linked = useMemo(() => new Set(parent.children.filter((c) => c.link).map((c) => c.link!.ref)), [parent]);
  const needle = q.trim().toLowerCase();
  const chapters = (outline?.chapters ?? [])
    .map((c) => ({ c, items: c.items.filter((i) => !needle || plainTitle(i.title).toLowerCase().includes(needle)) }))
    .filter((x) => x.items.length);
  const byId = useMemo(() => new Map((outline?.chapters ?? []).flatMap((c) => c.items).map((i) => [i.id, i])), [outline]);
  const add = () => {
    for (const id of chosen) {
      const i = byId.get(id);
      if (i) void addTodo({ title: plainTitle(i.title), parentId: parent.id, link: linkOf(i), follow: follows(i), origin: 'item' });
    }
    onClose();
  };
  return (
    <Shell
      title={t.tdLinkFrom}
      onClose={onClose}
      footer={
        <button type="button" disabled={chosen.size === 0} onClick={add} className={primary}>
          {t.tdPickAdd(chosen.size)}
        </button>
      }
    >
      <div className="px-5 pt-3">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.tdPickSearch} aria-label={t.tdPickSearch} className="h-8 w-full rounded-md border border-line-strong bg-sheet px-2 text-[13.5px]" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {chapters.length === 0 ? <p className="px-2 py-2 text-[13px] text-ink-3">{t.tdPickNone}</p> : null}
        {chapters.map(({ c, items }) => (
          <section key={c.id} className="mb-2">
            <h3 className="px-2 py-1 text-[12.5px] text-ink-3">{(c.number !== null ? `${c.number}. ` : '') + plainTitle(c.title)}</h3>
            {items.map((i) => (
              <Row key={i.id} item={i} checked={chosen.has(i.id)} disabled={linked.has(i.id)} {...(linked.has(i.id) ? { note: t.tdPickLinked } : {})} onToggle={() => toggle(i.id)} />
            ))}
          </section>
        ))}
      </div>
    </Shell>
  );
}

/** Picker D, right: a path becomes a todo with its items as parts. */
export function PathPicker({ thread, onClose }: { thread: ThreadInfo; onClose: () => void }) {
  const t = useT();
  const outline = useOutline().data;
  const byId = useMemo(() => new Map((outline?.chapters ?? []).flatMap((c) => c.items).map((i) => [i.id, i])), [outline]);
  const items = threadItemIds(thread).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const [title, setTitle] = useState(plainTitle(thread.title));
  const [chosen, toggle, setAll] = useToggle(() => items.map((i) => i.id));
  const make = () => {
    const parts = items.filter((i) => chosen.has(i.id)).map((i) => ({ title: plainTitle(i.title), link: linkOf(i), follow: follows(i) }));
    void addTodoTree({ title: title.trim() || plainTitle(thread.title), course: outline?.id ?? null, link: { kind: 'item', ref: threadRef(thread.id), title: plainTitle(thread.title) }, next: true, parts });
    onClose();
  };
  return (
    <Shell
      title={t.todosPathTitle}
      onClose={onClose}
      footer={
        <button type="button" onClick={make} className={primary}>
          {t.todosPathMake(chosen.size)}
        </button>
      }
    >
      <div className="px-5 pt-3">
        <label className="block text-[12.5px] text-ink-3">
          {t.todosPathName}
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} className="mt-1 h-8 w-full rounded-md border border-line-strong bg-sheet px-2 text-[13.5px] text-ink" />
        </label>
        <div className="mt-3 flex items-center gap-3 text-[12.5px] text-ink-3">
          <span>{t.todosPathItems}</span>
          <button type="button" className="text-accent hover:underline" onClick={() => setAll(items.map((i) => i.id))}>{t.todosPathAll}</button>
          <button type="button" className="text-accent hover:underline" onClick={() => setAll([])}>{t.todosPathNone}</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {items.map((i) => (
          <Row key={i.id} item={i} checked={chosen.has(i.id)} onToggle={() => toggle(i.id)} />
        ))}
      </div>
    </Shell>
  );
}
