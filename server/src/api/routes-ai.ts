import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildPrompt } from '../ai/prompt.js';
import { htmlToText } from '../content/html.js';
import type { Deps } from './deps.js';

const promptBody = z.object({
  answer: z.string().max(200_000),
  tests: z
    .array(z.object({ name: z.string().max(500), status: z.enum(['pass', 'fail', 'error', 'timeout']), message: z.string().max(4000) }))
    .max(200)
    .nullable()
    .default(null),
  lang: z.enum(['de', 'en']),
});

/** Builds the text for the student to copy. The workbook itself never talks to an AI service. */
export function aiRoutes(app: FastifyInstance, d: Deps): void {
  app.post<{ Params: { id: string } }>('/api/work/:id/ai/prompt', async (req, reply) => {
    const parsed = promptBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    const ex = d.content.current.exercise(req.params.id);
    if (!ex) return reply.code(404).send({ error: 'unknown exercise' });
    if (!parsed.data.answer.trim()) return reply.code(400).send({ error: 'There is nothing to review yet.' });
    const rendered = await d.renderer.renderItem(ex);
    return {
      text: buildPrompt(d.courses.global.getSettings().aiPromptTemplate, {
        title: ex.meta.title,
        task: htmlToText(rendered.task),
        answer: parsed.data.answer,
        language: ex.meta.code?.language ?? null,
        tests: parsed.data.tests,
        questions: d.store.listQuestions({ course: d.store.course, exercise: req.params.id }).filter((q) => q.status === 'open' && q.text).map((q) => q.text),
        lang: parsed.data.lang,
      }),
    };
  });
}
