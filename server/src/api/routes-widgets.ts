import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Evaluator } from '../runners/evaluate.js';
import type { Deps } from './deps.js';

const body = z.object({
  language: z.literal('haskell'),
  /** Definitions the expressions use, e.g. a fold the widget wrote from a data declaration. */
  setup: z.string().max(20_000),
  exprs: z.array(z.string().max(2_000)).max(200),
});

/**
 * `POST /api/evaluate`: results for widgets in course text. Runs code like the REPL does, behind the same
 * Host/Origin guard, so it gives a page nothing the interpreter of an exercise does not.
 */
export function widgetRoutes(app: FastifyInstance, d: Deps): void {
  const evaluator = new Evaluator({ ghciBin: d.config.ghciBin, dataDir: d.config.dataDir, libDir: d.haskellLib, pool: d.pool });
  app.post('/api/evaluate', async (req, reply) => {
    const b = body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.message });
    return { results: await evaluator.haskell(b.data.setup, b.data.exprs) };
  });
}
