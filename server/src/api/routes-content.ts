import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ItemDetail } from '@wb/shared';
import type { Deps } from './deps.js';
import { docKey } from '../content/loader.js';
import { fold, snippetOf } from '../content/search.js';
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
  app.get<{ Params: { id: string } }>('/api/chapters/:id/intro', async (req, reply) => serveDoc(docKey.chapter(req.params.id), reply));
  app.get<{ Params: { id: string } }>('/api/threads/:id/page', async (req, reply) => serveDoc(docKey.thread(req.params.id), reply));

  app.post<{ Body: { source?: string } }>('/api/preview/note', async (req, reply) => {
    const source = req.body?.source;
    if (typeof source !== 'string' || source.length > 200_000) return reply.code(400).send({ error: 'source required' });
    return d.renderer.renderNote(source);
  });

  app.get<{ Querystring: { q?: string } }>('/api/search', async (req) => {
    const q = (req.query.q ?? '').trim();
    if (!q) return { items: [], mine: [] };
    const terms = fold(q).split(/\s+/).filter(Boolean);
    // Every word has to be there, somewhere. Titles count for more than the text.
    const items = d.content.current
      .searchTexts()
      .map((t) => ({ t, title: fold(t.title), text: fold(t.text) }))
      .filter(({ t, title, text }) => terms.every((w) => title.includes(w) || text.includes(w) || t.id.includes(w)))
      .sort((a, b) => Number(terms.every((w) => b.title.includes(w))) - Number(terms.every((w) => a.title.includes(w))))
      .slice(0, 20)
      .map(({ t }) => ({ id: t.id, title: t.title, href: t.href, snippet: snippetOf(t.text, terms) }));
    // Work in shared files is stored apart from any one exercise, so it links to one that uses them.
    const mine = d.store.search(q).flatMap((hit) => {
      const exerciseId = d.content.current.exerciseOfOwner(hit.exerciseId);
      return exerciseId ? [{ ...hit, exerciseId }] : [];
    });
    return { items, mine };
  });
}
