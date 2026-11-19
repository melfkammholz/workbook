import * as DialogPrimitive from '@radix-ui/react-dialog';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Check, ChevronRight, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Todo, TodoStatus } from '@wb/shared';
import { TODO_STATUSES } from '@wb/shared';
import { Link, useLocation, useSearch } from 'wouter';
import { useT } from '@/lib/i18n';
import { plainTitle } from './Title';
import { addTodo, patchTodo, setTodoTags } from '@/lib/todos';
import { useOutline } from '@/lib/api';
import { TagPicker } from './TagPicker';
import { LinkPicker, threadItemIds, threadRef } from './TodoPicker';
import { TodoSegments } from './TodoSegments';

/** Todos nest at most this deep in the interface (top level is 1). */
const MAX_DEPTH = 3;
const SAVE_MS = 600;
const field = 'h-8 w-full rounded-md border border-line-strong bg-sheet px-2 text-[13.5px] text-ink';

/** The open todo lives in the address (`?todo=<id>`), so Back closes the dialog and a reload keeps it. */
export function useTodoDialog() {
  const [path, navigate] = useLocation();
  const search = useSearch();
  const id = new URLSearchParams(search).get('todo');
  const to = useCallback(
    (next: string | null, replace: boolean) => {
      const q = new URLSearchParams(window.location.search);
      if (next) q.set('todo', next);
      else q.delete('todo');
      const s = q.toString();
      navigate(s ? `${path}?${s}` : path, { replace, state: next ? { todoDialog: true } : null });
    },
    [navigate, path],
  );
  return {
    id,
    open: (x: string) => to(x, false),
    switchTo: (x: string) => to(x, true),
    close: () => {
      if ((window.history.state as { todoDialog?: boolean } | null)?.todoDialog) window.history.back();
      else to(null, true);
    },
  };
}

/** A text field that saves a moment after typing stops, and at once when it goes away. */
function useAutosave(initial: string, save: (v: string) => void): [string, (v: string) => void] {
  const [value, setValue] = useState(initial);
  const latest = useRef(initial);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (dirty.current) {
      dirty.current = false;
      saveRef.current(latest.current);
    }
  }, []);
  useEffect(() => flush, [flush]);
  const change = (v: string) => {
    setValue(v);
    latest.current = v;
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_MS);
  };
  return [value, change];
}

function index(todos: Todo[]): Map<string, Todo> {
  const m = new Map<string, Todo>();
  const walk = (x: Todo) => {
    m.set(x.id, x);
    x.children.forEach(walk);
  };
  todos.forEach(walk);
  return m;
}

const height = (x: Todo): number => 1 + Math.max(0, ...x.children.map(height));

function descendants(x: Todo): Todo[] {
  return x.children.flatMap((c) => [c, ...descendants(c)]);
}

function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] text-ink-3">{text}</span>
      {children}
    </label>
  );
}

function Tick({ todo, label }: { todo: Todo; label: string }) {
  const done = todo.status === 'done';
  const half = !done && todo.status === 'doing';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      onClick={() => void patchTodo(todo.id, { status: done ? 'open' : 'done', ...(done || todo.parentId ? {} : { nextRank: null }) })}
      className={clsx('grid size-[15px] shrink-0 place-items-center rounded-full border-[1.5px]', done ? 'border-done bg-done text-white' : half ? 'border-accent text-accent' : 'border-line-strong text-transparent hover:border-ink-3', todo.follow && !todo.manual && 'border-dashed')}
    >
      {done ? <Check size={9} strokeWidth={3} aria-hidden /> : half ? <span aria-hidden className="size-[40%] rounded-full bg-accent" /> : null}
    </button>
  );
}

export function TodoDialog({
  todos,
  id,
  courseTitles,
  onOpen,
  onClose,
  onDelete,
}: {
  todos: Todo[];
  id: string | null;
  courseTitles: Map<string, string>;
  onOpen: (id: string) => void;
  onClose: () => void;
  onDelete: (todo: Todo) => void;
}) {
  const byId = useMemo(() => index(todos), [todos]);
  const todo = id ? byId.get(id) : undefined;
  // The todo can vanish (deleted elsewhere, a stale address): the dialog just closes.
  useEffect(() => {
    if (id && !todo) onClose();
  }, [id, todo, onClose]);
  return (
    <DialogPrimitive.Root open={!!todo} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="wb-overlay fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            const row = id ? document.querySelector<HTMLElement>(`[data-todo="${CSS.escape(id)}"] > div`) : null;
            if (row) {
              e.preventDefault();
              row.focus();
            }
          }}
          className="wb-dialog fixed left-1/2 top-[8vh] z-50 flex max-h-[84vh] w-[calc(100vw-2rem)] max-w-3xl -translate-x-1/2 flex-col rounded-xl border border-line-strong bg-sheet shadow-[var(--shadow)]"
        >
          {todo ? <Body key={todo.id} todo={todo} byId={byId} todos={todos} courseTitles={courseTitles} onOpen={onOpen} onClose={onClose} onDelete={onDelete} /> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Body({ todo, byId, todos, courseTitles, onOpen, onClose, onDelete }: { todo: Todo; byId: Map<string, Todo>; todos: Todo[]; courseTitles: Map<string, string>; onOpen: (id: string) => void; onClose: () => void; onDelete: (todo: Todo) => void }) {
  const t = useT();
  const [title, setTitle] = useAutosave(todo.title, (v) => v.trim() && v.trim() !== todo.title && void patchTodo(todo.id, { title: v.trim() }));
  const [body, setBody] = useAutosave(todo.body ?? '', (v) => void patchTodo(todo.id, { body: v.trim() ? v : null }));
  const [minutes, setMinutes] = useAutosave(todo.minutes ? String(todo.minutes) : '', (v) => {
    const n = Math.round(Number(v));
    void patchTodo(todo.id, { minutes: v.trim() && n >= 1 ? n : null });
  });
  const [asking, setAsking] = useState(false);
  const [newPart, setNewPart] = useState('');
  const [linking, setLinking] = useState(false);
  const outline = useOutline().data;
  const thread = todo.link?.kind === 'item' && todo.link.ref.startsWith(threadRef('')) ? outline?.threads.find((x) => threadRef(x.id) === todo.link!.ref) : undefined;
  const missing = useMemo(() => {
    if (!thread || !outline) return [];
    const have = new Set(todo.children.map((c) => c.link?.ref));
    const byId = new Map(outline.chapters.flatMap((c) => c.items).map((i) => [i.id, i]));
    return threadItemIds(thread).flatMap((id) => (!have.has(id) && byId.has(id) ? [byId.get(id)!] : []));
  }, [thread, outline, todo.children]);

  const ancestors: Todo[] = [];
  for (let p = todo.parentId ? byId.get(todo.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) ancestors.unshift(p);
  const depth = ancestors.length + 1;
  const parts = todo.children;
  const derived = parts.length > 0 && !todo.manual;
  const below = descendants(todo);

  // Where it may move to: not itself or its parts, and not so deep that the interface cannot show it.
  const parents = useMemo(() => {
    const out: { todo: Todo; depth: number }[] = [];
    const inside = new Set([todo.id, ...below.map((x) => x.id)]);
    const walk = (x: Todo, d: number) => {
      if (inside.has(x.id)) return;
      if (d + height(todo) <= MAX_DEPTH) out.push({ todo: x, depth: d });
      x.children.forEach((c) => walk(c, d + 1));
    };
    todos.forEach((x) => walk(x, 1));
    return out;
  }, [todos, todo, below]);

  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.target instanceof HTMLInputElement) e.preventDefault();
  };

  const move = (from: number, dir: -1 | 1) => {
    const order = parts.map((p) => p.id);
    const to = from + dir;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to]!, order[from]!];
    order.forEach((cid, i) => {
      if (parts[i]!.id !== cid) void patchTodo(cid, { sort: i });
    });
  };

  const addPart = () => {
    const v = newPart.trim();
    if (!v) return;
    setNewPart('');
    void addTodo({ title: v, parentId: todo.id });
  };

  const target = todo.target;

  return (
    <>
      <div className="flex items-start justify-between gap-3 px-6 pt-5">
        <nav aria-label={t.tdBreadcrumb} className="flex min-w-0 flex-wrap items-center gap-1 text-[12.5px] text-ink-3">
          {todo.course && courseTitles.get(todo.course) ? <span className="rounded bg-sunk px-1.5 text-ink-2">{courseTitles.get(todo.course)}</span> : null}
          {ancestors.map((a) => (
            <span key={a.id} className="flex min-w-0 items-center gap-1">
              <button type="button" onClick={() => onOpen(a.id)} className="max-w-[16rem] truncate hover:text-ink hover:underline">
                {a.title}
              </button>
              <ChevronRight size={12} aria-hidden />
            </span>
          ))}
        </nav>
        <DialogPrimitive.Close className="-mr-2 -mt-1 rounded-md p-1.5 text-ink-3 hover:bg-sunk hover:text-ink" aria-label={t.close}>
          <X size={18} />
        </DialogPrimitive.Close>
      </div>

      <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-6 pb-4 pt-2 sm:grid-cols-[1fr_15rem]">
        <div className="min-w-0 space-y-5">
          <div>
            <DialogPrimitive.Title asChild>
              <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={key} maxLength={300} aria-label={t.todosEdit} className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[19px] font-semibold tracking-tight hover:border-line focus:border-line-strong focus:outline-none" />
            </DialogPrimitive.Title>
            {parts.length ? (
              <div className="mt-1.5 flex items-center gap-2 px-1">
                <TodoSegments todo={todo} />
                <span className="text-[12px] text-ink-3">{t.todosParts(parts.filter((p) => p.status === 'done').length, parts.length)}</span>
              </div>
            ) : null}
          </div>

          <Label text={t.tdNotes}>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={10_000} rows={4} placeholder={t.tdNotesPlaceholder} className="w-full resize-y rounded-md border border-line-strong bg-sheet px-2 py-1.5 text-[13.5px] text-ink placeholder:text-ink-3" />
          </Label>

          <section aria-labelledby="td-parts">
            <h3 id="td-parts" className="mb-1 text-[12.5px] text-ink-3">
              {t.tdParts}
            </h3>
            {parts.length === 0 ? <p className="py-1 text-[13px] text-ink-3">{t.tdNoParts}</p> : null}
            <ul>
              {parts.map((p, i) => (
                <li key={p.id} className="group flex items-center gap-2 rounded-md py-1 pr-1 hover:bg-sunk/60 focus-within:bg-sunk/60">
                  <Tick todo={p} label={p.status === 'done' ? t.todosUntick : t.todosTick} />
                  <button type="button" onClick={() => onOpen(p.id)} className={clsx('min-w-0 flex-1 truncate text-left text-[13.5px] hover:underline', p.status === 'done' ? 'text-ink-3 line-through' : 'text-ink')}>
                    {p.title}
                  </button>
                  {p.follow ? (
                    <button type="button" title={t.tdRuleTitle} onClick={() => void patchTodo(p.id, { manual: !p.manual })} className="rounded px-1.5 text-[12px] text-ink-3 hover:bg-sunk hover:text-ink">
                      {p.manual ? t.tdRuleHand : t.tdRuleAuto}
                    </button>
                  ) : null}
                  <span className="flex items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t.tdMoveUp} title={t.tdMoveUp} className="grid size-6 place-items-center rounded text-ink-3 hover:bg-sunk hover:text-ink disabled:invisible">
                      <ArrowUp size={13} />
                    </button>
                    <button type="button" disabled={i === parts.length - 1} onClick={() => move(i, 1)} aria-label={t.tdMoveDown} title={t.tdMoveDown} className="grid size-6 place-items-center rounded text-ink-3 hover:bg-sunk hover:text-ink disabled:invisible">
                      <ArrowDown size={13} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            {missing.length ? (
              <p className="mt-1 flex items-center gap-2 text-[13px] text-ink-2">
                {t.tdNewItems(missing.length)}
                <button
                  type="button"
                  onClick={() => missing.forEach((i) => void addTodo({ title: plainTitle(i.title), parentId: todo.id, link: { kind: i.type === 'page' ? 'page' : 'item', ref: i.id, title: plainTitle(i.title) }, follow: i.type !== 'page', origin: 'item' }))}
                  className="text-accent hover:underline"
                >
                  {t.tdNewItemsAdd}
                </button>
              </p>
            ) : null}
            {depth < MAX_DEPTH && outline ? (
              <button type="button" onClick={() => setLinking(true)} className="mt-1 text-[13px] text-accent hover:underline">
                {t.tdLinkFrom}
              </button>
            ) : null}
            {depth < MAX_DEPTH ? (
              <div className="mt-1 flex items-center gap-2">
                <Plus size={14} className="text-ink-3" aria-hidden />
                <input
                  value={newPart}
                  onChange={(e) => setNewPart(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      addPart();
                    }
                  }}
                  maxLength={300}
                  placeholder={t.tdAddPart}
                  aria-label={t.tdAddPart}
                  className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-[13.5px] placeholder:text-ink-3 hover:border-line focus:border-line-strong focus:outline-none"
                />
              </div>
            ) : null}
          </section>
        </div>

        <div className="space-y-4">
          <div>
            <span className="mb-1 block text-[12.5px] text-ink-3">{t.tdStatus}</span>
            <div role="radiogroup" aria-label={t.tdStatus} className="flex overflow-hidden rounded-md border border-line-strong">
              {TODO_STATUSES.map((s: TodoStatus) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={todo.status === s}
                  onClick={() => todo.status !== s || derived ? void patchTodo(todo.id, s === 'done' && !todo.parentId ? { status: s, nextRank: null } : { status: s }) : undefined}
                  className={clsx('h-8 flex-1 px-1 text-[12.5px]', todo.status === s ? 'bg-accent-soft font-medium text-accent' : 'bg-sheet text-ink-2 hover:text-ink')}
                >
                  {t.todosStatus[s]}
                </button>
              ))}
            </div>
            {derived ? (
              <p className="mt-1 text-[12px] text-ink-3">
                {t.tdFollowsParts} <span className="text-ink-3">{t.tdSetOwn}</span>
              </p>
            ) : parts.length ? (
              <button type="button" onClick={() => void patchTodo(todo.id, { manual: false })} className="mt-1 text-[12px] text-accent hover:underline">
                {t.tdFollowParts}
              </button>
            ) : todo.follow && todo.manual ? (
              <button type="button" onClick={() => void patchTodo(todo.id, { manual: false })} className="mt-1 text-[12px] text-accent hover:underline">
                {t.tdFollowItem}
              </button>
            ) : todo.follow ? (
              <p className="mt-1 text-[12px] text-ink-3">{t.tdFollowsItem}</p>
            ) : null}
          </div>

          <Label text={t.tdWorkbook}>
            {todo.parentId ? (
              <span className="block px-0.5 text-[13.5px] text-ink-2">{(todo.course && courseTitles.get(todo.course)) || t.todosOwn}</span>
            ) : (
              <select value={todo.course ?? ''} onChange={(e) => void patchTodo(todo.id, { course: e.target.value || null })} className={field}>
                <option value="">{t.todosOwn}</option>
                {[...courseTitles].map(([k, name]) => (
                  <option key={k} value={k}>
                    {name}
                  </option>
                ))}
              </select>
            )}
          </Label>

          <Label text={t.tdParent}>
            <select value={todo.parentId ?? ''} onChange={(e) => void patchTodo(todo.id, { parentId: e.target.value || null })} className={field}>
              <option value="">{t.tdTopLevel}</option>
              {parents.map(({ todo: p, depth: d }) => (
                <option key={p.id} value={p.id}>
                  {`${'– '.repeat(d - 1)}${p.title}`}
                </option>
              ))}
            </select>
          </Label>

          <Label text={t.tdDue}>
            <input type="date" value={todo.due ?? ''} onChange={(e) => void patchTodo(todo.id, { due: e.target.value || null })} className={clsx(field, 'text-ink-2')} />
          </Label>

          <Label text={t.tdMinutes}>
            <input type="number" min={1} max={100000} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} onKeyDown={key} className={field} />
          </Label>

          <div>
            <span className="mb-1 block text-[12.5px] text-ink-3">{t.tdTags}</span>
            <TagPicker size="sm" value={todo.tags} onChange={(v) => void setTodoTags(todo.id, v)} />
          </div>

          {target ? (
            <div>
              <span className="mb-1 block text-[12.5px] text-ink-3">{t.tdLinked}</span>
              {target.href && !target.gone ? (
                /^https?:/.test(target.href) ? (
                  <a href={target.href} target="_blank" rel="noreferrer" className="text-[13.5px] text-accent hover:underline">
                    {target.title}
                  </a>
                ) : (
                  <Link href={target.href} onClick={() => onClose()} className="text-[13.5px] text-accent hover:underline">
                    {target.title}
                  </Link>
                )
              ) : (
                <span className="text-[13.5px] text-ink-3">{target.title}</span>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {linking ? <LinkPicker parent={todo} onClose={() => setLinking(false)} /> : null}
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-3">
        {asking ? (
          <div className="min-w-0 flex-1 text-[13px]">
            <p className="text-ink-2">{t.tdDeleteAsk(below.length)}</p>
            {below.length ? (
              <ul className="mt-1 list-disc pl-5 text-ink-3">
                {below.slice(0, 8).map((x) => (
                  <li key={x.id} className="truncate">
                    {x.title}
                  </li>
                ))}
                {below.length > 8 ? <li className="list-none">{t.tdMore(below.length - 8)}</li> : null}
              </ul>
            ) : null}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => {
                  onClose();
                  onDelete(todo);
                }}
                className="h-8 rounded-md bg-danger px-3 text-[13px] font-medium text-white hover:opacity-90"
              >
                {t.tdDeleteConfirm}
              </button>
              <button type="button" onClick={() => setAsking(false)} className="h-8 rounded-md border border-line-strong px-3 text-[13px] text-ink-2 hover:text-ink">
                {t.tdCancel}
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                if (below.length) setAsking(true);
                else {
                  onClose();
                  onDelete(todo);
                }
              }}
              className="text-[13px] text-ink-3 hover:text-danger"
            >
              {t.tdDelete}
            </button>
            <span className="ml-auto text-[12px] text-ink-3">{t.tdSaved}</span>
            <button type="button" onClick={onClose} className="h-8 rounded-md bg-accent px-4 text-[13px] font-medium text-white hover:opacity-90">
              {t.tdDone}
            </button>
          </>
        )}
      </div>
    </>
  );
}
