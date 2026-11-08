import { DEFAULT_FLASHCARD_PROMPT } from '@wb/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { FlashcardError } from '../flashcards/service.js';
import type { Deps } from './deps.js';

const DAY = 86_400_000;

const bodies = {
  create: z.object({ title: z.string().trim().min(1).max(200), forCourse: z.boolean().default(false) }),
  update: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    settings: z
      .object({
        retention: z.number().min(0.7).max(0.97),
        newPerDay: z.number().int().min(0).max(500),
        readyBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        maxCards: z.number().int().min(0).max(10_000),
        courses: z.array(z.string().max(200)).max(50),
      })
      .partial()
      .optional(),
  }),
  source: z.object({ source: z.string().max(1_000_000) }),
  card: z.object({
    kind: z.enum(['basic', 'both', 'cloze', 'quiz']),
    front: z.string().max(20_000),
    back: z.string().max(20_000).default(''),
    /** The exercise it is made in, in the open course. */
    exercise: z.string().max(200).nullable().default(null),
    /** Right after this card, e.g. the second half of a split. Otherwise at the end. */
    after: z.string().max(100).nullable().default(null),
    tags: z.array(z.string().max(100)).max(30).default([]),
    /** Written as is, e.g. for the second half of a split card. `exercise` wins. */
    from: z.string().max(300).nullable().default(null),
  }),
  edit: z.object({ kind: z.enum(['basic', 'both', 'cloze', 'quiz']), front: z.string().max(20_000), back: z.string().max(20_000).default(''), tags: z.array(z.string().max(100)).max(30).default([]) }),
  move: z.union([z.object({ direction: z.union([z.literal(-1), z.literal(1)]) }), z.object({ to: z.number().int().min(0) })]),
  rate: z.object({ key: z.string().max(100), rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) }),
  key: z.object({ key: z.string().max(100) }),
  prompt: z.object({ lang: z.enum(['de', 'en']) }),
};

/**
 * Flashcards. They work without a course: decks are the student's own, kept in the
 * main database. The start of the student's day comes from the browser (`today`),
 * as the server may run in another time zone.
 */
export function flashcardRoutes(app: FastifyInstance, d: Deps): void {
  const f = () => d.courses.flashcards;

  function parse<T extends z.ZodTypeAny>(schema: T, body: unknown, reply: FastifyReply): z.infer<T> | null {
    const r = schema.safeParse(body);
    if (r.success) return r.data;
    void reply.code(400).send({ error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return null;
  }
  const todayOf = (q: unknown): number => {
    const n = Number((q as { today?: string }).today);
    // A day that started more than a day ago (or has not started) is a client clock gone wrong.
    return Number.isFinite(n) && Math.abs(Date.now() - n) < 2 * DAY ? n : Date.now() - (Date.now() % DAY);
  };
  const fail = (e: unknown, reply: FastifyReply) => {
    if (e instanceof FlashcardError) return reply.code(e.code === 'unbalanced' ? 400 : 404).send({ error: e.code });
    throw e;
  };

  app.get('/api/flashcards', async (req) => f().list(todayOf(req.query)));

  app.post('/api/flashcards/decks', async (req, reply) => {
    const b = parse(bodies.create, req.body, reply);
    if (!b) return;
    // A deck made while working in a course belongs to it.
    const course = b.forCourse ? d.courses.active?.content.current.outline.id : undefined;
    return f().create(b.title, course ? [course] : []);
  });

  app.get<{ Params: { id: string } }>('/api/flashcards/decks/:id', async (req, reply) => {
    try {
      return f().get(req.params.id);
    } catch (e) {
      return fail(e, reply);
    }
  });

  app.patch<{ Params: { id: string } }>('/api/flashcards/decks/:id', async (req, reply) => {
    const b = parse(bodies.update, req.body, reply);
    if (!b) return;
    try {
      return f().update(req.params.id, { ...(b.title ? { title: b.title } : {}), ...(b.settings ? { settings: b.settings } : {}) });
    } catch (e) {
      return fail(e, reply);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/flashcards/decks/:id', async (req, reply) => {
    try {
      f().remove(req.params.id);
      return { ok: true };
    } catch (e) {
      return fail(e, reply);
    }
  });

  app.put<{ Params: { id: string } }>('/api/flashcards/decks/:id/source', async (req, reply) => {
    const b = parse(bodies.source, req.body, reply);
    if (!b) return;
    try {
      return f().saveSource(req.params.id, b.source);
    } catch (e) {
      return fail(e, reply);
    }
  });

  app.post<{ Params: { id: string } }>('/api/flashcards/decks/:id/cards', async (req, reply) => {
    const b = parse(bodies.card, req.body, reply);
    if (!b) return;
    if (!b.front.trim()) return reply.code(400).send({ error: 'empty' });
    const from = (b.exercise && d.courses.active?.content.current.get(b.exercise) ? d.courses.exerciseRef(b.exercise) : null) ?? b.from;
    try {
      return f().addCard(req.params.id, b.kind, b.front, b.back, from, b.after, b.tags);
    } catch (e) {
      return fail(e, reply);
    }
  });

  app.put<{ Params: { id: string; card: string } }>('/api/flashcards/decks/:id/cards/:card', async (req, reply) => {
    const b = parse(bodies.edit, req.body, reply);
    if (!b) return;
    if (!b.front.trim()) return reply.code(400).send({ error: 'empty' });
    try {
      return f().editCard(req.params.id, req.params.card, b.kind, b.front, b.back, b.tags);
    } catch (e) {
      return fail(e, reply);
    }
  });

  app.delete<{ Params: { id: string; card: string } }>('/api/flashcards/decks/:id/cards/:card', async (req, reply) => {
    try {
      return f().deleteCard(req.params.id, req.params.card);
    } catch (e) {
      return fail(e, reply);
    }
  });

  app.post<{ Params: { id: string; card: string } }>('/api/flashcards/decks/:id/cards/:card/move', async (req, reply) => {
    const b = parse(bodies.move, req.body, reply);
    if (!b) return;
    try {
      return 'to' in b ? f().moveCardTo(req.params.id, req.params.card, b.to) : f().moveCard(req.params.id, req.params.card, b.direction);
    } catch (e) {
      return fail(e, reply);
    }
  });

  /** Cards that keep being forgotten: to rewrite, split, drop or keep. */
  app.get<{ Querystring: { deck?: string } }>('/api/flashcards/struggling', async (req, reply) => {
    try {
      return await f().strugglingCards(req.query.deck || null);
    } catch (e) {
      return fail(e, reply);
    }
  });

  app.post<{ Params: { card: string } }>('/api/flashcards/cards/:card/keep', async (req) => {
    f().keep(req.params.card);
    return { ok: true };
  });

  /** For the open course's review page. */
  app.get('/api/flashcards/course', async (_req, reply) => {
    const course = d.courses.active;
    if (!course) return reply.code(409).send({ error: 'no course yet' });
    return f().courseCards(course.content.current.outline.id);
  });

  app.post('/api/flashcards/preview', async (req, reply) => {
    const b = parse(bodies.source, req.body, reply);
    if (!b) return;
    return f().preview(b.source);
  });

  // `decks`: the decks of this session, comma-separated.
  app.get<{ Querystring: { decks?: string; ahead?: string } }>('/api/flashcards/review', async (req, reply) => {
    const decks = (req.query.decks ?? '').split(',').filter(Boolean).slice(0, 100);
    if (!decks.length) return reply.code(400).send({ error: 'no decks' });
    try {
      return await f().next(decks, todayOf(req.query), req.query.ahead === '1');
    } catch (e) {
      return fail(e, reply);
    }
  });

  app.post('/api/flashcards/review', async (req, reply) => {
    const b = parse(bodies.rate, req.body, reply);
    if (!b) return;
    try {
      return f().rate(b.key, b.rating);
    } catch (e) {
      return fail(e, reply);
    }
  });

  app.post('/api/flashcards/bury', async (req, reply) => {
    const b = parse(bodies.key, req.body, reply);
    if (!b) return;
    try {
      f().bury(b.key, todayOf(req.query));
      return { ok: true };
    } catch (e) {
      return fail(e, reply);
    }
  });

  /** The text to paste into the student's own chat, to have the cards looked over. */
  app.post<{ Params: { id: string } }>('/api/flashcards/decks/:id/prompt', async (req, reply) => {
    const b = parse(bodies.prompt, req.body, reply);
    if (!b) return;
    try {
      const deck = f().get(req.params.id);
      if (!deck.source.trim()) return reply.code(400).send({ error: 'empty' });
      const values: Record<string, string> = { title: deck.title.replace(/"/g, "'"), deck: deck.source.trim() };
      // One pass, so whatever the cards contain stays as it is.
      return { text: DEFAULT_FLASHCARD_PROMPT[b.lang].replace(/\{(title|deck)\}/g, (_, k: string) => values[k]!) };
    } catch (e) {
      return fail(e, reply);
    }
  });
}
