import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_QUESTION, type Anchor } from '@wb/shared';
import type { Deps } from './deps.js';

const bodies = {
  add: z.object({
    /** Made by the client, so that a new question can be shown before the server has answered. */
    id: z.string().uuid().optional(),
    /** An item of the open workbook; its kind says whether the question is about an exercise. */
    item: z.string().min(1).max(300),
    text: z.string().max(MAX_QUESTION),
  }),
  update: z.object({ text: z.string().max(MAX_QUESTION), status: z.enum(['open', 'done']), answer: z.string().max(MAX_QUESTION).nullable() }).partial(),
};

/** Open questions: the student's own list, kept across workbooks and across a reset of one. */
export function questionRoutes(app: FastifyInstance, d: Deps): void {
  const fail = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, error: { issues: { path: PropertyKey[]; message: string }[] }) =>
    reply.code(400).send({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });

  /** Without a filter, every question of every workbook. */
  app.get<{ Querystring: { course?: string; exercise?: string } }>('/api/questions', async (req) => {
    const { course, exercise } = req.query;
    return d.store.listQuestions({ ...(course !== undefined ? { course } : {}), ...(exercise !== undefined ? { exercise } : {}) });
  });

  app.post('/api/questions', async (req, reply) => {
    const r = bodies.add.safeParse(req.body);
    if (!r.success) return fail(reply, r.error);
    const item = d.content.current.get(r.data.item);
    if (!item) return reply.code(404).send({ error: 'unknown item' });
    if (r.data.id && d.store.getQuestion(r.data.id)) return reply.code(409).send({ error: 'question exists' });
    const anchor: Anchor = { kind: item.meta.type === 'exercise' ? 'exercise' : 'item', course: d.store.course, id: item.meta.id };
    return d.store.addQuestion({ id: r.data.id, text: r.data.text, anchor });
  });

  app.patch<{ Params: { id: string } }>('/api/questions/:id', async (req, reply) => {
    const r = bodies.update.safeParse(req.body);
    if (!r.success) return fail(reply, r.error);
    return d.store.updateQuestion(req.params.id, r.data) ?? reply.code(404).send({ error: 'unknown question' });
  });

  app.delete<{ Params: { id: string } }>('/api/questions/:id', async (req, reply) =>
    d.store.deleteQuestion(req.params.id) ? { ok: true } : reply.code(404).send({ error: 'unknown question' }),
  );
}
