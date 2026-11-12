import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MAX_PAGE_MARKS, MAX_PAGE_NOTE, MAX_QUOTE, MAX_TOC_LEVEL, MAX_TOC_TITLE, MAX_RECTS, QUOTE_CONTEXT, RESOURCE_TYPES, isAnnotationColor } from '@wb/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { mimeOf, ResourceError } from '../resources/service.js';
import type { Deps } from './deps.js';

/** The biggest file: a scanned script can be 100+ MB. */
export const MAX_FILE_BYTES = 500 * 1024 * 1024;

const fields = {
  title: z.string().trim().min(1).max(300),
  type: z.enum(RESOURCE_TYPES),
  author: z.string().trim().max(300).default(''),
  date: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default(''),
  courses: z.array(z.string().min(1).max(200)).max(50).default([]),
  series: z.string().max(100).nullable().default(null),
  newSeries: z.string().trim().max(300).optional(),
};
const edit = z.object(fields);
/** An upload has no JSON body, so its fields come in the query; `courses` is a comma-separated list. */
const upload = z.object({
  ...fields,
  filename: z.string().trim().min(1).max(300),
  courses: z.string().max(5000).default('').transform((s) => s.split(',').map((c) => c.trim()).filter(Boolean)),
  series: z.string().max(100).optional().transform((s) => s || null),
});

const color = z.string().transform((c) => c.toLowerCase()).refine(isAnnotationColor, 'a palette color or #rrggbb');
const review = z.enum(['open', 'resolved']).nullable();
const frac = z.number().min(0).max(1);
const highlight = {
  add: z.object({
    /** Made by the client, so that a new highlight can be shown (and changed) before the server has answered. */
    id: z.string().uuid().optional(),
    version: z.string().regex(/^[0-9a-f]{64}$/),
    pageIndex: z.number().int().min(0).max(1_000_000),
    rects: z.array(z.object({ x: frac, y: frac, w: frac, h: frac })).min(1).max(MAX_RECTS),
    quote: z.string().min(1).max(MAX_QUOTE),
    prefix: z.string().max(QUOTE_CONTEXT * 2),
    suffix: z.string().max(QUOTE_CONTEXT * 2),
    color,
    label: z.string().max(100).nullable().default(null),
    comment: z.string().max(4000).default(''),
    review: review.default(null),
  }),
  update: z.object({ color, label: z.string().max(100).nullable(), comment: z.string().max(4000), review }).partial(),
};

const pageItem = z.object({
  /** Made by the client; only used when the page has no item yet. */
  id: z.string().uuid().optional(),
  version: z.string().regex(/^[0-9a-f]{64}$/),
  fingerprint: z.string().min(1).max(400),
  note: z.string().max(MAX_PAGE_NOTE).optional(),
  marks: z.array(z.string().min(1).max(100)).max(MAX_PAGE_MARKS).optional(),
  review: review.optional(),
});

const tocItem = z.object({
  id: z.string().uuid().optional(),
  version: z.string().regex(/^[0-9a-f]{64}$/),
  fingerprint: z.string().min(1).max(400),
  pageIndex: z.number().int().min(0).max(1_000_000),
  title: z.string().max(MAX_TOC_TITLE).optional(),
  level: z.number().int().min(0).max(MAX_TOC_LEVEL).nullable().optional(),
  hidden: z.boolean().optional(),
  embeddedKey: z.string().min(1).max(400).nullable().optional(),
});

/**
 * Materials: the student's own files, kept in the main database and in `<data>/files/`. They belong to no course,
 * so they work before a course is added.
 */
export function resourceRoutes(app: FastifyInstance, d: Deps): void {
  const r = () => d.courses.resources;

  function parse<T extends z.ZodTypeAny>(schema: T, body: unknown, reply: FastifyReply): z.infer<T> | null {
    const res = schema.safeParse(body);
    if (res.success) return res.data;
    void reply.code(400).send({ error: res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return null;
  }
  const fail = (e: unknown, reply: FastifyReply) => {
    if (e instanceof ResourceError) return reply.code(e.code === 'same-file' || e.code === 'page-taken' ? 409 : e.code === 'no-file' ? 400 : 404).send({ error: e.code });
    throw e;
  };

  app.get('/api/resources', async (req) => r().list((req.query as { course?: string }).course || undefined));

  app.put<{ Params: { id: string } }>('/api/resources/:id', async (req, reply) => {
    const b = parse(edit, req.body, reply);
    if (!b) return;
    try {
      return r().update(req.params.id, b);
    } catch (e) {
      return fail(e, reply);
    }
  });

  /** The viewer remembers the page (1-based) the student was on. */
  app.put<{ Params: { id: string } }>('/api/resources/:id/page', async (req, reply) => {
    const b = parse(z.object({ page: z.number().int().min(1).max(1_000_000) }), req.body, reply);
    if (!b) return;
    try {
      r().setLastPage(req.params.id, b.page);
      return reply.code(204).send();
    } catch (e) {
      return fail(e, reply);
    }
  });

  // Highlights in PDFs: one request loads all of a resource's; the list of every one feeds the highlights page.
  app.get('/api/pdf-annotations', async () => r().listHighlights());
  app.get<{ Params: { id: string } }>('/api/resources/:id/annotations', async (req, reply) => {
    try {
      r().get(req.params.id);
      return r().listHighlights(req.params.id);
    } catch (e) {
      return fail(e, reply);
    }
  });
  app.post<{ Params: { id: string } }>('/api/resources/:id/annotations', async (req, reply) => {
    const b = parse(highlight.add, req.body, reply);
    if (!b) return;
    if (b.id && r().getHighlight(b.id)) return reply.code(409).send({ error: 'annotation exists' });
    try {
      return r().addHighlight(req.params.id, b);
    } catch (e) {
      return fail(e, reply);
    }
  });
  app.patch<{ Params: { id: string } }>('/api/pdf-annotations/:id', async (req, reply) => {
    const b = parse(highlight.update, req.body, reply);
    if (!b) return;
    return r().updateHighlight(req.params.id, b) ?? reply.code(404).send({ error: 'unknown annotation' });
  });
  app.delete<{ Params: { id: string } }>('/api/pdf-annotations/:id', async (req, reply) => (r().deleteHighlight(req.params.id) ? { ok: true } : reply.code(404).send({ error: 'unknown annotation' })));

  // Notes on whole pages: one request loads a resource's; saving is one call that makes or changes the page's item.
  app.get('/api/pdf-pages', async () => r().listPages());
  app.get<{ Params: { id: string } }>('/api/resources/:id/pages', async (req, reply) => {
    try {
      r().get(req.params.id);
      return r().listPages(req.params.id);
    } catch (e) {
      return fail(e, reply);
    }
  });
  app.put<{ Params: { id: string; index: string } }>('/api/resources/:id/pages/:index', async (req, reply) => {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index > 1_000_000) return reply.code(400).send({ error: 'bad page' });
    const b = parse(pageItem, req.body, reply);
    if (!b) return;
    try {
      return r().savePage(req.params.id, index, b);
    } catch (e) {
      return fail(e, reply);
    }
  });

  // The table of contents: the student's own entries and changes to the embedded outline (the outline itself is read in the browser).
  app.get<{ Params: { id: string } }>('/api/resources/:id/toc', async (req, reply) => {
    try {
      r().get(req.params.id);
      return r().listToc(req.params.id);
    } catch (e) {
      return fail(e, reply);
    }
  });
  app.put<{ Params: { id: string } }>('/api/resources/:id/toc', async (req, reply) => {
    const b = parse(tocItem, req.body, reply);
    if (!b) return;
    try {
      return r().saveToc(req.params.id, b);
    } catch (e) {
      return fail(e, reply);
    }
  });
  app.delete<{ Params: { id: string; tid: string } }>('/api/resources/:id/toc/:tid', async (req, reply) =>
    r().deleteToc(req.params.id, req.params.tid) ? { ok: true } : reply.code(404).send({ error: 'unknown entry' }),
  );

  app.delete<{ Params: { id: string } }>('/api/resources/:id', async (req, reply) => {
    try {
      r().delete(req.params.id);
      return r().list();
    } catch (e) {
      return fail(e, reply);
    }
  });

  app.get<{ Params: { id: string } }>('/api/resources/:id/file', async (req, reply) => {
    let res;
    try {
      res = r().get(req.params.id);
    } catch (e) {
      return fail(e, reply);
    }
    const file = r().filePath(res.file.sha256);
    if (!file) return reply.code(404).send({ error: 'file-missing' });
    const etag = `"${res.file.sha256}"`;
    // A version's file never changes, so the browser may keep it.
    void reply.header('ETag', etag).header('Cache-Control', 'private, max-age=31536000, immutable').header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', 'sandbox');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    const safe = mimeOf(res.file.filename);
    const name = encodeURIComponent(res.file.filename);
    void reply.type(safe).header('Content-Length', fs.statSync(file).size);
    void reply.header('Content-Disposition', `${safe === 'application/octet-stream' ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`);
    return reply.send(fs.createReadStream(file));
  });

  // New versions: which items still sit on an older file, where the browser found them on the new one, and what is left to fix.
  app.get<{ Params: { id: string } }>('/api/resources/:id/stale', async (req, reply) => {
    try {
      return r().listStale(req.params.id);
    } catch (e) {
      return fail(e, reply);
    }
  });
  const placed = z.object({ pageIndex: z.number().int().min(0).max(1_000_000), rects: z.array(z.object({ x: frac, y: frac, w: frac, h: frac })).min(1).max(MAX_RECTS) });
  const movedPage = z.object({ id: z.string().min(1).max(100), pageIndex: z.number().int().min(0).max(1_000_000).nullable(), fingerprint: z.string().min(1).max(400).optional() });
  const reanchored = z.object({
    version: z.string().regex(/^[0-9a-f]{64}$/),
    highlights: z.array(z.object({ id: z.string().min(1).max(100), place: placed.nullable() })).max(100_000),
    pages: z.array(movedPage).max(100_000),
    toc: z.array(movedPage).max(100_000),
  });
  app.post<{ Params: { id: string } }>('/api/resources/:id/reanchor', async (req, reply) => {
    const b = parse(reanchored, req.body, reply);
    if (!b) return;
    try {
      return r().reanchor(req.params.id, b);
    } catch (e) {
      return fail(e, reply);
    }
  });
  app.get<{ Params: { id: string } }>('/api/resources/:id/unplaced', async (req, reply) => {
    try {
      return r().listUnplaced(req.params.id);
    } catch (e) {
      return fail(e, reply);
    }
  });
  const kind = z.enum(['highlight', 'page', 'toc']);
  app.put<{ Params: { id: string; kind: string; item: string } }>('/api/resources/:id/unplaced/:kind/:item', async (req, reply) => {
    const k = parse(kind, req.params.kind, reply);
    const b = parse(z.object({ pageIndex: z.number().int().min(0).max(1_000_000), rects: placed.shape.rects.optional(), fingerprint: z.string().min(1).max(400).optional() }), req.body, reply);
    if (!k || !b) return;
    try {
      r().placeUnplaced(req.params.id, k, req.params.item, b);
      return r().listUnplaced(req.params.id);
    } catch (e) {
      return fail(e, reply);
    }
  });
  app.delete<{ Params: { id: string; kind: string; item: string } }>('/api/resources/:id/unplaced/:kind/:item', async (req, reply) => {
    const k = parse(kind, req.params.kind, reply);
    if (!k) return;
    try {
      r().dropUnplaced(req.params.id, k, req.params.item);
      return r().listUnplaced(req.params.id);
    } catch (e) {
      return fail(e, reply);
    }
  });

  // The upload is a raw body, streamed to disk while it is hashed. The parser lives in its own scope, so no other
  // route sees an octet-stream body.
  void app.register(async (scope) => {
    scope.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

    /** Streams the body to `<data>/files/<sha256>`; null once the reply is sent (an error). */
    async function receive(req: { body?: unknown }, reply: FastifyReply): Promise<{ sha256: string; size: number } | null> {
      const dir = r().filesDir;
      fs.mkdirSync(dir, { recursive: true });
      const tmp = path.join(dir, `.upload-${crypto.randomBytes(6).toString('hex')}`);
      const hash = crypto.createHash('sha256');
      let size = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          size += chunk.length;
          if (size > MAX_FILE_BYTES) return cb(new Error('too-large'));
          hash.update(chunk);
          cb(null, chunk);
        },
      });
      try {
        await pipeline(req.body as NodeJS.ReadableStream, meter, fs.createWriteStream(tmp));
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        const big = e instanceof Error && e.message === 'too-large';
        void reply.code(big ? 413 : 400).send({ error: big ? 'too-large' : 'upload-failed' });
        return null;
      }
      if (size === 0) {
        fs.rmSync(tmp, { force: true });
        void reply.code(400).send({ error: 'empty-file' });
        return null;
      }
      const sha256 = hash.digest('hex');
      const final = path.join(dir, sha256);
      if (fs.existsSync(final)) fs.rmSync(tmp, { force: true });
      else fs.renameSync(tmp, final);
      return { sha256, size };
    }

    scope.post('/api/resources/upload', { bodyLimit: MAX_FILE_BYTES }, async (req, reply) => {
      const q = parse(upload, req.query, reply);
      if (!q) {
        req.raw.resume();
        return;
      }
      const got = await receive(req, reply);
      if (!got) return;
      try {
        const { filename, ...rest } = q;
        return r().create(rest, { sha256: got.sha256, filename, size: got.size });
      } catch (e) {
        r().removeIfUnused(got.sha256);
        return fail(e, reply);
      }
    });

    /** A new file for a resource: the highlights and notes are placed on it by the browser afterwards. */
    scope.post<{ Params: { id: string } }>('/api/resources/:id/version', { bodyLimit: MAX_FILE_BYTES }, async (req, reply) => {
      const q = parse(z.object({ filename: z.string().trim().min(1).max(300) }), req.query, reply);
      if (!q) {
        req.raw.resume();
        return;
      }
      try {
        r().get(req.params.id);
      } catch (e) {
        req.raw.resume();
        return fail(e, reply);
      }
      const got = await receive(req, reply);
      if (!got) return;
      try {
        return r().addVersion(req.params.id, { sha256: got.sha256, filename: q.filename, size: got.size });
      } catch (e) {
        r().removeIfUnused(got.sha256);
        return fail(e, reply);
      }
    });
  });
}
