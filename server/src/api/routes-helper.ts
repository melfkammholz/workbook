import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { MAX_REQUEST_NOTE, MAX_REQUEST_QUESTIONS, REQUEST_KINDS, type AssistantStatus, type RequestParams } from '@wb/shared';
import { helperScript } from '../assistant/helper-script.js';
import { queueOf } from '../assistant/requests.js';
import type { Deps } from './deps.js';

/**
 * The queue of requests to the assistant and the routes of the host helper. The helper key works on `/api/helper/*`
 * only (and gets nothing but an id and a skill name); the app's own routes need no key; the MCP token works on neither.
 */
export function helperRoutes(app: FastifyInstance, d: Deps): void {
  const g = () => d.courses.global;
  const queue = () => queueOf(d.courses);
  const allowed = () => {
    const s = g().getSettings();
    return s.showAi && s.assistantBridge && s.assistantRequests;
  };

  const status = (): AssistantStatus => ({ allowed: allowed(), connected: queue().connected, hasKey: queue().hasKey(), requests: queue().list() });

  app.get('/api/assistant', async () => status());
  app.post('/api/assistant/key', async () => ({ key: queue().newKey() }));

  const body = z.object({
    kind: z.enum(REQUEST_KINDS),
    questions: z.array(z.string().max(100)).max(MAX_REQUEST_QUESTIONS).default([]),
    item: z.string().max(300).optional(),
    note: z.string().max(MAX_REQUEST_NOTE).optional(),
  });
  app.post('/api/assistant/requests', async (req, reply) => {
    if (!allowed()) return reply.code(409).send({ error: 'requests to the assistant are off' });
    const r = body.safeParse(req.body);
    if (!r.success) return reply.code(400).send({ error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    const { kind, questions, item, note } = r.data;
    if (kind === 'exercise-help') {
      if (!item || !d.content.current.exercise(item)?.code) return reply.code(400).send({ error: 'exercise-help needs a programming exercise' });
    } else if (kind !== 'answer' && !questions.length) return reply.code(400).send({ error: 'questions are needed' });
    const known = questions.filter((id) => g().getQuestion(id));
    const params: RequestParams = { questions: known, ...(item ? { item } : {}), ...(note?.trim() ? { note: note.trim() } : {}) };
    return queue().create(kind, params, d.store.course);
  });
  app.post<{ Params: { id: string; action: string } }>('/api/assistant/requests/:id/:action', async (req, reply) => {
    const { id, action } = req.params;
    const out = action === 'cancel' ? queue().cancel(id) : action === 'dismiss' ? queue().dismiss(id) : action === 'retry' ? queue().retry(id) !== null : null;
    if (out === null) return reply.code(404).send({ error: 'unknown action' });
    return out ? status() : reply.code(409).send({ error: 'not possible now' });
  });

  // ───────────── the helper ─────────────

  const helperOnly = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!m || !queue().checkKey(m[1]!)) {
      void reply.code(401).header('www-authenticate', 'Bearer').send({ error: 'unauthorized' });
      return false;
    }
    queue().heartbeat();
    return true;
  };

  // Long poll: also the helper's heartbeat. The oldest queued request is claimed in the same step (one run at a time).
  app.get<{ Querystring: { wait?: string; busy?: string } }>('/api/helper/poll', async (req, reply) => {
    if (!helperOnly(req, reply)) return reply;
    const until = Date.now() + Math.min(Math.max(Number(req.query.wait ?? 0) || 0, 0), 25) * 1000;
    let aborted = false;
    req.raw.on('close', () => (aborted = true));
    for (;;) {
      const cancel = queue().toCancel();
      const claimed = req.query.busy === '1' || !allowed() ? null : queue().claim();
      if (claimed || cancel.length || Date.now() >= until || aborted) return { request: claimed ? { id: claimed.id, kind: claimed.kind, skill: claimed.skill } : null, cancel };
      await new Promise((r) => setTimeout(r, 1000));
    }
  });
  app.post<{ Params: { id: string } }>('/api/helper/report/:id', async (req, reply) => {
    if (!helperOnly(req, reply)) return reply;
    const r = z.object({ exitCode: z.number().int(), logTail: z.string().max(20_000) }).safeParse(req.body);
    if (!r.success) return reply.code(400).send({ error: 'bad report' });
    return queue().report(req.params.id, r.data.exitCode, r.data.logTail) ? { ok: true } : reply.code(404).send({ error: 'not a running request' });
  });

  // The script carries no secret: the key is given to it in the environment.
  app.get('/helper/workbook-helper.mjs', async (req, reply) => reply.type('text/javascript; charset=utf-8').send(helperScript(`${req.protocol}://${req.headers.host ?? ''}`)));
}
