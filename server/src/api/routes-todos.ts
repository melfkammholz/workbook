import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_TODO_BODY, MAX_TODO_TITLE, TODO_LINK_KINDS, TODO_STATUSES } from '@wb/shared';
import { withTargets } from '../todos/resolve.js';
import type { Deps } from './deps.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const link = z.object({ kind: z.enum(TODO_LINK_KINDS), ref: z.string().min(1).max(1000), title: z.string().max(300).nullable().default(null) });

type TreePart = { title: string; link?: { kind: (typeof TODO_LINK_KINDS)[number]; ref: string; title: string | null } | null; follow?: boolean; parts?: TreePart[] };
const treePart: z.ZodType<TreePart> = z.lazy(() =>
  z.object({ title: z.string().trim().min(1).max(MAX_TODO_TITLE), link: link.nullable().optional(), follow: z.boolean().optional(), parts: z.array(treePart).max(50).optional() }),
);

const bodies = {
  add: z.object({
    id: z.string().uuid().optional(),
    parentId: z.string().max(100).nullable().optional(),
    title: z.string().trim().min(1).max(MAX_TODO_TITLE),
    body: z.string().max(MAX_TODO_BODY).nullable().optional(),
    course: z.string().max(200).nullable().optional(),
    link: link.nullable().optional(),
    follow: z.boolean().optional(),
    due: date.nullable().optional(),
    minutes: z.number().int().min(1).max(100_000).nullable().optional(),
    origin: z.enum(['manual', 'item', 'ticket-line']).optional(),
  }),
  update: z
    .object({
      title: z.string().trim().min(1).max(MAX_TODO_TITLE),
      body: z.string().max(MAX_TODO_BODY).nullable(),
      status: z.enum(TODO_STATUSES as [string, ...string[]]),
      manual: z.boolean(),
      follow: z.boolean(),
      due: date.nullable(),
      minutes: z.number().int().min(1).max(100_000).nullable(),
      parentId: z.string().max(100).nullable(),
      course: z.string().max(200).nullable(),
      nextRank: z.number().int().min(0).max(1_000_000).nullable(),
      sort: z.number().int().min(0).max(1_000_000),
    })
    .partial(),
  tree: z.object({
    parentId: z.string().max(100).nullable().optional(),
    title: z.string().trim().min(1).max(MAX_TODO_TITLE),
    course: z.string().max(200).nullable().optional(),
    link: link.nullable().optional(),
    /** Each part becomes a part of the new parent; a part may have parts (an exercise's sub-tasks). */
    parts: z.array(treePart).max(200),
    /** The new parent goes to "Als Nächstes". */
    next: z.boolean().optional(),
  }),
  reorder: z.object({ ids: z.array(z.string().max(100)).max(500) }),
};

/** The student's todos: a tree, kept across workbooks like tickets. */
export function todoRoutes(app: FastifyInstance, d: Deps): void {
  const fail = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, error: { issues: { path: PropertyKey[]; message: string }[] }) =>
    reply.code(400).send({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });

  app.get<{ Querystring: { status?: string; course?: string } }>('/api/todos', async (req, reply) => {
    const { status, course } = req.query;
    if (status !== undefined && !(TODO_STATUSES as readonly string[]).includes(status)) return reply.code(400).send({ error: 'unknown status' });
    return withTargets(d, d.store.listTodos({ ...(status !== undefined ? { status: status as (typeof TODO_STATUSES)[number] } : {}), ...(course !== undefined ? { course } : {}) }));
  });

  app.post('/api/todos', async (req, reply) => {
    const r = bodies.add.safeParse(req.body);
    if (!r.success) return fail(reply, r.error);
    if (r.data.id && d.store.getTodo(r.data.id)) return reply.code(409).send({ error: 'todo exists' });
    const { link: l, ...rest } = r.data;
    const made = d.store.addTodo({ ...rest, ...(l !== undefined ? { link: l } : {}) });
    return made ? withTargets(d, [made])[0] : reply.code(404).send({ error: 'unknown parent' });
  });

  app.post('/api/todos/tree', async (req, reply) => {
    const r = bodies.tree.safeParse(req.body);
    if (!r.success) return fail(reply, r.error);
    const { parentId, next, ...tree } = r.data;
    const made = d.store.addTodoTree({ ...tree, origin: 'item' } as Parameters<typeof d.store.addTodoTree>[0], parentId ?? null);
    if (!made) return reply.code(404).send({ error: 'unknown parent' });
    if (next && !parentId) d.store.reorderTodoNext([...d.store.listTodos().filter((t) => t.nextRank !== null).map((t) => t.id), made.id]);
    return withTargets(d, [d.store.getTodo(made.id)!])[0];
  });

  // Before `/:id`, so that "reorder" is not taken for an id.
  app.post('/api/todos/reorder', async (req, reply) => {
    const r = bodies.reorder.safeParse(req.body);
    if (!r.success) return fail(reply, r.error);
    if (!d.store.reorderTodoNext(r.data.ids)) return reply.code(400).send({ error: 'ids must be distinct top-level todos' });
    return withTargets(d, d.store.listTodos());
  });

  app.patch<{ Params: { id: string } }>('/api/todos/:id', async (req, reply) => {
    const r = bodies.update.safeParse(req.body);
    if (!r.success) return fail(reply, r.error);
    const out = d.store.updateTodo(req.params.id, r.data as Parameters<typeof d.store.updateTodo>[1]);
    if (out === 'unknown') return reply.code(404).send({ error: 'unknown todo' });
    if (out === 'cycle') return reply.code(409).send({ error: 'a todo cannot go under its own part' });
    if (out === 'child') return reply.code(400).send({ error: 'only top-level todos have a workbook or a rank' });
    return withTargets(d, [out])[0];
  });

  app.post<{ Params: { id: string } }>('/api/todos/:id/restore', async (req, reply) =>
    d.store.restoreTodo(req.params.id) ? withTargets(d, [d.store.getTodo(req.params.id)!])[0] : reply.code(404).send({ error: 'nothing to restore' }),
  );

  app.delete<{ Params: { id: string } }>('/api/todos/:id', async (req, reply) =>
    d.store.deleteTodo(req.params.id) ? { ok: true } : reply.code(404).send({ error: 'unknown todo' }),
  );
}
