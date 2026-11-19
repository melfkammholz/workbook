import { randomUUID } from 'node:crypto';
import {
  type Todo,
  type TodoStatus,
  type TodoLink,
  type TodoOrigin,
} from '@wb/shared';
import type { Store } from '../store.js';
import { type Row, rowToTodo } from './shared.js';

/** What a followed part's item says now, or null when it says nothing (a page, or an item without work). */
type Follower = (t: Todo) => { status: TodoStatus; at: number | null } | null;

/** A todo with parts that is not manual takes its status from them (all done, all open, or in between), or from its item when it follows one. */
function derive(t: Todo, follower: Follower): void {
  for (const c of t.children) derive(c, follower);
  const sum = (t.minutes ?? 0) + t.children.reduce((n, c) => n + (c.status === 'done' ? 0 : c.minutesTotal ?? 0), 0);
  t.minutesTotal = sum > 0 ? sum : null;
  if (t.manual) return;
  if (t.follow && t.link) {
    const f = follower(t);
    if (f) {
      t.status = f.status;
      t.doneAt = f.status === 'done' ? f.at ?? t.doneAt : null;
    }
    return;
  }
  if (t.children.length === 0) return;
  const done = t.children.filter((c) => c.status === 'done').length;
  const open = t.children.filter((c) => c.status === 'open').length;
  t.status = done === t.children.length ? 'done' : open === t.children.length ? 'open' : 'doing';
  t.doneAt = t.status === 'done' ? Math.max(0, ...t.children.map((c) => c.doneAt ?? 0)) || t.doneAt : null;
}

export interface TodoTreeInput {
  title: string;
  course?: string | null;
  link?: TodoLink | null;
  follow?: boolean;
  origin?: TodoOrigin;
  parts?: TodoTreeInput[];
}

export class TodosPart {
  /**
   * Reads the student's work for every followed part in these trees: one query per workbook for items, one each for
   * decks and resources, never one per todo. Item and lesson: its work status; deck: reviewed at least once since the
   * part was made; resource: its reference is marked read.
   */
  private followerFor(this: Store, roots: Todo[]): Follower {
    const followed: Todo[] = [];
    const walk = (t: Todo) => {
      if (t.follow && t.link && !t.manual) followed.push(t);
      t.children.forEach(walk);
    };
    roots.forEach(walk);
    if (followed.length === 0) return () => null;
    const work = new Map<string, Map<string, TodoStatus>>();
    for (const c of new Set(followed.filter((t) => t.link!.kind === 'item' && t.course).map((t) => t.course as string))) {
      const m = new Map<string, TodoStatus>();
      for (const r of this.all('SELECT exercise_id, status FROM progress WHERE course = ?', c))
        m.set(r.exercise_id as string, r.status === 'done' || r.status === 'review' ? 'done' : r.status === 'in_progress' ? 'doing' : 'open');
      work.set(c, m);
    }
    const reviewed = new Map<string, number[]>();
    for (const r of this.all('SELECT deck_id, reviewed_at FROM card_reviews ORDER BY reviewed_at')) {
      const l = reviewed.get(r.deck_id as string) ?? [];
      l.push(Number(r.reviewed_at));
      reviewed.set(r.deck_id as string, l);
    }
    const read = new Set(this.all("SELECT resource FROM works WHERE state = 'read' AND resource IS NOT NULL").map((r) => r.resource as string));
    return (t) => {
      const { kind, ref } = t.link!;
      if (kind === 'item') {
        const m = t.course ? work.get(t.course) : undefined;
        return m ? { status: m.get(ref) ?? 'open', at: null } : null;
      }
      if (kind === 'deck') {
        const at = (reviewed.get(ref) ?? []).find((x) => x >= t.createdAt);
        return at === undefined ? { status: 'open', at: null } : { status: 'done', at };
      }
      if (kind === 'resource') return { status: read.has(ref) ? 'done' : 'open', at: null };
      return null;
    };
  }

  // ───────────────────────── todos ─────────────────────────

  /** Todos are the student's, in every course. Top-level ones are filtered by status and course; parts come along. */
  listTodos(this: Store, filter: { status?: TodoStatus; course?: string } = {}): Todo[] {
    const rows = this.all('SELECT * FROM todos WHERE deleted_at IS NULL ORDER BY sort, created_at DESC, rowid');
    const byId = new Map<string, Todo>(rows.map((r) => [r.id as string, rowToTodo(r)]));
    const top: Todo[] = [];
    const tags = this.tagLinks('todo');
    const next = this.nextLinks();
    for (const t of byId.values()) {
      t.tags = tags.get(t.id) ?? [];
      t.nextIds = (next.get(t.id) ?? []).filter((n) => byId.has(n));
      const parent = t.parentId ? byId.get(t.parentId) : undefined;
      if (parent) parent.children.push(t);
      else if (!t.parentId) top.push(t);
    }
    // Next block by rank, the rest newest first.
    const follower = this.followerFor(top);
    for (const t of top) derive(t, follower);
    top.sort((a, b) => (a.nextRank === null ? 1 : 0) - (b.nextRank === null ? 1 : 0) || (a.nextRank ?? 0) - (b.nextRank ?? 0) || b.createdAt - a.createdAt);
    return top.filter((t) => (filter.status === undefined || t.status === filter.status) && (filter.course === undefined || t.course === filter.course));
  }

  /** `todo_id` -> the ids that come after it, in order (deleted todos are filtered by the caller). */
  private nextLinks(this: Store): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (const r of this.all('SELECT todo_id, next_id FROM todo_next ORDER BY todo_id, sort')) {
      const l = m.get(r.todo_id as string) ?? [];
      l.push(r.next_id as string);
      m.set(r.todo_id as string, l);
    }
    return m;
  }

  getTodo(this: Store, id: string): Todo | null {
    const r = this.get('SELECT * FROM todos WHERE id = ? AND deleted_at IS NULL', id);
    if (!r) return null;
    const build = (row: Row): Todo => {
      const t = rowToTodo(row);
      t.tags = this.tagsOf('todo', t.id);
      t.nextIds = (this.nextLinks().get(t.id) ?? []).filter((n) => this.get('SELECT 1 FROM todos WHERE id = ? AND deleted_at IS NULL', n));
      t.children = this.all('SELECT * FROM todos WHERE parent_id = ? AND deleted_at IS NULL ORDER BY sort, rowid', t.id).map(build);
      return t;
    };
    const t = build(r);
    derive(t, this.followerFor([t]));
    return t;
  }

  /** Null when the parent does not exist. A part takes its parent's course. */
  addTodo(this: Store, a: { id?: string; parentId?: string | null; title: string; body?: string | null; course?: string | null; link?: TodoLink | null; follow?: boolean; due?: string | null; minutes?: number | null; origin?: TodoOrigin }): Todo | null {
    const parent = a.parentId ? this.get('SELECT course FROM todos WHERE id = ? AND deleted_at IS NULL', a.parentId) : undefined;
    if (a.parentId && !parent) return null;
    const id = a.id ?? randomUUID();
    const t = this.now();
    const sort = Number((this.get('SELECT COALESCE(MAX(sort) + 1, 0) AS n FROM todos WHERE parent_id IS ? AND deleted_at IS NULL', a.parentId ?? null) as Row).n);
    this.run(
      'INSERT INTO todos (id, parent_id, sort, title, body, status, course, link_kind, link_ref, link_title, follow, due, minutes, created_at, updated_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, a.parentId ?? null, sort, a.title, a.body ?? null, 'open',
      parent ? ((parent.course as string | null) ?? null) : (a.course ?? null),
      a.link?.kind ?? null, a.link?.ref ?? null, a.link?.title ?? null, a.follow && a.link ? 1 : 0, a.due ?? null, a.minutes ?? null, t, t, a.origin ?? 'manual',
    );
    return this.getTodo(id);
  }

  /**
   * Changes a todo. `parentId` moves it (null: to the top); the result is a string when refused: 'unknown', 'cycle'
   * or 'child' (only top-level todos have a course or a rank).
   */
  updateTodo(this: Store, 
    id: string,
    p: { title?: string; body?: string | null; status?: TodoStatus; manual?: boolean; follow?: boolean; due?: string | null; minutes?: number | null; parentId?: string | null; before?: string; after?: string; course?: string | null; nextRank?: number | null; sort?: number; nextIds?: string[] },
  ): Todo | 'unknown' | 'cycle' | 'child' | 'next' {
    const cur = this.get('SELECT * FROM todos WHERE id = ? AND deleted_at IS NULL', id);
    if (!cur) return 'unknown';
    if (p.nextIds && (new Set(p.nextIds).size !== p.nextIds.length || p.nextIds.some((n) => n === id || !this.get('SELECT 1 FROM todos WHERE id = ? AND deleted_at IS NULL', n)))) return 'next';
    return this.tx(() => {
      const t = this.now();
      if (p.nextIds) {
        this.run('DELETE FROM todo_next WHERE todo_id = ?', id);
        p.nextIds.forEach((n, i) => this.run('INSERT INTO todo_next (todo_id, next_id, sort) VALUES (?, ?, ?)', id, n, i));
      }
      let parentId = (cur.parent_id as string | null) ?? null;
      const place = p.before ?? p.after;
      if (p.parentId !== undefined && (p.parentId !== parentId || place)) {
        if (p.parentId !== null) {
          if (!this.get('SELECT 1 FROM todos WHERE id = ? AND deleted_at IS NULL', p.parentId)) return 'unknown' as const;
          for (let a: string | null = p.parentId; a; a = ((this.get('SELECT parent_id FROM todos WHERE id = ?', a)?.parent_id as string | null) ?? null)) {
            if (a === id) return 'cycle' as const;
          }
        }
        const from = parentId;
        parentId = p.parentId;
        const moved = parentId !== from;
        if (moved) {
          // A parent that loses its last part becomes a plain todo and keeps what it showed.
          const old = from ? this.getTodo(from) : null;
          if (old && old.children.length === 1 && !old.manual) {
            this.run('UPDATE todos SET status = ?, done_at = ?, manual = 1 WHERE id = ?', old.status, old.status === 'done' ? old.doneAt ?? t : null, from);
          }
          this.run('UPDATE todos SET parent_id = ?, next_rank = NULL WHERE id = ?', parentId, id);
        }
        // Land next to a sibling (or at the end): renumber the siblings so the order is explicit.
        const sibs = (this.all('SELECT id FROM todos WHERE parent_id IS ? AND deleted_at IS NULL AND id <> ? ORDER BY sort, rowid', parentId, id) as Row[]).map((r) => r.id as string);
        const at = place ? sibs.indexOf(place) : -1;
        sibs.splice(at < 0 ? sibs.length : p.before ? at : at + 1, 0, id);
        sibs.forEach((sid, i) => this.run('UPDATE todos SET sort = ? WHERE id = ?', i, sid));
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
      else if (p.manual === true && Number(cur.manual) === 0) {
        // "By hand" keeps what the part shows now.
        const eff = this.getTodo(id)!;
        this.run('UPDATE todos SET status = ?, done_at = ?, manual = 1 WHERE id = ?', eff.status, eff.status === 'done' ? eff.doneAt ?? t : null, id);
      }
      if (p.follow !== undefined && (!p.follow || cur.link_kind)) this.run('UPDATE todos SET follow = ? WHERE id = ?', p.follow ? 1 : 0, id);
      this.run('UPDATE todos SET updated_at = ? WHERE id = ?', t, id);
      return this.getTodo(id)!;
    });
  }

  /** A parent and its parts (and their parts) in one go, all in "Als Nächstes" order handled by the caller. Null when the parent id is unknown. */
  addTodoTree(this: Store, tree: TodoTreeInput, parentId: string | null = null): Todo | null {
    return this.tx(() => {
      const make = (n: TodoTreeInput, parent: string | null): string | null => {
        const made = this.addTodo({ parentId: parent, title: n.title, course: n.course ?? null, link: n.link ?? null, follow: n.follow ?? false, origin: n.origin ?? 'item' });
        if (!made) return null;
        for (const c of n.parts ?? []) if (!make(c, made.id)) return null;
        return made.id;
      };
      const id = make(tree, parentId);
      return id ? this.getTodo(id) : null;
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
