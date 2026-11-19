import { ListTodo } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import type { ThreadInfo, TodoLink } from '@wb/shared';
import { useOutline } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { addTodo, useTodoFor } from '@/lib/todos';
import { PathPicker, threadRef } from './TodoPicker';
import { clsx } from './ui';

/** "Add to todos" for a lesson, exercise, text or deck; once added it says "In todos" and leads to the list. The todo copies only the link. */
export function AddToTodos({ link, course = null, minutes, compact = false, className }: {
  link: TodoLink;
  course?: string | null;
  /** A rough size, e.g. the review time of a deck's due cards. */
  minutes?: number | undefined;
  /** Icon only, for rows. */
  compact?: boolean;
  className?: string;
}) {
  const t = useT();
  const outline = useOutline().data;
  const existing = useTodoFor(link.kind, link.ref);
  const box = clsx('inline-flex h-7 items-center gap-1.5 rounded-md text-[13px] text-ink-3 hover:bg-sunk hover:text-ink', compact ? 'size-7 justify-center' : 'px-2', className);
  if (existing) {
    return (
      <Link href="/todos" title={t.todosIn} aria-label={t.todosIn} onClick={(e) => e.stopPropagation()} className={clsx(box, 'text-accent')}>
        <ListTodo size={14} /> {compact ? null : <span className="hidden sm:inline">{t.todosIn}</span>}
      </Link>
    );
  }
  return (
    <button
      type="button"
      title={t.todosAddTo}
      aria-label={t.todosAddTo}
      className={box}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void addTodo({ title: link.title ?? link.ref, course: link.kind === 'item' ? (outline?.id ?? course) : course, link, origin: 'item', ...(minutes ? { minutes } : {}) });
      }}
    >
      <ListTodo size={14} /> {compact ? null : <span className="hidden sm:inline">{t.todosAddTo}</span>}
    </button>
  );
}

/** "Pfad als Todo" for a path: opens the picker that makes a todo with the path's items as parts. */
export function PathAsTodo({ thread, className }: { thread: ThreadInfo; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const existing = useTodoFor('item', threadRef(thread.id));
  if (existing) return <Link href="/todos" className={clsx('inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-accent hover:bg-sunk', className)}><ListTodo size={14} /> {t.todosIn}</Link>;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={clsx('inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-3 hover:bg-sunk hover:text-ink', className)}>
        <ListTodo size={14} /> {t.todosPathAs}
      </button>
      {open ? <PathPicker thread={thread} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
