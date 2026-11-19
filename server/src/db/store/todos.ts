import { randomUUID } from 'node:crypto';
import {
  type Todo,
  type TodoStatus,
  type TodoLink,
  type TodoOrigin,
} from '@wb/shared';
import type { Store } from '../store.js';
import { type Row, rowToTodo } from './shared.js';

/** A todo with parts that is not manual takes its status from them: all done, all open, or in between. */
function derive(t: Todo): void {
  for (const c of t.children) derive(c);
  if (t.manual || t.children.length === 0) return;
  const done = t.children.filter((c) => c.status === 'done').length;
  const open = t.children.filter((c) => c.status === 'open').length;
  t.status = done === t.children.length ? 'done' : open === t.children.length ? 'open' : 'doing';
  t.doneAt = t.status === 'done' ? Math.max(0, ...t.children.map((c) => c.doneAt ?? 0)) || t.doneAt : null;
}

export class TodosPart {
  // ───────────────────────── todos ─────────────────────────

  /** Todos are the student's, in every course. Top-level ones are filtered by status and course; parts come along. */
  listTodos(this: Store, filter: { status?: TodoStatus; course?: string } = {}): Todo[] {
    const rows = this.all('SELECT * FROM todos WHERE deleted_at IS NULL ORDER BY sort, created_at DESC, rowid');
    const byId = new Map<string, Todo>(rows.map((r) => [r.id as string, rowToTodo(r)]));
    const top: Todo[] = [];
    const tags = this.tagLinks('todo');
    for (const t of byId.values()) {
      t.tags = tags.get(t.id) ?? [];
      const parent = t.parentId ? byId.get(t.parentId) : undefined;
      if (parent) parent.children.push(t);
      else if (!t.parentId) top.push(t);
    }
    // Next block by rank, the rest newest first.
    for (const t of top) derive(t);
    top.sort((a, b) => (a.nextRank === null ? 1 : 0) - (b.nextRank === null ? 1 : 0) || (a.nextRank ?? 0) - (b.nextRank ?? 0) || b.createdAt - a.createdAt);
    return top.filter((t) => (filter.status === undefined || t.status === filter.status) && (filter.course === undefined || t.course === filter.course));
  }

  getTodo(this: Store, id: string): Todo | null {
    const r = this.get('SELECT * FROM todos WHERE id = ? AND deleted_at IS NULL', id);
    if (!r) return null;
    const build = (row: Row): Todo => {
      const t = rowToTodo(row);
      t.tags = this.tagsOf('todo', t.id);
      t.children = this.all('SELECT * FROM todos WHERE parent_id = ? AND deleted_at IS NULL ORDER BY sort, rowid', t.id).map(build);
      return t;
    };
    const t = build(r);
    derive(t);
    return t;
  }

  /** Null when the parent does not exist. A part takes its parent's course. */
  addTodo(this: Store, a: { id?: string; parentId?: string | null; title: string; body?: string | null; course?: string | null; link?: TodoLink | null; due?: string | null; minutes?: number | null; origin?: TodoOrigin }): Todo | null {
    const parent = a.parentId ? this.get('SELECT course FROM todos WHERE id = ? AND deleted_at IS NULL', a.parentId) : undefined;
    if (a.parentId && !parent) return null;
    const id = a.id ?? randomUUID();
    const t = this.now();
    const sort = Number((this.get('SELECT COALESCE(MAX(sort) + 1, 0) AS n FROM todos WHERE parent_id IS ? AND deleted_at IS NULL', a.parentId ?? null) as Row).n);
    this.run(
      'INSERT INTO todos (id, parent_id, sort, title, body, status, course, link_kind, link_ref, link_title, due, minutes, created_at, updated_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, a.parentId ?? null, sort, a.title, a.body ?? null, 'open',
      parent ? ((parent.course as string | null) ?? null) : (a.course ?? null),
      a.link?.kind ?? null, a.link?.ref ?? null, a.link?.title ?? null, a.due ?? null, a.minutes ?? null, t, t, a.origin ?? 'manual',
    );
    return this.getTodo(id);
  }

  /**
   * Changes a todo. `parentId` moves it (null: to the top); the result is a string when refused: 'unknown', 'cycle'
   * or 'child' (only top-level todos have a course or a rank).
   */
  updateTodo(this: Store, 
    id: string,
    p: { title?: string; body?: string | null; status?: TodoStatus; manual?: false; due?: string | null; minutes?: number | null; parentId?: string | null; course?: string | null; nextRank?: number | null; sort?: number },
  ): Todo | 'unknown' | 'cycle' | 'child' {
    const cur = this.get('SELECT * FROM todos WHERE id = ? AND deleted_at IS NULL', id);
    if (!cur) return 'unknown';
    return this.tx(() => {
      const t = this.now();
      let parentId = (cur.parent_id as string | null) ?? null;
      if (p.parentId !== undefined && p.parentId !== parentId) {
        if (p.parentId !== null) {
          if (!this.get('SELECT 1 FROM todos WHERE id = ? AND deleted_at IS NULL', p.parentId)) return 'unknown' as const;
          for (let a: string | null = p.parentId; a; a = ((this.get('SELECT parent_id FROM todos WHERE id = ?', a)?.parent_id as string | null) ?? null)) {
            if (a === id) return 'cycle' as const;
          }
        }
        parentId = p.parentId;
        const sort = Number((this.get('SELECT COALESCE(MAX(sort) + 1, 0) AS n FROM todos WHERE parent_id IS ? AND deleted_at IS NULL', parentId) as Row).n);
        this.run('UPDATE todos SET parent_id = ?, sort = ?, next_rank = NULL WHERE id = ?', parentId, sort, id);
        // Under a parent the course is the parent's; to the top it keeps what it had.
        if (parentId !== null) this.setTodoCourse(id, (this.get('SELECT course FROM todos WHERE id = ?', parentId)!.course as string | null) ?? null);
      }
      if (parentId !== null && (p.course !== undefined || (p.nextRank !== undefined && p.nextRank !== null))) return 'child' as const;
      if (p.course !== undefined) this.setTodoCourse(id, p.course);
      if (p.nextRank !== undefined) this.run('UPDATE todos SET next_rank = ? WHERE id = ?', p.nextRank, id);
      if (p.sort !== undefined) this.run('UPDATE todos SET sort = ? WHERE id = ?', p.sort, id);
      if (p.title !== undefined) this.run('UPDATE todos SET title = ? WHERE id = ?', p.title, id);
      if (p.body !== undefined) this.run('UPDATE todos SET body = ? WHERE id = ?', p.body, id);
      if (p.due !== undefined) this.run('UPDATE todos SET due = ? WHERE id = ?', p.due, id);
      if (p.minutes !== undefined) this.run('UPDATE todos SET minutes = ? WHERE id = ?', p.minutes, id);
      if (p.status !== undefined) {
        if (p.status !== cur.status) this.run('UPDATE todos SET status = ?, done_at = ? WHERE id = ?', p.status, p.status === 'done' ? t : null, id);
        this.run('UPDATE todos SET manual = 1 WHERE id = ?', id);
      } else if (p.manual === false) this.run('UPDATE todos SET manual = 0 WHERE id = ?', id);
      this.run('UPDATE todos SET updated_at = ? WHERE id = ?', t, id);
      return this.getTodo(id)!;
    });
  }

  setTodoCourse(this: Store, id: string, course: string | null): void {
    this.run('UPDATE todos SET course = ? WHERE id = ?', course, id);
    for (const c of this.all('SELECT id FROM todos WHERE parent_id = ? AND deleted_at IS NULL', id)) this.setTodoCourse(c.id as string, course);
  }

  /** The next block, in this order; every other top-level todo goes back to "Danach". False when an id is not a top-level todo. */
  reorderTodoNext(this: Store, ids: string[]): boolean {
    if (new Set(ids).size !== ids.length) return false;
    for (const id of ids) if (!this.get('SELECT 1 FROM todos WHERE id = ? AND parent_id IS NULL AND deleted_at IS NULL', id)) return false;
    this.tx(() => {
      this.run('UPDATE todos SET next_rank = NULL WHERE next_rank IS NOT NULL');
      ids.forEach((id, i) => this.run('UPDATE todos SET next_rank = ? WHERE id = ?', i, id));
    });
    return true;
  }

  /** Removes the todo and its parts. */
  deleteTodo(this: Store, id: string): boolean {
    if (!this.get('SELECT 1 FROM todos WHERE id = ? AND deleted_at IS NULL', id)) return false;
    const t = this.now();
    const go = (x: string) => {
      this.run('UPDATE todos SET deleted_at = ?, next_rank = NULL WHERE id = ?', t, x);
      for (const c of this.all('SELECT id FROM todos WHERE parent_id = ? AND deleted_at IS NULL', x)) go(c.id as string);
    };
    this.tx(() => go(id));
    return true;
  }

  /** Brings a deleted todo back with the parts that went with it. False when it is not deleted or its parent still is. */
  restoreTodo(this: Store, id: string): boolean {
    const r = this.get('SELECT deleted_at, parent_id FROM todos WHERE id = ? AND deleted_at IS NOT NULL', id);
    if (!r) return false;
    const at = r.deleted_at as number;
    const parent = r.parent_id as string | null;
    if (parent && !this.get('SELECT 1 FROM todos WHERE id = ? AND deleted_at IS NULL', parent)) return false;
    const go = (x: string) => {
      this.run('UPDATE todos SET deleted_at = NULL WHERE id = ?', x);
      for (const c of this.all('SELECT id FROM todos WHERE parent_id = ? AND deleted_at = ?', x, at)) go(c.id as string);
    };
    this.tx(() => go(id));
    return true;
  }
}
