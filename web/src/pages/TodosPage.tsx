import clsx from 'clsx';
import { Calendar, Check, CircleDot, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Outline, Todo, TodoStatus } from '@wb/shared';
import { Spinner } from '@/components/ui';
import { useCourses, useOutline } from '@/lib/api';
import { useLang, useT, type Strings } from '@/lib/i18n';
import { addTodo, deleteTodo, patchTodo, reorderNext, restoreTodo, useTodos } from '@/lib/todos';

type TabId = 'open' | 'doing' | 'done';
type KindId = keyof Strings['todosKind'];
const TABS: TabId[] = ['open', 'doing', 'done'];
const KINDS: KindId[] = ['item', 'lesson', 'page', 'deck', 'link'];
const LATER_ROWS = 5;
const LINGER_MS = 1600;
const TOAST_MS = 6000;

/** What a todo's link is, for the chip and the filter. Items are told apart by the outline of the open workbook. */
function kindOf(t: Todo, outline: Outline | undefined): KindId | null {
  if (!t.link) return null;
  switch (t.link.kind) {
    case 'item': {
      const hit = outline?.chapters.flatMap((c) => c.items).find((i) => i.id === t.link!.ref);
      return hit?.type === 'lesson' ? 'lesson' : hit?.type === 'page' ? 'page' : 'item';
    }
    case 'page':
    case 'resource':
      return 'page';
    case 'deck':
      return 'deck';
    default:
      return 'link';
  }
}

const dayOf = (iso: string) => new Date(`${iso}T12:00:00`);

function dueText(iso: string, lang: string): string {
  const d = dayOf(iso);
  const days = (d.getTime() - Date.now()) / 864e5;
  return new Intl.DateTimeFormat(lang, days > -1 && days < 6 ? { weekday: 'short' } : { day: 'numeric', month: 'short' }).format(d);
}

const ageDays = (t: Todo) => Math.floor((Date.now() - t.createdAt) / 864e5);

function allDone(t: Todo): boolean {
  return t.status === 'done';
}

interface Toast {
  msg: string;
  undo: () => void;
}

interface Ctx {
  t: Strings;
  lang: string;
  outline: Outline | undefined;
  courseTitles: Map<string, string>;
  showCourse: boolean;
  toggle: (todo: Todo) => void;
  setStatus: (todo: Todo, status: TodoStatus) => void;
  remove: (todo: Todo) => void;
  addingTo: string | null;
  setAddingTo: (id: string | null) => void;
  setNext: (id: string, next: boolean) => void;
}

function Circle({ todo, ctx, size = 18 }: { todo: Todo; ctx: Ctx; size?: number }) {
  const { t } = ctx;
  const done = allDone(todo);
  const half = !done && (todo.status === 'doing' || todo.children.some(allDone));
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? t.todosUntick : t.todosTick}
      title={done ? t.todosUntick : t.todosTick}
      onClick={() => ctx.toggle(todo)}
      className={clsx('grid shrink-0 place-items-center rounded-full border-[1.5px] transition-colors', done ? 'border-done bg-done text-white' : half ? 'border-accent text-accent' : 'border-line-strong text-transparent hover:border-ink-3')}
      style={{ width: size, height: size }}
    >
      {done ? <Check size={size - 6} strokeWidth={3} aria-hidden /> : half ? <span aria-hidden className="size-[40%] rounded-full bg-accent" /> : null}
    </button>
  );
}

/** Title and date while they are being changed. Enter saves, Escape leaves as it was, and leaving the fields saves. */
function EditFields({ todo, onDone }: { todo: Todo; onDone: () => void }) {
  const t = useT();
  const [title, setTitle] = useState(todo.title);
  const [due, setDue] = useState(todo.due ?? '');
  const box = useRef<HTMLDivElement>(null);
  const finished = useRef(false);
  const save = () => {
    if (finished.current) return;
    finished.current = true;
    const next = title.trim();
    const patch: { title?: string; due?: string | null } = {};
    if (next && next !== todo.title) patch.title = next;
    if ((due || null) !== todo.due) patch.due = due || null;
    if (Object.keys(patch).length) void patchTodo(todo.id, patch);
    onDone();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      finished.current = true;
      onDone();
    }
  };
  return (
    <div
      ref={box}
      className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node | null)) save();
      }}
    >
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={key} maxLength={300} aria-label={t.todosEdit} className="h-7 min-w-[12rem] flex-1 rounded-md border border-line-strong bg-sheet px-2 text-[14px]" />
      <input type="date" value={due} onChange={(e) => setDue(e.target.value)} onKeyDown={key} aria-label={t.todosDueLabel} className="h-7 rounded-md border border-line-strong bg-sheet px-1.5 text-[13px] text-ink-2" />
      {due ? (
        <button type="button" onClick={() => setDue('')} title={t.todosDueClear} aria-label={t.todosDueClear} className="rounded p-1 text-ink-3 hover:text-ink">
          <X size={13} />
        </button>
      ) : null}
    </div>
  );
}

function AddLine({ placeholder, onAdd, onCancel, autoFocus, compact }: { placeholder: string; onAdd: (title: string) => void; onCancel?: () => void; autoFocus?: boolean; compact?: boolean }) {
  const t = useT();
  const [text, setText] = useState('');
  return (
    <div className={clsx('flex items-center gap-2 border border-line-strong bg-sheet', compact ? 'h-7 rounded-md px-2' : 'h-10 rounded-lg px-3')}>
      <Plus size={compact ? 13 : 16} className="shrink-0 text-ink-3" aria-hidden />
      <input
        autoFocus={autoFocus}
        value={text}
        maxLength={300}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && text.trim()) {
            onAdd(text.trim());
            setText('');
          } else if (e.key === 'Escape') onCancel?.();
        }}
        onBlur={() => !text.trim() && onCancel?.()}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-3"
      />
      {compact ? null : <kbd className="rounded border border-line px-1.5 text-[11px] text-ink-3">{t.todosAddHint}</kbd>}
    </div>
  );
}

function Parts({ todo, ctx, depth }: { todo: Todo; ctx: Ctx; depth: number }) {
  const { t } = ctx;
  return (
    <>
      {todo.children.length ? (
        <ul className="ml-[2.6rem] border-l border-line pl-3">
          {todo.children.map((c) => (
            <Row key={c.id} todo={c} ctx={ctx} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
      {ctx.addingTo === todo.id ? (
        <div className="ml-[2.6rem] mt-1 max-w-md pl-3">
          <AddLine compact autoFocus placeholder={t.todosPartPlaceholder} onAdd={(title) => void addTodo({ title, parentId: todo.id })} onCancel={() => ctx.setAddingTo(null)} />
        </div>
      ) : null}
    </>
  );
}

interface RowProps {
  todo: Todo;
  ctx: Ctx;
  depth: number;
  top?: { inNext: boolean; draggable: boolean; onDragStart: () => void; onDragEnd: () => void; onDragOver: (after: boolean) => void; onDrop: (after: boolean) => void; moveKey: (dir: -1 | 1) => void; showAge: boolean };
}

function Row({ todo, ctx, depth, top }: RowProps) {
  const { t, lang } = ctx;
  const [editing, setEditing] = useState(false);
  const done = allDone(todo);
  const kind = kindOf(todo, ctx.outline);
  const doneParts = todo.children.filter(allDone).length;
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      ctx.toggle(todo);
    } else if (top && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      top.moveKey(e.key === 'ArrowUp' ? -1 : 1);
    }
  };
  return (
    <li
      data-todo={todo.id}
      onDragOver={top ? (e) => { e.preventDefault(); e.stopPropagation(); top.onDragOver(e.clientY > e.currentTarget.getBoundingClientRect().top + e.currentTarget.getBoundingClientRect().height / 2); } : undefined}
      onDrop={top ? (e) => { e.preventDefault(); e.stopPropagation(); top.onDrop(e.clientY > e.currentTarget.getBoundingClientRect().top + e.currentTarget.getBoundingClientRect().height / 2); } : undefined}
    >
      <div
        tabIndex={editing ? -1 : 0}
        onKeyDown={key}
        draggable={!!top?.draggable && !editing}
        onDragStart={top ? (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', todo.id); top.onDragStart(); } : undefined}
        onDragEnd={top?.onDragEnd}
        className={clsx('group flex items-center gap-2.5 rounded-md py-1.5 pr-1 outline-none focus-visible:bg-sunk focus-visible:ring-2 focus-visible:ring-accent/50', depth === 0 ? 'pl-0' : 'pl-0.5')}
      >
        {top ? (
          <span title={t.todosDrag} className={clsx('w-3.5 shrink-0 cursor-grab text-ink-3 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100', !top.draggable && 'invisible')}>
            <GripVertical size={14} aria-hidden />
          </span>
        ) : null}
        <Circle todo={todo} ctx={ctx} size={depth === 0 ? 18 : 15} />
        {editing ? (
          <EditFields todo={todo} onDone={() => setEditing(false)} />
        ) : (
          <>
            <span className={clsx('min-w-0 truncate', depth === 0 ? 'text-[14.5px]' : 'text-[13.5px]', done ? 'text-ink-3 line-through' : top?.inNext ? 'font-medium' : depth === 0 ? 'text-ink' : 'text-ink-2')} title={todo.title} onDoubleClick={() => setEditing(true)}>
              {todo.title}
            </span>
            {kind ? <span className={clsx('shrink-0 rounded px-1.5 text-[11.5px]', todo.link?.title === null && 'opacity-80', 'bg-accent-soft text-accent')}>{t.todosKind[kind]}</span> : null}
            {ctx.showCourse && depth === 0 && todo.course && ctx.courseTitles.get(todo.course) ? <span className="shrink-0 rounded bg-sunk px-1.5 text-[11.5px] text-ink-2">{ctx.courseTitles.get(todo.course)}</span> : null}
            <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
              <span className="hidden items-center gap-0.5 group-hover:flex group-focus-within:flex">
                <ActionButton label={t.todosEdit} onClick={() => setEditing(true)}>
                  <Pencil size={13} />
                </ActionButton>
                <ActionButton label={t.todosDueLabel} onClick={() => setEditing(true)}>
                  <Calendar size={13} />
                </ActionButton>
                <ActionButton label={t.todosAddPart} onClick={() => ctx.setAddingTo(todo.id)}>
                  <Plus size={14} />
                </ActionButton>
                {!done ? (
                  <ActionButton label={todo.status === 'doing' ? t.todosMakeOpen : t.todosMakeDoing} onClick={() => ctx.setStatus(todo, todo.status === 'doing' ? 'open' : 'doing')}>
                    <CircleDot size={13} />
                  </ActionButton>
                ) : null}
                {top && !done ? (
                  <ActionButton label={top.inNext ? t.todosMoveLater : t.todosMoveNext} onClick={() => ctx.setNext(todo.id, !top.inNext)}>
                    <span aria-hidden className="text-[12px] font-semibold leading-none">{top.inNext ? '↓' : '↑'}</span>
                  </ActionButton>
                ) : null}
                <ActionButton label={t.todosDelete} onClick={() => ctx.remove(todo)}>
                  <Trash2 size={13} />
                </ActionButton>
              </span>
              {todo.children.length ? <span className="text-[12px] text-ink-3">{t.todosParts(doneParts, todo.children.length)}</span> : null}
              {!done && todo.minutes ? <span className="text-[12px] text-ink-3">{todo.minutes} min</span> : null}
              {!done && todo.due ? <span className="text-[12px] text-ink-3">{t.todosDue(dueText(todo.due, lang))}</span> : null}
              {top?.showAge ? <span className="w-24 text-right text-[12px] text-ink-3">{t.todosAge(ageDays(todo))}</span> : null}
            </span>
          </>
        )}
      </div>
      <Parts todo={todo} ctx={ctx} depth={depth} />
    </li>
  );
}

function ActionButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="grid size-6 place-items-center rounded text-ink-3 hover:bg-sunk hover:text-ink">
      {children}
    </button>
  );
}

const chip = (on: boolean) => clsx('h-[28px] rounded-full border px-3 text-[13px]', on ? 'border-transparent bg-accent-soft font-medium text-accent' : 'border-line-strong bg-sheet text-ink-2 hover:text-ink');
const select = 'h-[28px] rounded-full border border-line-strong bg-sheet px-2.5 text-[13px] text-ink-2';

/** The student's own list: what to do next in an order they set, the rest by age. */
export function TodosPage() {
  const t = useT();
  const lang = useLang();
  const todos = useTodos().data;
  const outline = useOutline().data;
  const courses = useCourses().data?.courses;
  const [tab, setTab] = useState<TabId>('open');
  const [course, setCourse] = useState<string>('all');
  const [kind, setKind] = useState<string>('all');
  const [showAll, setShowAll] = useState(false);
  const [lingering, setLingering] = useState<ReadonlySet<string>>(new Set());
  const [toast, setToast] = useState<Toast | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: number | null } | null>(null);
  const focusId = useRef<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    document.title = `${t.todosTitle} · ${outline?.title ?? ''}`;
  }, [t, outline?.title]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    if (!focusId.current) return;
    document.querySelector<HTMLElement>(`[data-todo="${focusId.current}"] > div`)?.focus();
    focusId.current = null;
  });

  const showToast = useCallback((msg: string, undo: () => void) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const linger = useCallback((id: string) => {
    setLingering((s) => new Set(s).add(id));
    window.setTimeout(() => setLingering((s) => { const n = new Set(s); n.delete(id); return n; }), LINGER_MS);
  }, []);

  const courseTitles = useMemo(() => new Map((courses ?? []).map((c) => [c.key, c.title])), [courses]);
  const nextIds = useMemo(() => (todos ?? []).filter((x) => x.nextRank !== null && x.status !== 'done').sort((a, b) => a.nextRank! - b.nextRank!).map((x) => x.id), [todos]);

  const setStatus = useCallback(
    (todo: Todo, status: TodoStatus) => {
      const top = todo.parentId === null;
      void patchTodo(todo.id, top && status === 'done' ? { status, nextRank: null } : { status });
      if (status === 'done' || todo.status === 'done') linger(todo.id);
    },
    [linger],
  );

  const toggle = useCallback(
    (todo: Todo) => {
      const was = todo.status;
      const rank = todo.nextRank;
      const next: TodoStatus = was === 'done' ? 'open' : 'done';
      setStatus(todo, next);
      showToast(next === 'done' ? t.todosDoneToast : t.todosReopenedToast, () => {
        void patchTodo(todo.id, todo.parentId === null && rank !== null ? { status: was, nextRank: rank } : { status: was });
        linger(todo.id);
      });
    },
    [setStatus, showToast, linger, t],
  );

  const remove = useCallback(
    (todo: Todo) => {
      void deleteTodo(todo.id);
      showToast(t.todosDeleted, () => void restoreTodo(todo.id));
    },
    [showToast, t],
  );

  const setNext = useCallback(
    (id: string, on: boolean) => {
      focusId.current = id;
      void reorderNext(on ? [...nextIds.filter((x) => x !== id), id] : nextIds.filter((x) => x !== id));
    },
    [nextIds],
  );

  const ctx: Ctx = { t, lang, outline, courseTitles, showCourse: course === 'all', toggle, setStatus, remove, addingTo, setAddingTo, setNext };

  const shown = useMemo(() => {
    const keep = (x: Todo) => {
      if (course === 'own' ? x.course !== null : course !== 'all' && x.course !== course) return false;
      if (kind !== 'all' && kindOf(x, outline) !== kind) return false;
      if (lingering.has(x.id)) return true;
      return tab === 'open' ? x.status !== 'done' : x.status === tab;
    };
    return (todos ?? []).filter(keep);
  }, [todos, course, kind, tab, lingering, outline]);

  const nextRows = shown.filter((x) => x.nextRank !== null && x.status !== 'done').sort((a, b) => a.nextRank! - b.nextRank!);
  const laterRows = shown.filter((x) => !(x.nextRank !== null && x.status !== 'done')).sort((a, b) => (tab === 'done' ? (b.doneAt ?? 0) - (a.doneAt ?? 0) : b.createdAt - a.createdAt));

  /** Puts `id` into the next block at `index` (clamped), or out of it with `null`. */
  const place = (id: string, index: number | null) => {
    const rest = nextIds.filter((x) => x !== id);
    if (index !== null) rest.splice(Math.min(index, rest.length), 0, id);
    focusId.current = id;
    void reorderNext(rest);
  };

  const rowProps = (x: Todo, inNext: boolean, index: number): RowProps['top'] => ({
    inNext,
    draggable: tab !== 'done',
    showAge: !inNext && tab !== 'done',
    onDragStart: () => setDrag({ id: x.id, over: null }),
    onDragEnd: () => setDrag(null),
    onDragOver: (after) => inNext && setDrag((d) => (d ? { ...d, over: index + (after ? 1 : 0) } : d)),
    onDrop: (after) => {
      if (drag) place(drag.id, inNext ? index + (after ? 1 : 0) - (nextIds.indexOf(drag.id) !== -1 && nextIds.indexOf(drag.id) < index ? 1 : 0) : null);
      setDrag(null);
    },
    moveKey: (dir) => {
      if (tab === 'done') return;
      if (inNext) {
        const at = nextIds.indexOf(x.id);
        if (dir === 1 && at === nextIds.length - 1) place(x.id, null);
        else if (at + dir >= 0) place(x.id, at + dir);
      } else if (dir === -1 && index === 0) place(x.id, nextIds.length);
    },
  });

  if (!todos) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }

  const withNext = tab !== 'done';
  const visibleLater = showAll || tab === 'done' ? laterRows : laterRows.slice(0, LATER_ROWS);
  const dropHere = (e: React.DragEvent, index: number | null) => {
    if (!drag) return;
    e.preventDefault();
    if (e.type === 'drop') {
      place(drag.id, index);
      setDrag(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="settle wb-page mx-auto max-w-3xl px-6 pb-16 pt-8 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{t.todosTitle}</h1>
          <select value={course} onChange={(e) => setCourse(e.target.value)} aria-label={t.todosAllWorkbooks} className={select}>
            <option value="all">{t.todosAllWorkbooks}</option>
            <option value="own">{t.todosOwn}</option>
            {(courses ?? []).map((c) => (
              <option key={c.key} value={c.key}>
                {c.title}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4">
          <AddLine placeholder={t.todosAddPlaceholder} onAdd={(title) => void addTodo({ title, course: course !== 'all' && course !== 'own' ? course : null })} />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div role="tablist" className="flex gap-1.5">
            {TABS.map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={chip(tab === id)}>
                {t.todosStatus[id]}
              </button>
            ))}
          </div>
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t.todosAllKinds} className={select}>
            <option value="all">{t.todosAllKinds}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t.todosKind[k]}
              </option>
            ))}
          </select>
        </div>

        {withNext ? (
          <section className="mt-6 border-l-2 border-accent pl-4" onDragOver={(e) => dropHere(e, null)} onDrop={(e) => dropHere(e, nextIds.length)}>
            <h2 className="flex items-baseline gap-2 text-[15px] font-semibold">
              {t.todosNext} <span className="text-[12.5px] font-normal text-ink-3">{t.todosNextHint}</span>
            </h2>
            {nextRows.length === 0 ? <p className="py-3 text-[13px] text-ink-3">{t.todosNextEmpty}</p> : null}
            <ul className="mt-1">
              {nextRows.map((x, i) => (
                <div key={x.id} className={clsx(drag?.over === i && 'border-t-2 border-accent', drag?.over === nextRows.length && i === nextRows.length - 1 && 'border-b-2 border-accent')}>
                  <Row todo={x} ctx={ctx} depth={0} top={rowProps(x, true, i)} />
                </div>
              ))}
            </ul>
          </section>
        ) : null}

        <section className={clsx(withNext && 'mt-6 border-t border-line pt-5')} onDragOver={(e) => dropHere(e, null)} onDrop={(e) => dropHere(e, null)}>
          {withNext ? (
            <h2 className="flex items-baseline gap-2 text-[15px] font-semibold">
              {t.todosLater} <span className="text-[12.5px] font-normal text-ink-3">{t.todosLaterHint}</span>
            </h2>
          ) : null}
          {laterRows.length === 0 && (!withNext || nextRows.length === 0) ? <p className="py-3 text-[13px] text-ink-3">{t.todosEmpty}</p> : null}
          <ul className="mt-1">
            {visibleLater.map((x, i) => (
              <Row key={x.id} todo={x} ctx={ctx} depth={0} top={rowProps(x, false, i)} />
            ))}
          </ul>
          {!showAll && tab !== 'done' && laterRows.length > LATER_ROWS ? (
            <button type="button" onClick={() => setShowAll(true)} className="mt-1 text-[13.5px] text-accent hover:underline">
              {t.todosShowMore}
            </button>
          ) : null}
        </section>
      </div>

      {toast ? (
        <div role="status" className="settle fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line-strong bg-sheet px-3.5 py-2 text-sm shadow-[var(--shadow)]">
          <span>{toast.msg}</span>
          <button
            type="button"
            onClick={() => {
              toast.undo();
              setToast(null);
            }}
            className="font-medium text-accent hover:underline"
          >
            {t.todosUndo}
          </button>
        </div>
      ) : null}
    </div>
  );
}
