import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { CourseError } from '../courses/manager.js';
import type { Deps } from './deps.js';

/** Errors carry a code, and the web app says what it means in the student's language. */
async function answer<T>(reply: FastifyReply, work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof CourseError) {
      void reply.code(e.code === 'unknown-course' ? 404 : 400).send({ error: e.code });
      return undefined;
    }
    throw e;
  }
}

export function courseRoutes(app: FastifyInstance, d: Deps): void {
  app.get('/api/courses', async () => d.courses.list());

  app.post('/api/courses', async (req, reply) => {
    const parsed = z.object({ url: z.string().min(1).max(2000) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad-url' });
    return answer(reply, () => d.courses.add(parsed.data.url));
  });

  app.post('/api/courses/check', async () => {
    await d.courses.checkUpdates();
    return d.courses.list();
  });

  app.post<{ Params: { id: string } }>('/api/courses/:id/activate', async (req, reply) => answer(reply, async () => d.courses.activate(req.params.id)));
  app.post<{ Params: { id: string } }>('/api/courses/:id/update', async (req, reply) => answer(reply, () => d.courses.update(req.params.id)));
  /** Everything the student did, in every course, and all flashcards and settings. Asks for the word, so no stray request does it. */
  app.post('/api/reset-all', async (req, reply) => {
    if ((req.body as { confirm?: unknown } | undefined)?.confirm !== 'reset') return reply.code(400).send({ error: 'confirm with "reset"' });
    return d.courses.resetAll();
  });

  /** Every row of a course's work and its copy. Asks for the word, like starting over. */
  app.post<{ Params: { id: string } }>('/api/courses/:id/delete', async (req, reply) => {
    if ((req.body as { confirm?: unknown } | undefined)?.confirm !== 'delete') return reply.code(400).send({ error: 'confirm with "delete"' });
    return answer(reply, async () => d.courses.deleteData(req.params.id));
  });
  /** Removing hides the course; its work stays for when it is added again. */
  app.delete<{ Params: { id: string } }>('/api/courses/:id', async (req, reply) => answer(reply, async () => d.courses.remove(req.params.id)));
}
