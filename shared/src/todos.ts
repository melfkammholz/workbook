// Todos: the student's own list of things to do, a tree, global like tickets and decks.

/** What a todo can point at. */
export const TODO_LINK_KINDS = ['item', 'page', 'deck', 'resource', 'url'] as const;
export type TodoLinkKind = (typeof TODO_LINK_KINDS)[number];

export type TodoStatus = 'open' | 'doing' | 'done';
export const TODO_STATUSES: readonly TodoStatus[] = ['open', 'doing', 'done'];
export type TodoOrigin = 'manual' | 'item' | 'ticket-line';

export interface TodoLink {
  kind: TodoLinkKind;
  ref: string;
  /** The target's title when the todo was made, shown if the target has vanished. */
  title: string | null;
}

export interface Todo {
  id: string;
  parentId: string | null;
  /** Order among siblings. */
  sort: number;
  title: string;
  /** Plain free text, shown on expand. */
  body: string | null;
  status: TodoStatus;
  /** The workbook it belongs to; null is global. Children always have their parent's. */
  course: string | null;
  link: TodoLink | null;
  /** A date, `YYYY-MM-DD`, no time. */
  due: string | null;
  /** A rough size in minutes. */
  minutes: number | null;
  /** Only top-level todos: a number puts it in "Als Nächstes", in that order; null means "Danach". */
  nextRank: number | null;
  origin: TodoOrigin;
  createdAt: number;
  updatedAt: number;
  doneAt: number | null;
  /** Parts, in order. */
  children: Todo[];
}

export const MAX_TODO_TITLE = 300;
export const MAX_TODO_BODY = 10_000;
