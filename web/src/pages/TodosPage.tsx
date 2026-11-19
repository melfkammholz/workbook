import clsx from 'clsx';
import { ArrowUpToLine, Calendar, Check, ChevronDown, ChevronRight, CircleDot, FolderInput, GripVertical, LayoutGrid, Maximize2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { todoProgress, type Outline, type Todo, type TodoStatus } from '@wb/shared';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import { TodoDialog, useTodoDialog } from '@/components/TodoDialog';
import { TodoSegments } from '@/components/TodoSegments';
import { TagPicker } from '@/components/TagPicker';
import { Spinner } from '@/components/ui';
import { useCourses, useOutline, useSaveSettings, useSettings } from '@/lib/api';
import { useLang, useT, type Strings } from '@/lib/i18n';
import { useTagMap } from '@/lib/tags';
import { addTodo, deleteTodo, patchTodo, reorderNext, restoreTodo, useTodos } from '@/lib/todos';

type TabId = 'open' | 'doing' | 'done';
type KindId = keyof Strings['todosKind'];
const TABS: TabId[] = ['open', 'doing', 'done'];
const KINDS: KindId[] = ['item', 'lesson', 'page', 'deck', 'link'];
const LATER_ROWS = 5;
const LINGER_MS = 1600;
const TOAST_MS = 6000;
const LANE_ROWS = 3;
const VIEW_KEY = 'wb-todos-view';
const GROUP_KEY = 'wb-todos-group';

/** What a todo's link is, for the chip and the filter. Items are told apart by the outline of the open workbook. */
function kindOf(t: Todo, outline: Outline | undefined): KindId | null {
  if (!t.link) return null;
  if (t.target) return t.target.kind === 'exercise' ? 'item' : t.target.kind === 'checklist' ? 'item' : t.target.kind === 'resource' ? 'page' : t.target.kind === 'url' ? 'link' : t.target.kind;
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

/** The title opens the todo's dialog; a double click edits it in the row. A vanished target stays visible, greyed. */
function TitleText({ todo, className, onEdit, onOpen }: { todo: Todo; className: string; onEdit: () => void; onOpen: () => void }) {
  return (
    <button type="button" className={clsx(className, 'text-left hover:underline', todo.target?.gone && 'text-ink-3')} title={todo.title} onClick={onOpen} onDoubleClick={onEdit}>
      {todo.title}
    </button>
  );
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
  /** The todo the search led to, marked for a moment. */
  marked: string | null;
  toggle: (todo: Todo) => void;
  setStatus: (todo: Todo, status: TodoStatus) => void;
  remove: (todo: Todo) => void;
  addingTo: string | null;
  setAddingTo: (id: string | null) => void;
  setNext: (id: string, next: boolean) => void;
  open: (todo: Todo) => void;
  openBoard: (todo: Todo) => void;
  /** The todo being dragged (a ref: it changes without re-rendering). */
  dragId: { current: string | null };
  /** The todo a drag is over the middle of: dropping makes the dragged one a part of it. */
  nestOver: string | null;
  setNestOver: (id: string | null) => void;
  nest: (id: string, targetId: string) => void;
  /** The part being dragged (state: it shows the "Nach oben" strip) and the part edge a drag is over. */
  partDrag: string | null;
  setPartDrag: (id: string | null) => void;
  partOver: { id: string; after: boolean } | null;
  setPartOver: (o: { id: string; after: boolean } | null) => void;
  /** Moves a todo under `parentId` (null: to the top), next to a sibling when `rel` names one. */
  movePart: (id: string, parentId: string | null, rel?: { before: string } | { after: string }) => void;
}

/** Middle band of an element: a drop there nests, the edges reorder. */
function inMiddle(e: React.DragEvent<HTMLElement>): boolean {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientY > r.top + r.height * 0.25 && e.clientY < r.bottom - r.height * 0.25;
}

/** Drag handlers that make a drop on the middle of `todo` nest the dragged todo into it. */
function nestHandlers(todo: Todo, ctx: Ctx) {
  const ok = () => ctx.dragId.current !== null && ctx.dragId.current !== todo.id;
  return {
    over: (e: React.DragEvent<HTMLElement>): boolean => {
      if (ok() && inMiddle(e)) {
        e.preventDefault();
        e.stopPropagation();
        if (ctx.nestOver !== todo.id) ctx.setNestOver(todo.id);
        return true;
      }
      if (ctx.nestOver === todo.id) ctx.setNestOver(null);
      return false;
    },
    drop: (e: React.DragEvent<HTMLElement>): boolean => {
      if (ctx.nestOver !== todo.id || !ok()) return false;
      e.preventDefault();
      e.stopPropagation();
      const id = ctx.dragId.current!;
      ctx.setNestOver(null);
      ctx.dragId.current = null;
      ctx.nest(id, todo.id);
      return true;
    },
  };
}

function Circle({ todo, ctx, size = 18 }: { todo: Todo; ctx: Ctx; size?: number }) {
  const { t } = ctx;
  const done = allDone(todo);
  const half = !done && todo.status === 'doing';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? t.todosUntick : t.todosTick}
      title={done ? t.todosUntick : t.todosTick}
      onClick={() => ctx.toggle(todo)}
      className={clsx('grid shrink-0 place-items-center rounded-full border-[1.5px] transition-colors', done ? 'border-done bg-done text-white' : half ? 'border-accent text-accent' : 'border-line-strong text-transparent hover:border-ink-3', todo.follow && !todo.manual && 'border-dashed')}
      style={{ width: size, height: size }}
    >
      {done ? <Check size={size - 6} strokeWidth={3} aria-hidden /> : half ? <span aria-hidden className="size-[40%] rounded-full bg-accent" /> : null}
    </button>
  );
}

/** Title and date while they are being changed. Enter saves, Escape leaves as it was, and leaving the fields saves. */
function EditFields({ todo, onDone, courseTitles }: { todo: Todo; onDone: () => void; courseTitles?: Map<string, string> }) {
  const t = useT();
  const [title, setTitle] = useState(todo.title);
  const [due, setDue] = useState(todo.due ?? '');
  const [course, setCourse] = useState(todo.course ?? '');
  const box = useRef<HTMLDivElement>(null);
  const finished = useRef(false);
  const save = () => {
    if (finished.current) return;
    finished.current = true;
    const next = title.trim();
    const patch: { title?: string; due?: string | null; course?: string | null } = {};
    if (next && next !== todo.title) patch.title = next;
    if ((due || null) !== todo.due) patch.due = due || null;
    if (courseTitles && (course || null) !== todo.course) patch.course = course || null;
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
      {courseTitles ? (
        <select value={course} onChange={(e) => setCourse(e.target.value)} onKeyDown={key} aria-label={t.todosWorkbook} className="h-7 rounded-md border border-line-strong bg-sheet px-1.5 text-[13px] text-ink-2">
          <option value="">{t.todosOwn}</option>
          {[...courseTitles].map(([k, title]) => (
            <option key={k} value={k}>{title}</option>
          ))}
        </select>
      ) : null}
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
            <Row key={c.id} todo={c} ctx={ctx} depth={depth + 1} sibs={todo.children} />
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
  /** The siblings of a part, for alt+arrow moves. */
  sibs?: Todo[];
  top?: { inNext: boolean; draggable: boolean; onDragStart: () => void; onDragEnd: () => void; onDragOver: (after: boolean) => void; onDrop: (after: boolean) => void; moveKey: (dir: -1 | 1) => void; showAge: boolean };
}

function Row({ todo, ctx, depth, top, sibs }: RowProps) {
  const { t, lang } = ctx;
  const [editing, setEditing] = useState(false);
  const done = allDone(todo);
  const kind = kindOf(todo, ctx.outline);
  const progress = todoProgress(todo);
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      ctx.toggle(todo);
    } else if (top && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      top.moveKey(e.key === 'ArrowUp' ? -1 : 1);
    } else if (!top && sibs && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const at = sibs.findIndex((x) => x.id === todo.id);
      const to = sibs[at + (e.key === 'ArrowUp' ? -1 : 1)];
      if (to && todo.parentId) ctx.movePart(todo.id, todo.parentId, e.key === 'ArrowUp' ? { before: to.id } : { after: to.id });
    }
  };
  const nh = nestHandlers(todo, ctx);
  return (
    <li
      data-todo={todo.id}
      onDragOver={top ? (e) => { e.preventDefault(); e.stopPropagation(); top.onDragOver(e.clientY > e.currentTarget.getBoundingClientRect().top + e.currentTarget.getBoundingClientRect().height / 2); } : undefined}
      onDrop={top ? (e) => { e.preventDefault(); e.stopPropagation(); if (ctx.partDrag) { const id = ctx.partDrag; ctx.setPartDrag(null); ctx.dragId.current = null; ctx.movePart(id, null); return; } top.onDrop(e.clientY > e.currentTarget.getBoundingClientRect().top + e.currentTarget.getBoundingClientRect().height / 2); } : undefined}
    >
      <div
        tabIndex={editing ? -1 : 0}
        onKeyDown={key}
        draggable={(top ? !!top.draggable : !!sibs) && !editing}
        onDragStart={top ? (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', todo.id); ctx.dragId.current = todo.id; top.onDragStart(); } : sibs ? (e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', todo.id); ctx.dragId.current = todo.id; ctx.setPartDrag(todo.id); } : undefined}
        onDragEnd={top ? () => { ctx.dragId.current = null; ctx.setNestOver(null); top.onDragEnd(); } : sibs ? () => { ctx.dragId.current = null; ctx.setNestOver(null); ctx.setPartDrag(null); ctx.setPartOver(null); } : undefined}
        onDragOver={(e) => {
          if (nh.over(e)) return;
          if (!top && ctx.partDrag && ctx.partDrag !== todo.id) {
            e.preventDefault();
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            const after = e.clientY > r.top + r.height / 2;
            if (ctx.partOver?.id !== todo.id || ctx.partOver.after !== after) ctx.setPartOver({ id: todo.id, after });
          }
        }}
        onDrop={(e) => {
          if (nh.drop(e)) return;
          if (!top && ctx.partDrag && ctx.partOver?.id === todo.id && todo.parentId) {
            e.preventDefault();
            e.stopPropagation();
            const id = ctx.partDrag;
            const after = ctx.partOver.after;
            ctx.setPartDrag(null);
            ctx.setPartOver(null);
            ctx.dragId.current = null;
            ctx.movePart(id, todo.parentId, after ? { after: todo.id } : { before: todo.id });
          }
        }}
        className={clsx('group relative flex items-center gap-2.5 rounded-md py-1.5 pr-1 outline-none transition-colors focus-visible:bg-sunk focus-visible:ring-2 focus-visible:ring-accent/50', (ctx.marked === todo.id || ctx.nestOver === todo.id) && 'bg-accent-soft', ctx.nestOver === todo.id && 'ring-2 ring-accent', depth === 0 ? 'pl-0' : 'pl-0.5')}
      >
        {top || sibs ? (
          <span title={t.todosDrag} className={clsx('w-3.5 shrink-0 cursor-grab text-ink-3 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100', top && !top.draggable && 'invisible')}>
            <GripVertical size={14} aria-hidden />
          </span>
        ) : null}
        {ctx.partOver?.id === todo.id ? <span aria-hidden className={clsx('pointer-events-none absolute inset-x-0 h-0.5 bg-accent', ctx.partOver.after ? 'bottom-0' : 'top-0')} /> : null}
        <Circle todo={todo} ctx={ctx} size={depth === 0 ? 18 : 15} />
        {editing ? (
          <EditFields todo={todo} onDone={() => setEditing(false)} courseTitles={depth === 0 ? ctx.courseTitles : undefined} />
        ) : (
          <>
            <TitleText todo={todo} className={clsx('min-w-0 truncate', depth === 0 ? 'text-[14.5px]' : 'text-[13.5px]', done ? 'text-ink-3 line-through' : top?.inNext ? 'font-medium' : depth === 0 ? 'text-ink' : 'text-ink-2')} onEdit={() => setEditing(true)} onOpen={() => ctx.open(todo)} />
            {kind ? <span className={clsx('shrink-0 rounded px-1.5 text-[11.5px]', todo.target?.gone ? 'bg-sunk text-ink-3' : 'bg-accent-soft text-accent')} title={todo.target?.gone ? t.todosGone : undefined}>{t.todosKind[kind]}</span> : null}
            {ctx.showCourse && depth === 0 && todo.course && ctx.courseTitles.get(todo.course) ? <span className="shrink-0 rounded bg-sunk px-1.5 text-[11.5px] text-ink-2">{ctx.courseTitles.get(todo.course)}</span> : null}
            <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
              <span className="absolute right-1 top-1/2 z-10 hidden -translate-y-1/2 items-center gap-0.5 rounded-md bg-sunk px-1 shadow-sm group-hover:flex group-focus-within:flex">
                <ActionButton label={t.todosOpen} onClick={() => ctx.open(todo)}>
                  <Maximize2 size={13} />
                </ActionButton>
                {todo.children.length ? (
                  <ActionButton label={t.todosOpenBoard} onClick={() => ctx.openBoard(todo)}>
                    <LayoutGrid size={13} />
                  </ActionButton>
                ) : null}
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
                {sibs && todo.parentId ? (
                  <>
                    <ActionButton label={t.todosToTop} onClick={() => ctx.movePart(todo.id, null)}>
                      <ArrowUpToLine size={13} />
                    </ActionButton>
                    <ActionButton label={t.todosMoveTo} onClick={() => ctx.open(todo)}>
                      <FolderInput size={13} />
                    </ActionButton>
                  </>
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
              {progress.total ? (
                <span className="flex items-center gap-1.5">
                  <TodoSegments todo={todo} />
                  <span className="text-[12px] text-ink-3">{t.todosParts(progress.done, progress.total)}</span>
                </span>
              ) : null}
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

interface Lane {
  /** Stable id for the collapse state: `wb:<course>`, `wb:own`, `tag:<id>` or `other`. */
  id: string;
  title: string;
  todos: Todo[];
  /** What a todo added in this lane gets. */
  course: string | null;
  tag: string | null;
  /** A board of one todo's parts: what is added here becomes a part of it. */
  parent?: string;
  /** Dragging between lanes only changes anything in workbook mode (a todo is in one lane there). */
  reorder: boolean;
}

type CardKind = 'next' | 'card' | 'slim';

const COLLAPSED_KEY = 'wb-todos-collapsed';

function readCollapsed(): ReadonlySet<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** A part under a card: tick and title, and its own parts. */
function PartLine({ todo, ctx }: { todo: Todo; ctx: Ctx }) {
  const done = allDone(todo);
  return (
    <li>
      <div className="flex items-center gap-2 py-0.5">
        <Circle todo={todo} ctx={ctx} size={13} />
        <TitleText todo={todo} className={clsx('min-w-0 flex-1 truncate text-[12.5px]', done ? 'text-ink-3 line-through' : 'text-ink-2')} onEdit={() => undefined} onOpen={() => ctx.open(todo)} />
      </div>
      {todo.children.length ? (
        <ul className="ml-3 border-l border-line pl-2">
          {todo.children.map((c) => (
            <PartLine key={c.id} todo={c} ctx={ctx} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

interface CardProps {
  todo: Todo;
  ctx: Ctx;
  kind: CardKind;
  cardId: string;
  expanded: boolean;
  /** A board of one todo: cards show no parts, a button opens the part's own board. */
  bare?: boolean;
  onToggleParts: () => void;
  /** Line above or below this card while a drag is over it. */
  line: 'before' | 'after' | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  /** Only cards in the next block take a drop. */
  onDragOver?: (after: boolean) => void;
  onDrop?: (after: boolean) => void;
  moveKey: (e: KeyboardEvent<HTMLLIElement>) => void;
}

/** One card in a lane: grip, tick, title; drag it to another column to change the status. */
function LaneCard({ todo, ctx, kind, cardId, expanded, bare, onToggleParts, line, onDragStart, onDragEnd, onDragOver, onDrop, moveKey }: CardProps) {
  const { t } = ctx;
  const done = allDone(todo);
  const nh = nestHandlers(todo, ctx);
  const half = (e: React.DragEvent<HTMLLIElement>) => e.clientY > e.currentTarget.getBoundingClientRect().top + e.currentTarget.getBoundingClientRect().height / 2;
  return (
    <li
      data-card={cardId}
      tabIndex={0}
      draggable
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          ctx.toggle(todo);
        } else moveKey(e);
      }}
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', todo.id);
        ctx.dragId.current = todo.id;
        if (todo.parentId) ctx.setPartDrag(todo.id);
        onDragStart();
      }}
      onDragEnd={() => { ctx.dragId.current = null; ctx.setNestOver(null); ctx.setPartDrag(null); onDragEnd(); }}
      onDragOver={(e) => { if (nh.over(e)) return; if (onDragOver) { e.preventDefault(); e.stopPropagation(); onDragOver(half(e)); } }}
      onDrop={(e) => { if (nh.drop(e)) return; if (onDrop) { e.preventDefault(); e.stopPropagation(); onDrop(half(e)); } }}
      className={clsx(
        'group rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        ctx.nestOver === todo.id && 'ring-2 ring-accent bg-accent-soft',
        kind === 'next' && 'bg-sheet px-2 py-2 shadow-sm',
        kind === 'card' && (done ? 'border border-dashed border-line-strong px-2 py-2' : 'border border-line-strong bg-sheet px-2 py-2'),
        kind === 'slim' && 'px-1 py-1',
        line === 'before' && 'border-t-2 !border-t-accent',
        line === 'after' && 'border-b-2 !border-b-accent',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span title={t.todosDrag} className="w-3 shrink-0 cursor-grab text-ink-3 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          <GripVertical size={13} aria-hidden />
        </span>
        <Circle todo={todo} ctx={ctx} size={kind === 'slim' ? 15 : 17} />
        <TitleText
          todo={todo}
          className={clsx('min-w-0 flex-1 truncate', kind === 'slim' ? 'text-[13px]' : 'text-[14px] font-medium', done ? 'text-ink-3 line-through' : kind === 'slim' ? 'text-ink-2' : 'text-ink')}
          onEdit={() => undefined}
          onOpen={() => ctx.open(todo)}
        />
        {todo.children.length ? <TodoSegments todo={todo} /> : null}
        {!done && todo.due ? <span className="shrink-0 text-[11.5px] text-ink-3">{t.todosDue(dueText(todo.due, ctx.lang))}</span> : null}
        {bare && todo.children.length ? (
          <button type="button" aria-label={t.todosOpenBoard} title={t.todosOpenBoard} onClick={() => ctx.openBoard(todo)} className="grid size-5 shrink-0 place-items-center rounded text-ink-3 hover:bg-sunk hover:text-ink">
            <LayoutGrid size={13} />
          </button>
        ) : null}
        {!bare && todo.children.length ? (
          <button type="button" aria-expanded={expanded} aria-label={expanded ? t.todosPartsHide : t.todosPartsShow} title={expanded ? t.todosPartsHide : t.todosPartsShow} onClick={onToggleParts} className="grid size-5 shrink-0 place-items-center rounded text-ink-3 hover:bg-sunk hover:text-ink">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : null}
      </div>
      {!bare && expanded && todo.children.length ? (
        <ul className="ml-7 mt-1">
          {todo.children.map((c) => (
            <PartLine key={c.id} todo={c} ctx={ctx} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** "Todo hinzufügen" at the foot of a cell; it opens a one-line field. */
function CellAdd({ ctx, onAdd, label }: { ctx: Ctx; onAdd: (title: string) => void; label: string }) {
  const [on, setOn] = useState(false);
  if (on) {
    return (
      <div className="mt-1.5">
        <AddLine compact autoFocus placeholder={label} onAdd={onAdd} onCancel={() => setOn(false)} />
      </div>
    );
  }
  return (
    <button type="button" onClick={() => setOn(true)} className="mt-1 flex items-center gap-1 px-1 text-[12.5px] text-ink-3 hover:text-ink">
      <Plus size={13} aria-hidden />
      {label}
    </button>
  );
}

const rankSort = (a: Todo, b: Todo) => a.nextRank! - b.nextRank!;

/** What to carry on with in a lane: the next block first, then what is in progress, then the newest open one. */
function continueWith(todos: Todo[]): Todo | undefined {
  return (
    todos.filter((x) => x.status === 'open' && x.nextRank !== null).sort(rankSort)[0] ??
    todos.find((x) => x.status === 'doing') ??
    todos.filter((x) => x.status === 'open').sort((a, b) => b.createdAt - a.createdAt)[0]
  );
}

/** A lane per workbook or tag, a column per status. */
function Board({ todos, ctx, lanes, bare }: { todos: Todo[]; ctx: Ctx; lanes: Lane[]; bare?: boolean }) {
  const { t } = ctx;
  const [drag, setDrag] = useState<{ id: string; lane: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [line, setLine] = useState<{ cardId: string; after: boolean } | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [partsOpen, setPartsOpen] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(readCollapsed);
  const focusCard = useRef<string | null>(null);
  const nextIds = useMemo(() => todos.filter((x) => x.nextRank !== null && x.status !== 'done').sort(rankSort).map((x) => x.id), [todos]);

  useEffect(() => {
    if (!focusCard.current) return;
    document.querySelector<HTMLElement>(`[data-card="${CSS.escape(focusCard.current)}"]`)?.focus();
    focusCard.current = null;
  });

  const toggleCollapsed = (id: string) => {
    setCollapsed((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...n]));
      } catch {
        /* remembering is a convenience */
      }
      return n;
    });
  };
  const flip = (set: ReadonlySet<string>, id: string) => {
    const n = new Set(set);
    if (!n.delete(id)) n.add(id);
    return n;
  };

  /** Puts `id` into the next block next to `target` (or at the end), or out of it. */
  const placeNext = (id: string, target: string | null, after: boolean) => {
    const rest = nextIds.filter((x) => x !== id);
    const at = target ? rest.indexOf(target) : -1;
    rest.splice(at === -1 ? rest.length : at + (after ? 1 : 0), 0, id);
    void reorderNext(rest);
  };
  const leaveNext = (id: string) => void reorderNext(nextIds.filter((x) => x !== id));

  const end = () => {
    setDrag(null);
    setOver(null);
    setLine(null);
  };
  const dragged = drag ? todos.find((x) => x.id === drag.id) : undefined;
  const dropColumn = (status: TodoStatus, lane: Lane) => {
    const todo = dragged;
    const from = drag?.lane;
    end();
    if (!todo || from !== lane.id || !lane.reorder) return;
    if (todo.status === status) {
      if (status === 'open' && todo.nextRank !== null) leaveNext(todo.id);
    } else ctx.setStatus(todo, status);
  };
  const dropOnNext = (target: Todo, lane: Lane, after: boolean) => {
    const todo = dragged;
    const from = drag?.lane;
    end();
    if (!todo || from !== lane.id || !lane.reorder || todo.id === target.id) return;
    if (todo.status !== 'open') ctx.setStatus(todo, 'open');
    placeNext(todo.id, target.id, after);
  };

  if (lanes.length === 0) return <p className="py-6 text-[13px] text-ink-3">{t.todosEmpty}</p>;
  return (
    <div className={clsx('mt-5 grid border-t border-line', bare ? 'grid-cols-[1.25fr_1fr_0.8fr]' : 'grid-cols-[170px_1.25fr_1fr_0.8fr]')}>
      {bare ? null : <div />}
      {TABS.map((status, i) => (
        <h3 key={status} className={clsx('px-2.5 pb-2 pt-2.5 text-[12.5px] font-semibold text-ink-2', i > 0 && 'border-l border-dashed border-line')}>
          {t.todosStatus[status]}
        </h3>
      ))}
      {lanes.map((lane) => {
        const isCollapsed = collapsed.has(lane.id);
        const head = bare ? null : (
          <h2 className="flex items-start gap-1 border-t border-line py-3 pr-2.5 text-[14px] font-semibold">
            <button type="button" aria-expanded={!isCollapsed} aria-label={isCollapsed ? t.todosLaneExpand(lane.title) : t.todosLaneCollapse(lane.title)} onClick={() => toggleCollapsed(lane.id)} className="mt-0.5 grid size-5 shrink-0 place-items-center rounded text-ink-3 hover:bg-sunk hover:text-ink">
              {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
            </button>
            <span className="min-w-0 break-words">{lane.title}</span>
          </h2>
        );
        if (isCollapsed) {
          const next = continueWith(lane.todos);
          return (
            <Fragment key={lane.id}>
              {head}
              <div className="col-span-3 flex min-w-0 items-center gap-1.5 border-t border-line px-2.5 py-3 text-[13px]">
                {next ? (
                  <>
                    <span className="shrink-0 text-ink-3">{t.todosContinue}</span>
                    <TitleText todo={next} className="min-w-0 truncate text-ink" onEdit={() => undefined} onOpen={() => ctx.open(next)} />
                  </>
                ) : null}
              </div>
            </Fragment>
          );
        }
        return (
          <Fragment key={lane.id}>
            {head}
            {TABS.map((status, i) => {
              const col = lane.todos.filter((x) => x.status === status);
              const cid = `${lane.id}:${status}`;
              const isNext = (x: Todo) => status === 'open' && x.nextRank !== null;
              const nexts = col.filter(isNext).sort(rankSort);
              const rest = col.filter((x) => !isNext(x)).sort((a, b) => (status === 'done' ? (b.doneAt ?? 0) - (a.doneAt ?? 0) : b.createdAt - a.createdAt));
              const open = expanded.has(cid);
              const shownRest = open ? rest : rest.slice(0, LANE_ROWS);
              const kind: CardKind = status === 'open' ? 'slim' : 'card';
              const droppable = !!drag && drag.lane === lane.id && lane.reorder && (dragged?.status !== status || (status === 'open' && dragged?.nextRank !== null));
              const card = (x: Todo, k: CardKind) => {
                const cardId = `${lane.id}:${x.id}`;
                const idx = nexts.indexOf(x);
                const keyMove = (e: KeyboardEvent<HTMLLIElement>) => {
                  if (!e.altKey || !lane.reorder) return;
                  const k2 = e.key;
                  if (k2 === 'ArrowUp' || k2 === 'ArrowDown') {
                    const dir = k2 === 'ArrowUp' ? -1 : 1;
                    if (status !== 'open') return;
                    e.preventDefault();
                    focusCard.current = cardId;
                    if (idx !== -1) {
                      const to = idx + dir;
                      if (to >= nexts.length) leaveNext(x.id);
                      else if (to >= 0) placeNext(x.id, nexts[to]!.id, dir === 1);
                    } else if (dir === -1 && rest[0]?.id === x.id) {
                      placeNext(x.id, nexts.length ? nexts[nexts.length - 1]!.id : null, true);
                    }
                  } else if (k2 === 'ArrowLeft' || k2 === 'ArrowRight') {
                    const to = TABS[TABS.indexOf(status) + (k2 === 'ArrowLeft' ? -1 : 1)];
                    if (!to) return;
                    e.preventDefault();
                    focusCard.current = cardId;
                    ctx.setStatus(x, to);
                  }
                };
                return (
                  <LaneCard
                    key={x.id}
                    todo={x}
                    ctx={ctx}
                    kind={k}
                    cardId={cardId}
                    expanded={partsOpen.has(x.id)}
                    bare={bare}
                    onToggleParts={() => setPartsOpen((s) => flip(s, x.id))}
                    line={line?.cardId === cardId ? (line.after ? 'after' : 'before') : null}
                    onDragStart={() => setDrag({ id: x.id, lane: lane.id })}
                    onDragEnd={end}
                    onDragOver={k === 'next' ? (after) => { if (drag?.lane === lane.id && lane.reorder) { setOver(cid); setLine({ cardId, after }); } } : undefined}
                    onDrop={k === 'next' ? (after) => dropOnNext(x, lane, after) : undefined}
                    moveKey={keyMove}
                  />
                );
              };
              return (
                <div
                  key={status}
                  onDragOver={(e) => {
                    if (!drag) return;
                    e.preventDefault();
                    setOver(cid);
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                    setOver((o) => (o === cid ? null : o));
                    setLine(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropColumn(status, lane);
                  }}
                  className={clsx('min-h-16 min-w-0 border-t border-line p-2.5', i > 0 && 'border-l border-dashed', droppable && over === cid && 'outline-dashed outline-1 -outline-offset-4 outline-accent bg-accent-soft/40')}
                >
                  {nexts.length ? (
                    <div className="rounded-lg bg-accent-soft p-1.5">
                      <p className="px-1 pb-1.5 text-[12px] font-semibold text-accent">{t.todosNext}</p>
                      <ul className="space-y-1.5">{nexts.map((x) => card(x, 'next'))}</ul>
                    </div>
                  ) : null}
                  {rest.length && nexts.length && status === 'open' ? (
                    <p className="my-1.5 flex items-center gap-2 text-[12px] text-ink-3 before:flex-1 before:border-t before:border-dashed before:border-line-strong after:flex-1 after:border-t after:border-dashed after:border-line-strong">{t.todosMore}</p>
                  ) : null}
                  <ul className={clsx(kind === 'card' && 'space-y-1.5')}>{shownRest.map((x) => card(x, kind))}</ul>
                  {rest.length > LANE_ROWS && !open ? (
                    <button type="button" onClick={() => setExpanded((s) => new Set(s).add(cid))} className="mt-0.5 px-1 text-[12.5px] text-accent hover:underline">
                      {t.todosShowMore}
                    </button>
                  ) : null}
                  <CellAdd ctx={ctx} label={bare ? t.todosAddPart : t.todosAddInLane} onAdd={(title) => void addTodo(lane.parent ? { title, parentId: lane.parent, status } : { title, course: lane.course, status, ...(lane.tag ? { tags: [lane.tag] } : {}) })} />
                </div>
              );
            })}
          </Fragment>
        );
      })}
    </div>
  );
}

const chip = (on: boolean) => clsx('h-[28px] rounded-full border px-3 text-[13px]', on ? 'border-transparent bg-accent-soft font-medium text-accent' : 'border-line-strong bg-sheet text-ink-2 hover:text-ink');
const select = 'h-[28px] rounded-full border border-line-strong bg-sheet px-2.5 text-[13px] text-ink-2';

/** The student's own list: what to do next in an order they set, the rest by age. */
/** `/todos/:id`: one todo's parts as a small board. */
export function TodoBoardPage() {
  return <TodosPage rootId={useParams<{ id: string }>().id} />;
}

/** The student's own list: what to do next in an order they set, the rest by age. With `rootId`, one todo's parts as a board. */
export function TodosPage({ rootId }: { rootId?: string } = {}) {
  const t = useT();
  const [, navigate] = useLocation();
  
  const lang = useLang();
  const todos = useTodos().data;
  const outline = useOutline().data;
  const courses = useCourses().data?.courses;
  const [tab, setTab] = useState<TabId>('open');
  const [view, setViewState] = useState<'list' | 'board'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'board' ? 'board' : 'list';
    } catch {
      return 'list';
    }
  });
  const setView = (v: 'list' | 'board') => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* remembering is a convenience */
    }
  };
  const [group, setGroupState] = useState<'workbook' | 'tag'>(() => {
    try {
      return localStorage.getItem(GROUP_KEY) === 'tag' ? 'tag' : 'workbook';
    } catch {
      return 'workbook';
    }
  });
  const setGroup = (g: 'workbook' | 'tag') => {
    setGroupState(g);
    try {
      localStorage.setItem(GROUP_KEY, g);
    } catch {
      /* remembering is a convenience */
    }
  };
  const settings = useSettings().data;
  const saveSettings = useSaveSettings();
  const tagMap = useTagMap();
  const laneTags = (settings?.todoLaneTags ?? []).filter((id) => tagMap.has(id));
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

  // `?focus=<id>` (from the search): show the list with everything open to that todo, scroll to it and mark it.
  const focusParam = new URLSearchParams(useSearch()).get('focus');
  const [marked, setMarked] = useState<string | null>(null);
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!focusParam || !todos || focused.current === focusParam) return;
    const byId = new Map<string, Todo>();
    const walk = (x: Todo) => {
      byId.set(x.id, x);
      x.children.forEach(walk);
    };
    todos.forEach(walk);
    const target = byId.get(focusParam);
    if (!target) return;
    focused.current = focusParam;
    let top = target;
    while (top.parentId && byId.get(top.parentId)) top = byId.get(top.parentId)!;
    setViewState('list');
    setCourse('all');
    setKind('all');
    setShowAll(true);
    setTab(top.status === 'done' ? 'done' : 'open');
    setMarked(target.id);
    window.setTimeout(() => document.querySelector(`[data-todo="${CSS.escape(target.id)}"]`)?.scrollIntoView({ block: 'center' }), 50);
    window.setTimeout(() => setMarked(null), 2500);
  }, [focusParam, todos]);
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

  const dragId = useRef<string | null>(null);
  const [nestOver, setNestOver] = useState<string | null>(null);
  const nest = useCallback(
    (id: string, targetId: string) => {
      const all = new Map<string, Todo>();
      const walk = (x: Todo) => {
        all.set(x.id, x);
        x.children.forEach(walk);
      };
      (todos ?? []).forEach(walk);
      const mine = all.get(id);
      const target = all.get(targetId);
      if (!mine || !target) return;
      const rank = mine.nextRank;
      const from = mine.parentId;
      void patchTodo(id, { parentId: targetId });
      showToast(t.todosNestedToast(target.title), () => {
        void patchTodo(id, { parentId: from }).then(() => (rank !== null && from === null ? patchTodo(id, { nextRank: rank }) : undefined));
      });
    },
    [todos, showToast, t],
  );
  const [partDrag, setPartDrag] = useState<string | null>(null);
  const [partOver, setPartOver] = useState<{ id: string; after: boolean } | null>(null);
  const movePart = useCallback(
    (id: string, parentId: string | null, rel?: { before: string } | { after: string }) => {
      const all = new Map<string, Todo>();
      const walk = (x: Todo) => {
        all.set(x.id, x);
        x.children.forEach(walk);
      };
      (todos ?? []).forEach(walk);
      const mine = all.get(id);
      if (!mine) return;
      const from = mine.parentId;
      const sibs = from ? (all.get(from)?.children ?? []) : [];
      const prev = sibs[sibs.findIndex((x) => x.id === id) - 1];
      const next = sibs[sibs.findIndex((x) => x.id === id) + 1];
      const rank = mine.nextRank;
      focusId.current = id;
      void patchTodo(id, { parentId, ...(rel ?? {}) });
      showToast(parentId === null ? t.todosPromotedToast : t.todosMovedToast, () => {
        void patchTodo(id, { parentId: from, ...(prev ? { after: prev.id } : next ? { before: next.id } : {}) }).then(() => (rank !== null && from === null ? patchTodo(id, { nextRank: rank }) : undefined));
      });
    },
    [todos, showToast, t],
  );
  const dialog = useTodoDialog();
  const ctx: Ctx = { partDrag, setPartDrag, partOver, setPartOver, movePart, dragId, nestOver, setNestOver, nest, t, lang, outline, courseTitles, showCourse: course === 'all', marked, toggle, setStatus, remove, addingTo, setAddingTo, setNext, open: (x) => dialog.open(x.id), openBoard: (x) => navigate(`/todos/${encodeURIComponent(x.id)}`) };

  const shown = useMemo(() => {
    const keep = (x: Todo) => {
      if (course === 'own' ? x.course !== null : course !== 'all' && x.course !== course) return false;
      if (kind !== 'all' && kindOf(x, outline) !== kind) return false;
      if (lingering.has(x.id)) return true;
      return tab === 'open' ? x.status !== 'done' : x.status === tab;
    };
    return (todos ?? []).filter(keep);
  }, [todos, course, kind, tab, lingering, outline]);

  const lanes = useMemo<Lane[]>(() => {
    const pool = (todos ?? []).filter((x) => (kind === 'all' || kindOf(x, outline) === kind) && (course === 'all' || (course === 'own' ? x.course === null : x.course === course)));
    if (group === 'tag') {
      const addCourse = course !== 'all' && course !== 'own' ? course : null;
      const chosen: Lane[] = laneTags.map((id) => ({ id: `tag:${id}`, title: tagMap.get(id)!.name, todos: pool.filter((x) => x.tags.includes(id)), course: addCourse, tag: id, reorder: false }));
      const other = pool.filter((x) => !laneTags.some((id) => x.tags.includes(id)));
      return other.length ? [...chosen, { id: 'other', title: t.todosOther, todos: other, course: addCourse, tag: null, reorder: false }] : chosen;
    }
    const keys = [...(courses ?? []).map((c) => c.key), null].filter((k) => course === 'all' || (course === 'own' ? k === null : k === course));
    return keys.map((k) => ({ id: `wb:${k ?? 'own'}`, title: k === null ? t.todosOwn : (courseTitles.get(k) ?? k), todos: pool.filter((x) => x.course === k), course: k, tag: null, reorder: true })).filter((l) => l.todos.length > 0);
  }, [todos, kind, course, courses, courseTitles, outline, t, group, laneTags, tagMap]);

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

  const byId = new Map<string, Todo>();
  const walkAll = (x: Todo) => {
    byId.set(x.id, x);
    x.children.forEach(walkAll);
  };
  (todos ?? []).forEach(walkAll);
  const root = rootId ? byId.get(rootId) : undefined;

  if (!todos) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }

  const withNext = tab !== 'done';
  const visibleLater = showAll || tab === 'done' ? laterRows : laterRows.slice(0, LATER_ROWS);
  /** A part dropped on the strip or the list background becomes a top-level todo. */
  const promoteDrop = (e: React.DragEvent) => {
    if (!partDrag) return false;
    e.preventDefault();
    if (e.type === 'drop') {
      e.stopPropagation();
      const id = partDrag;
      setPartDrag(null);
      setPartOver(null);
      dragId.current = null;
      movePart(id, null);
    }
    return true;
  };
  const strip = partDrag ? (
    <div onDragOver={promoteDrop} onDrop={promoteDrop} className="mt-4 grid h-10 place-items-center rounded-lg border border-dashed border-accent bg-accent-soft/40 text-[13px] text-accent">
      {t.todosToTop}
    </div>
  ) : null;
  const dropHere = (e: React.DragEvent, index: number | null) => {
    if (promoteDrop(e)) return;
    if (!drag) return;
    e.preventDefault();
    if (e.type === 'drop') {
      place(drag.id, index);
      setDrag(null);
    }
  };

  if (root) {
    const trail: Todo[] = [];
    for (let p = root.parentId ? byId.get(root.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) trail.unshift(p);
    const courseTitle = root.course ? courseTitles.get(root.course) : undefined;
    const lane: Lane = { id: `todo:${root.id}`, title: root.title, todos: root.children, course: root.course, tag: null, parent: root.id, reorder: true };
    return (
      <div className="h-full overflow-y-auto">
        <div className="settle wb-page mx-auto max-w-6xl px-6 pb-16 pt-8 sm:px-8">
          <nav aria-label={t.todosTitle} className="flex flex-wrap items-center gap-1 text-[13px] text-ink-3">
            <Link href="/todos" className="hover:text-ink hover:underline">{t.todosTitle}</Link>
            {[...(courseTitle ? [{ id: '', title: courseTitle }] : []), ...trail].map((x) => (
              <Fragment key={x.id || 'course'}>
                <ChevronRight size={12} aria-hidden />
                {x.id ? <Link href={`/todos/${encodeURIComponent(x.id)}`} className="hover:text-ink hover:underline">{x.title}</Link> : <span>{x.title}</span>}
              </Fragment>
            ))}
          </nav>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Circle todo={root} ctx={ctx} size={22} />
            <h1 className="min-w-0 text-[1.75rem] font-semibold tracking-[-0.02em]">
              <button type="button" onClick={() => dialog.open(root.id)} className="text-left hover:underline">{root.title}</button>
            </h1>
            {root.children.length ? <TodoSegments todo={root} /> : null}
          </div>
          {strip}
          <Board todos={root.children} ctx={ctx} lanes={[lane]} bare />
        </div>
        <TodoDialog todos={todos} id={dialog.id} courseTitles={courseTitles} onOpen={dialog.switchTo} onClose={dialog.close} onDelete={remove} />
        {toast ? (
          <div role="status" className="settle fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line-strong bg-sheet px-3.5 py-2 text-sm shadow-[var(--shadow)]">
            <span>{toast.msg}</span>
            <button type="button" onClick={() => { toast.undo(); setToast(null); }} className="font-medium text-accent hover:underline">{t.todosUndo}</button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className={clsx('settle wb-page mx-auto px-6 pb-16 pt-8 sm:px-8', view === 'board' ? 'max-w-6xl' : 'max-w-3xl')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{t.todosTitle}</h1>
          <div className="flex items-center gap-2">
            <div role="group" className="flex gap-1.5">
              {(['list', 'board'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={chip(view === v)}>
                  {v === 'list' ? t.todosViewList : t.todosViewBoard}
                </button>
              ))}
            </div>
            {view === 'board' ? (
              <div role="group" className="flex gap-1.5">
                {(['workbook', 'tag'] as const).map((g) => (
                  <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)} className={chip(group === g)}>
                    {g === 'workbook' ? t.todosGroupWorkbook : t.todosGroupTag}
                  </button>
                ))}
              </div>
            ) : null}
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
        </div>

        {rootId ? <p role="status" className="mt-3 text-[13px] text-ink-3">{t.todosBoardGone}</p> : null}

        <div className="mt-4">
          <AddLine placeholder={t.todosAddPlaceholder} onAdd={(title) => void addTodo({ title, course: course !== 'all' && course !== 'own' ? course : null })} />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div role="tablist" className={clsx('flex gap-1.5', view === 'board' && 'invisible')}>
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

        {view === 'board' && group === 'tag' ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-ink-2">{t.todosLaneTags}</span>
            <div className="min-w-[14rem] flex-1">
              <TagPicker size="sm" value={laneTags} onChange={(v) => saveSettings.mutate({ todoLaneTags: v })} placeholder={t.todosLaneTagsPlaceholder} />
            </div>
          </div>
        ) : null}

        {view === 'board' ? <Board todos={todos} ctx={ctx} lanes={lanes} /> : null}

        {strip}

        {view === 'list' && withNext ? (
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

        {view === 'list' ? (
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
        ) : null}
      </div>

      {todos ? <TodoDialog todos={todos} id={dialog.id} courseTitles={courseTitles} onOpen={dialog.switchTo} onClose={dialog.close} onDelete={remove} /> : null}

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
