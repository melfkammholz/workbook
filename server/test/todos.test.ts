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

  it('sums minutes upward, skipping done parts', () => {
    const { store } = make();
    const a = store.addTodo({ title: 'A', minutes: 20 })!;
    const b = store.addTodo({ title: 'B', parentId: a.id, minutes: 10 })!;
    store.addTodo({ title: 'C', parentId: b.id, minutes: 15 });
    const d = store.addTodo({ title: 'D', parentId: a.id, minutes: 30 })!;
    expect(store.listTodos()[0]).toMatchObject({ minutes: 20, minutesTotal: 75 });
    store.updateTodo(d.id, { status: 'done' });
    const top = store.listTodos()[0]!;
    expect(top.minutesTotal).toBe(45);
    expect(top.children[0]!.minutesTotal).toBe(25);
    expect(store.addTodo({ title: 'E' })!.minutesTotal).toBeNull();
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

  it('places a part before or after a sibling, across parents, and promotes', () => {
    const { store } = make();
    const a = store.addTodo({ title: 'A' })!;
    const x = store.addTodo({ title: 'X', parentId: a.id })!;
    const y = store.addTodo({ title: 'Y', parentId: a.id })!;
    const z = store.addTodo({ title: 'Z', parentId: a.id })!;
    const names = (id: string) => store.getTodo(id)!.children.map((c) => c.title).join('');
    store.updateTodo(z.id, { parentId: a.id, before: x.id });
    expect(names(a.id)).toBe('ZXY');
    store.updateTodo(z.id, { parentId: a.id, after: y.id });
    expect(names(a.id)).toBe('XYZ');
    const b = store.addTodo({ title: 'B' })!;
    const w = store.addTodo({ title: 'W', parentId: b.id })!;
    store.updateTodo(y.id, { parentId: b.id, before: w.id });
    expect(names(b.id)).toBe('YW');
    expect(names(a.id)).toBe('XZ');
    // The last part leaving makes the parent plain: it keeps its shown status.
    store.updateTodo(x.id, { status: 'done' });
    store.updateTodo(z.id, { status: 'done' });
    expect(store.getTodo(a.id)!.status).toBe('done');
    store.updateTodo(x.id, { parentId: null });
    store.updateTodo(z.id, { parentId: null });
    expect(store.getTodo(a.id)).toMatchObject({ status: 'done', manual: true, children: [] });
    expect(store.getTodo(x.id)!.parentId).toBeNull();
    expect(store.updateTodo(a.id, { parentId: b.id, before: 'nope' })).toMatchObject({ parentId: b.id });
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

  it('a followed part takes its status from the item, the student\'s own tick wins, clearing re-follows', () => {
    const { store, tick } = make();
    const a = store.addTodo({ title: 'Thread', course: 'c1' })!;
    const ex = store.addTodo({ title: 'Ex', parentId: a.id, link: { kind: 'item', ref: 'e1', title: null }, follow: true })!;
    const les = store.addTodo({ title: 'Les', parentId: a.id, link: { kind: 'item', ref: 'l1', title: null }, follow: true })!;
    const deck = store.addTodo({ title: 'Deck', parentId: a.id, link: { kind: 'deck', ref: 'd1', title: null }, follow: true })!;
    const res = store.addTodo({ title: 'Res', parentId: a.id, link: { kind: 'resource', ref: 'r1', title: null }, follow: true })!;
    const status = (id: string) => store.getTodo(id)!.status;
    expect([ex, les, deck, res].map((t) => status(t.id))).toEqual(['open', 'open', 'open', 'open']);
    const c1 = store.forCourse('c1');
    c1.setStatus('e1', 'in_progress');
    c1.setStatus('l1', 'done');
    expect([status(ex.id), status(les.id)]).toEqual(['doing', 'done']);
    expect(store.getTodo(a.id)!.status).toBe('doing');
    // A deck counts once it was reviewed after the part was made.
    tick(1000);
    store.run('INSERT INTO card_reviews (key, deck_id, rating, was_new, state, stability, difficulty, due, reviewed_at) VALUES (?,?,?,?,?,?,?,?,?)', 'k', 'd1', 3, 1, 1, 1, 1, 1, store.now());
    expect(status(deck.id)).toBe('done');
    // A resource counts when its reference is marked read.
    store.run("INSERT INTO resources (id, title, type, created_at, updated_at) VALUES ('r1', 'R', 'notes', 1, 1)");
    store.run("INSERT INTO works (id, resource, state, created_at, updated_at) VALUES ('w1', 'r1', 'read', 1, 1)");
    expect(status(res.id)).toBe('done');
    // The student's own tick wins, and clearing it follows the item again.
    store.updateTodo(ex.id, { status: 'done' });
    expect(store.getTodo(ex.id)).toMatchObject({ status: 'done', manual: true });
    c1.setStatus('e1', 'todo');
    expect(status(ex.id)).toBe('done');
    store.updateTodo(ex.id, { manual: false });
    expect(status(ex.id)).toBe('open');
    // "By hand" keeps what it shows now.
    c1.setStatus('e1', 'done');
    store.updateTodo(ex.id, { manual: true });
    c1.setStatus('e1', 'todo');
    expect(store.getTodo(ex.id)).toMatchObject({ status: 'done', manual: true });
  });

  it('makes a parent with parts and sub-parts in one go', () => {
    const { store } = make();
    const t = store.addTodoTree({ title: 'Path', course: 'c1', parts: [{ title: 'E', link: { kind: 'item', ref: 'e', title: 'E' }, follow: true, parts: [{ title: 'a)' }, { title: 'b)' }] }, { title: 'F' }] })!;
    expect(t.children.map((c) => c.title)).toEqual(['E', 'F']);
    expect(t.children[0]!.children).toHaveLength(2);
    expect(t.children[0]!).toMatchObject({ follow: true, course: 'c1' });
    expect(store.addTodoTree({ title: 'x' }, 'nope')).toBeNull();
  });
});
