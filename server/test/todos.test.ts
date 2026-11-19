import { describe, expect, it } from 'vitest';
import { Store } from '../src/db/store.js';

function make() {
  let t = 1_700_000_000_000;
  return { store: new Store(':memory:', () => t), tick: (ms: number) => (t += ms) };
}

describe('todos', () => {
  it('builds a tree, parts inherit the course', () => {
    const { store } = make();
    const a = store.addTodo({ title: 'A', course: 'c1' })!;
    const b = store.addTodo({ title: 'B', parentId: a.id, course: 'other' })!;
    expect(b.course).toBe('c1');
    const list = store.listTodos();
    expect(list).toHaveLength(1);
    expect(list[0]!.children.map((c) => c.title)).toEqual(['B']);
    expect(store.addTodo({ title: 'x', parentId: 'nope' })).toBeNull();
    expect(store.listTodos({ course: 'zzz' })).toEqual([]);
  });

  it('moves, propagates the course, refuses cycles and ranks on parts', () => {
    const { store } = make();
    const a = store.addTodo({ title: 'A' })!;
    const b = store.addTodo({ title: 'B', parentId: a.id })!;
    const c = store.addTodo({ title: 'C', parentId: b.id })!;
    expect(store.updateTodo(a.id, { parentId: c.id })).toBe('cycle');
    expect(store.updateTodo(a.id, { parentId: a.id })).toBe('cycle');
    expect(store.updateTodo(b.id, { nextRank: 0 })).toBe('child');
    store.updateTodo(a.id, { course: 'k' });
    expect(store.getTodo(c.id)!.course).toBe('k');
    const moved = store.updateTodo(c.id, { parentId: null });
    expect(moved).toMatchObject({ parentId: null, course: 'k' });
    expect(store.updateTodo('nope', { title: 'x' })).toBe('unknown');
  });

  it('done sets and clears done_at; a parent does not touch its parts', () => {
    const { store, tick } = make();
    const a = store.addTodo({ title: 'A' })!;
    const b = store.addTodo({ title: 'B', parentId: a.id })!;
    tick(1000);
    const done = store.updateTodo(a.id, { status: 'done' });
    expect(done).toMatchObject({ status: 'done', doneAt: expect.any(Number) });
    expect(store.getTodo(b.id)!.status).toBe('open');
    expect(store.updateTodo(a.id, { status: 'open' })).toMatchObject({ status: 'open', doneAt: null });
    expect(store.listTodos({ status: 'open' })).toHaveLength(1);
  });

  it('orders the next block by rank, the rest newest first', () => {
    const { store, tick } = make();
    const a = store.addTodo({ title: 'A' })!;
    tick(10);
    const b = store.addTodo({ title: 'B' })!;
    tick(10);
    const c = store.addTodo({ title: 'C' })!;
    expect(store.listTodos().map((t) => t.title)).toEqual(['C', 'B', 'A']);
    expect(store.reorderTodoNext([a.id, c.id])).toBe(true);
    expect(store.listTodos().map((t) => t.title)).toEqual(['A', 'C', 'B']);
    expect(store.reorderTodoNext([c.id])).toBe(true);
    expect(store.listTodos().map((t) => t.title)).toEqual(['C', 'B', 'A']);
    const part = store.addTodo({ title: 'P', parentId: b.id })!;
    expect(store.reorderTodoNext([part.id])).toBe(false);
    expect(store.reorderTodoNext([a.id, a.id])).toBe(false);
  });

  it('deletes the subtree', () => {
    const { store } = make();
    const a = store.addTodo({ title: 'A' })!;
    const b = store.addTodo({ title: 'B', parentId: a.id })!;
    expect(store.deleteTodo(a.id)).toBe(true);
    expect(store.getTodo(b.id)).toBeNull();
    expect(store.listTodos()).toEqual([]);
    expect(store.deleteTodo(a.id)).toBe(false);
  });

  it('restores a deleted todo with its parts', () => {
    const { store } = make();
    const a = store.addTodo({ title: 'A' })!;
    const b = store.addTodo({ title: 'B', parentId: a.id })!;
    store.deleteTodo(a.id);
    expect(store.listTodos()).toEqual([]);
    expect(store.restoreTodo(b.id)).toBe(false);
    expect(store.restoreTodo(a.id)).toBe(true);
    expect(store.listTodos()[0]!.children.map((c) => c.title)).toEqual(['B']);
    expect(store.restoreTodo(a.id)).toBe(false);
  });

  it('keeps the search index in step', () => {
    const { store } = make();
    const find = (q: string) => store.search(q, { courses: ['c1'] }).filter((h) => h.source === 'todo').map((h) => h.anchor.id);
    const a = store.addTodo({ title: 'Monaden wiederholen', body: 'Kapitel Faltung', course: 'c1', link: { kind: 'item', ref: 'x', title: 'Unifikation' } })!;
    const b = store.addTodo({ title: 'Teil', parentId: a.id })!;
    expect(find('monaden')).toEqual([a.id]);
    expect(find('faltung')).toEqual([a.id]);
    expect(find('unifikation')).toEqual([a.id]);
    expect(find('teil')).toEqual([b.id]);
    store.updateTodo(a.id, { title: 'Funktoren', status: 'done' });
    expect(find('monaden')).toEqual([]);
    expect(find('funktoren')).toEqual([a.id]);
    store.deleteTodo(a.id);
    expect(find('funktoren')).toEqual([]);
    expect(find('teil')).toEqual([]);
    store.restoreTodo(a.id);
    expect(find('funktoren')).toEqual([a.id]);
    expect(find('teil')).toEqual([b.id]);
  });

  it('a parent follows its parts until the student sets it', () => {
    const { store } = make();
    const a = store.addTodo({ title: 'A' })!;
    const b = store.addTodo({ title: 'B', parentId: a.id })!;
    const c = store.addTodo({ title: 'C', parentId: a.id })!;
    expect(store.getTodo(a.id)!.status).toBe('open');
    store.updateTodo(b.id, { status: 'done' });
    expect(store.getTodo(a.id)).toMatchObject({ status: 'doing', storedStatus: 'open' });
    store.updateTodo(c.id, { status: 'done' });
    expect(store.listTodos({ status: 'done' }).map((x) => x.id)).toEqual([a.id]);
    store.updateTodo(a.id, { status: 'open' });
    expect(store.getTodo(a.id)).toMatchObject({ status: 'open', manual: true });
    store.updateTodo(a.id, { manual: false });
    expect(store.getTodo(a.id)!.status).toBe('done');
  });

  it('carries tags in the list and on one todo', () => {
    const { store } = make();
    const a = store.addTodo({ title: 'A' })!;
    const b = store.addTodo({ title: 'B', parentId: a.id })!;
    const tag = store.createTag('exam', '');
    store.setTags('todo', b.id, [tag.id]);
    expect(store.listTodos()[0]!.children[0]!.tags).toEqual([tag.id]);
    expect(store.getTodo(b.id)!.tags).toEqual([tag.id]);
    expect(store.getTodo(a.id)!.tags).toEqual([]);
  });
});
