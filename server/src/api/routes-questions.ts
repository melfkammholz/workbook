import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_QUESTION, MAX_QUOTE, SNIPPET_LENGTH, type Anchor } from '@wb/shared';
import type { Deps } from './deps.js';

const bodies = {
  add: z.object({
    /** Made by the client, so that a new question can be shown before the server has answered. */
    id: z.string().uuid().optional(),
    /** An item of the open workbook (its kind says whether the question is about an exercise) or `chapter/<id>`. */
    item: z.string().min(1).max(300).optional(),
    /** A page of a PDF, with the selection it was asked about, if any. Neither `item` nor `page`: asked where nothing was open. */
    page: z
      .object({
        resource: z.string().min(1).max(200),
        pageIndex: z.number().int().min(0).max(1_000_000),
        fingerprint: z.string().min(1).max(400),
        quote: z.string().max(MAX_QUOTE).optional(),
        prefix: z.string().max(200).optional(),
        suffix: z.string().max(200).optional(),
        snippet: z.string().max(SNIPPET_LENGTH * 2).optional(),
      })
      .optional(),
    /** A whole material, not tied to a page. */
    material: z.string().min(1).max(200).optional(),
    text: z.string().max(MAX_QUESTION),
    /** The pause was long, but the student chose to go on with the last pass. */
    continuePass: z.boolean().optional(),
  }),
  update: z.object({ text: z.string().max(MAX_QUESTION), status: z.enum(['open', 'done']), answer: z.string().max(MAX_QUESTION).nullable() }).partial(),
};

/** Open questions: the student's own list, kept across workbooks and across a reset of one. */
export function questionRoutes(app: FastifyInstance, d: Deps): void {
  const fail = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, error: { issues: { path: PropertyKey[]; message: string }[] }) =>
    reply.code(400).send({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });

  /** Without a filter, every question of every workbook. */
  app.get<{ Querystring: { course?: string; exercise?: string; resource?: string } }>('/api/questions', async (req) => {
    const { course, exercise, resource } = req.query;
    return d.store.listQuestions({ ...(course !== undefined ? { course } : {}), ...(exercise !== undefined ? { exercise } : {}), ...(resource !== undefined ? { resource } : {}) });
  });

  app.post('/api/questions', async (req, reply) => {
    const r = bodies.add.safeParse(req.body);
    if (!r.success) return fail(reply, r.error);
    if (r.data.id && d.store.getQuestion(r.data.id)) return reply.code(409).send({ error: 'question exists' });
    let anchor: Anchor = { kind: 'none' };
    if (r.data.item !== undefined) {
      const item = d.content.current.get(r.data.item);
      const chapter = r.data.item.startsWith('chapter/') && d.content.current.outline.chapters.some((c) => `chapter/${c.id}` === r.data.item);
      if (!item && !chapter) return reply.code(404).send({ error: 'unknown item' });
      anchor = { kind: item?.meta.type === 'exercise' ? 'exercise' : 'item', course: d.store.course, id: item ? item.meta.id : r.data.item };
    } else if (r.data.material) {
      if (!d.courses.resources.list().resources.some((x) => x.id === r.data.material)) return reply.code(404).send({ error: 'unknown material' });
      anchor = { kind: 'material', resource: r.data.material };
    } else if (r.data.page) {
      const p = r.data.page;
      const resource = d.courses.resources.list().resources.find((x) => x.id === p.resource);
      if (!resource) return reply.code(404).send({ error: 'unknown material' });
      anchor = {
        kind: 'page',
        resource: p.resource,
        version: resource.file.sha256,
        pageIndex: p.pageIndex,
        fingerprint: p.fingerprint,
        ...(p.quote ? { quote: p.quote, prefix: p.prefix ?? '', suffix: p.suffix ?? '' } : {}),
        ...(p.snippet ? { snippet: p.snippet } : {}),
      };
    }
    return d.store.addQuestion({ id: r.data.id, text: r.data.text, anchor, ...(r.data.continuePass ? { continuePass: true } : {}) });
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
