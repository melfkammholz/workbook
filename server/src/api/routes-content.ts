import type { FastifyInstance, FastifyReply } from 'fastify';
import { FOCUSES, type Focus, type ItemDetail } from '@wb/shared';
import type { Deps } from './deps.js';
import { docKey } from '../content/loader.js';
import { searchEverything } from '../courses/search.js';
import { suggestNext } from '../suggest.js';

export function contentRoutes(app: FastifyInstance, d: Deps): void {
  app.get('/api/info', async () => ({
    typst: d.courses.active ? await d.renderer.version() : 'no course',
  }));

  app.get('/api/outline', async () => d.content.current.outline);

  app.get('/api/state', async () => {
    const state = d.store.getState();
    return { state, suggestions: suggestNext(d.content.current.outline, state, Date.now()) };
  });

  app.get<{ Params: { id: string } }>('/api/items/:id', async (req, reply) => {
    const item = d.content.current.get(req.params.id);
    if (!item) return reply.code(404).send({ error: 'unknown item' });
    const code = item.meta.type === 'exercise' && 'code' in item ? item.code : null;
    const detail: ItemDetail = {
      meta: item.meta,
      rendered: { ...(await d.renderer.renderItem(item)), samples: [] },
      starter: code?.files ?? {},
      support: code?.support ?? {},
    };
    return detail;
  });

  // Texts that are not an item: the landing page, chapter introductions, adventure pages.
  const serveDoc = (key: string, reply: FastifyReply) => {
    const doc = d.content.current.doc(key);
    return doc ? d.renderer.renderItem(doc) : reply.code(404).send({ error: 'no such text' });
  };
  app.get('/api/landing', async (_req, reply) => serveDoc(docKey.landing, reply));
  app.post('/api/landing/seen', async () => {
    d.store.markLandingSeen();
    return { ok: true };
  });
  app.put<{ Body: { focus?: unknown } }>('/api/focus', async (req, reply) => {
    const focus = req.body?.focus;
    if (!FOCUSES.includes(focus as Focus)) return reply.code(400).send({ error: `focus: one of ${FOCUSES.join(', ')}` });
    d.store.setFocus(focus as Focus);
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>('/api/chapters/:id/intro', async (req, reply) => serveDoc(docKey.chapter(req.params.id), reply));
  app.get<{ Params: { id: string } }>('/api/threads/:id/page', async (req, reply) => serveDoc(docKey.thread(req.params.id), reply));

  app.post<{ Body: { source?: string; width?: number } }>('/api/preview/note', async (req, reply) => {
    const source = req.body?.source;
    if (typeof source !== 'string' || source.length > 200_000) return reply.code(400).send({ error: 'source required' });
    // The width of the preview, in pt: a picture fallback is laid out at it.
    const width = req.body?.width;
    return d.renderer.renderNote(source, typeof width === 'number' && width >= 100 && width <= 2000 ? width : undefined);
  });

  app.get<{ Querystring: { q?: string } }>('/api/search', async (req) => searchEverything(d.courses, (req.query.q ?? '').trim()));
}
