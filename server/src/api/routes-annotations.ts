import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ANNOTATION_COLORS, MAX_QUOTE, QUOTE_CONTEXT, type AnnotationEntry } from '@wb/shared';
import { isPart, withFound } from '../annotations.js';
import type { Deps } from './deps.js';

const color = z.enum(ANNOTATION_COLORS);
const review = z.enum(['open', 'resolved']).nullable();

const bodies = {
  add: z.object({
    target: z.string().min(1).max(300),
    part: z.string().refine(isPart, 'task, remark-<n> or hint-<n>'),
    quote: z.string().min(1).max(MAX_QUOTE),
    prefix: z.string().max(QUOTE_CONTEXT * 2),
    suffix: z.string().max(QUOTE_CONTEXT * 2),
    color,
    comment: z.string().max(4000).default(''),
    review: review.default(null),
  }),
  update: z.object({ color, comment: z.string().max(4000), review }).partial(),
};

/** Highlights and comments on the course's text. They belong to the student, in the open course. */
export function annotationRoutes(app: FastifyInstance, d: Deps): void {
  /** An item, or a text that is not one (chapter introduction, adventure page, landing page). */
  const textOf = (target: string) => d.content.current.get(target) ?? d.content.current.doc(target);

  /** All of them, and whether each can still be found in its text: the author may have changed it. */
  app.get('/api/annotations', async (): Promise<AnnotationEntry[]> =>
    withFound(d.store.listAnnotations(), async (target) => {
      const text = textOf(target);
      return text ? d.renderer.renderItem(text) : null;
    }),
  );

  app.post('/api/annotations', async (req, reply) => {
    const r = bodies.add.safeParse(req.body);
    if (!r.success) return reply.code(400).send({ error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    if (!textOf(r.data.target)) return reply.code(404).send({ error: 'unknown text' });
    return d.store.addAnnotation(r.data);
  });

  app.patch<{ Params: { id: string } }>('/api/annotations/:id', async (req, reply) => {
    const r = bodies.update.safeParse(req.body);
    if (!r.success) return reply.code(400).send({ error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return d.store.updateAnnotation(req.params.id, r.data) ?? reply.code(404).send({ error: 'unknown annotation' });
  });

  app.delete<{ Params: { id: string } }>('/api/annotations/:id', async (req, reply) =>
    d.store.deleteAnnotation(req.params.id) ? { ok: true } : reply.code(404).send({ error: 'unknown annotation' }),
  );
}
