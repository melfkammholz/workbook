import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Question } from '@wb/shared';
import { plainText } from '../content/search.js';
import { searchEverything } from '../courses/search.js';
import type { Deps } from './deps.js';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_TEXT = 12_000;

type Json = Record<string, unknown>;
class ToolError extends Error {}

const TOOLS = [
  {
    name: 'list_questions',
    description: "The student's open questions (newest first), with where each was asked. Filters are all optional.",
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'done'] },
        course: { type: 'string', description: 'Workbook id' },
        resource: { type: 'string', description: 'Material id' },
        pass: { type: 'integer', description: 'Pass id: questions captured in one sitting' },
        limit: { type: 'integer', description: 'Default 50' },
      },
    },
  },
  {
    name: 'search',
    description: "Full-text search over workbook texts, the student's own text (notes, answers, highlights, questions) and materials' pages. Every result says where it is (href, material and page).",
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'read_page',
    description: 'The text of one page (1-based) of a material, or of one workbook item (exercise, lesson, page). Solutions and author notes only if the student allows it.',
    inputSchema: {
      type: 'object',
      properties: { resource: { type: 'string' }, page: { type: 'integer' }, item: { type: 'string' }, course: { type: 'string', description: 'Workbook id, if the item id is not unique' } },
    },
  },
  {
    name: 'get_context',
    description: 'A question with its surroundings: the page of a material (with the pages around it) or the item it was asked about.',
    inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
  },
  { name: 'list_digests', description: 'Your own saved digests (your memory, per material or workbook).', inputSchema: { type: 'object', properties: { resource: { type: 'string' }, course: { type: 'string' } } } },
  {
    name: 'write_digest',
    description: 'Save or replace a digest for yourself (for example a summary of a material). The student can read and delete it in settings. It changes nothing else.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Replaces this digest' }, title: { type: 'string' }, content: { type: 'string' }, resource: { type: 'string' }, course: { type: 'string' } },
      required: ['title', 'content'],
    },
  },
];

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
const cut = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n… (cut, ${s.length - MAX_TEXT} more characters)` : s);

/** `POST /mcp`: a read-only assistant bridge, stateless Streamable HTTP with JSON answers. Off unless the student turned it on. */
export function mcpRoutes(app: FastifyInstance, d: Deps): void {
  const g = () => d.courses.global;
  const digest = (s: string) => crypto.createHash('sha256').update(s).digest();

  /** A new token; the old one stops working. */
  const newToken = () => g().saveSettings({ bridgeToken: crypto.randomBytes(24).toString('base64url') });

  app.post('/api/bridge/token', async () => newToken());
  app.get('/api/bridge/digests', async () => g().listDigests());
  app.delete<{ Params: { id: string } }>('/api/bridge/digests/:id', async (req, reply) => (g().deleteDigest(req.params.id) ? { ok: true } : reply.code(404).send({ error: 'unknown digest' })));

  const where = (q: Question): string => {
    const a = q.anchor;
    switch (a.kind) {
      case 'exercise':
      case 'item':
        return `${a.kind} ${a.id} (workbook ${a.course})`;
      case 'text':
        return `text of ${a.target} (workbook ${a.course}): "${a.quote}"`;
      case 'page':
        return `material ${a.resource}, page ${a.pageIndex + 1}${a.quote ? `: "${a.quote}"` : ''}`;
      case 'material':
        return `material ${a.resource}`;
      default:
        return 'nowhere in particular';
    }
  };

  const findItem = (id: string, course?: string) => {
    for (const s of d.courses.searchScope()) {
      if (course && s.id !== course && s.key !== course) continue;
      const item = s.content.get(id);
      if (item) return { s, item };
    }
    return null;
  };

  const itemText = (id: string, course?: string): string => {
    const found = findItem(id, course);
    if (!found) throw new ToolError(`unknown item "${id}"`);
    const { item } = found;
    if (!g().getSettings().bridgeIncludeSolutions) return `# ${item.meta.title}\n\n${plainText(item.typst)}`;
    let out = `# ${item.meta.title}\n\nSource (Typst, with hints and author notes):\n\n${item.typst}`;
    const code = 'code' in item ? item.code : null;
    if (code) for (const [file, text] of Object.entries(code.fullSolution)) out += `\n\nSolution, ${file}:\n\n${text}`;
    return out;
  };

  const pageText = (resource: string, page: number): string => {
    try {
      d.courses.resources.get(resource);
    } catch {
      throw new ToolError(`unknown material "${resource}"`);
    }
    const t = g().resourcePageText(resource, page - 1);
    if (t === null) throw new ToolError(`no text for page ${page} of "${resource}" (empty, out of range, or not read yet)`);
    return t;
  };

  const call = (name: string, a: Json): unknown => {
    switch (name) {
      case 'list_questions': {
        const course = str(a.course);
        const resource = str(a.resource);
        const pass = int(a.pass);
        const status = str(a.status);
        const qs = g()
          .listQuestions({ ...(course ? { course } : {}), ...(resource ? { resource } : {}) })
          .filter((q) => (!status || q.status === status) && (pass === undefined || q.passId === pass))
          .sort((x, y) => y.createdAt - x.createdAt)
          .slice(0, Math.min(int(a.limit) ?? 50, 200));
        return qs.map((q) => ({ id: q.id, text: q.text, status: q.status, answer: q.answer, where: where(q), pass: q.passId, created: new Date(q.createdAt).toISOString() }));
      }
      case 'search': {
        const query = str(a.query);
        if (!query) throw new ToolError('query is required');
        const r = searchEverything(d.courses, query);
        return {
          workbooks: r.items.map((i) => ({ item: i.id, title: i.title, workbook: i.course, snippet: i.snippet })),
          mine: r.mine.map((m) => ({ source: m.source, title: m.title, snippet: m.snippet, href: m.href })),
          materials: r.materials.map((m) => ({ resource: m.resource, title: m.title, page: m.page, snippet: m.snippet })),
        };
      }
      case 'read_page': {
        const resource = str(a.resource);
        const item = str(a.item);
        if (resource) {
          const page = int(a.page);
          if (page === undefined || page < 1) throw new ToolError('page (1-based) is required with resource');
          return cut(pageText(resource, page));
        }
        if (item) return cut(itemText(item, str(a.course)));
        throw new ToolError('give resource and page, or item');
      }
      case 'get_context': {
        const id = str(a.question);
        const q = id ? g().getQuestion(id) : null;
        if (!q) throw new ToolError('unknown question');
        const an = q.anchor;
        const out: Json = { question: { id: q.id, text: q.text, status: q.status, answer: q.answer, where: where(q) } };
        if (an.kind === 'page') {
          const pages: Json = {};
          for (const p of [an.pageIndex - 1, an.pageIndex, an.pageIndex + 1]) {
            const t = p >= 0 ? g().resourcePageText(an.resource, p) : null;
            if (t) pages[`page ${p + 1}`] = cut(t);
          }
          out.pages = pages;
        } else if (an.kind === 'exercise' || an.kind === 'item' || an.kind === 'text') {
          const itemId = an.kind === 'text' ? an.target : an.id;
          try {
            out.item = cut(itemText(itemId, an.course));
          } catch {
            /* the item may be gone */
          }
        }
        return out;
      }
      case 'list_digests': {
        const resource = str(a.resource);
        const course = str(a.course);
        return g()
          .listDigests()
          .filter((x) => (!resource || x.resource === resource) && (!course || x.course === course))
          .map((x) => ({ ...x, updatedAt: new Date(x.updatedAt).toISOString() }));
      }
      case 'write_digest': {
        const title = str(a.title);
        const content = typeof a.content === 'string' ? a.content : undefined;
        if (!title || content === undefined) throw new ToolError('title and content are required');
        if (content.length > 100_000) throw new ToolError('content is too long (100000 characters at most)');
        return { id: g().writeDigest({ ...(str(a.id) ? { id: str(a.id)! } : {}), title, content, resource: str(a.resource) ?? null, course: str(a.course) ?? null }) };
      }
      default:
        throw new ToolError(`unknown tool "${name}"`);
    }
  };

  const handle = (m: Json): Json | null => {
    const id = m.id as string | number | null | undefined;
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    const error = (code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
    if (id === undefined) return null; // a notification
    const params = (m.params ?? {}) as Json;
    switch (m.method) {
      case 'initialize': {
        const asked = str(params.protocolVersion);
        return ok({
          protocolVersion: asked && PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'workbook', version: '1' },
          instructions: "The student's workbook: their open questions, their own text and the text of their materials. Read-only, except your own digests.",
        });
      }
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: TOOLS });
      case 'tools/call':
        try {
          const text = call(String(params.name), (params.arguments ?? {}) as Json);
          return ok({ content: [{ type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text, null, 1) }] });
        } catch (e) {
          if (e instanceof ToolError) return ok({ isError: true, content: [{ type: 'text', text: e.message }] });
          throw e;
        }
      default:
        return error(-32601, `method not found: ${String(m.method)}`);
    }
  };

  app.get('/mcp', async (_req, reply) => reply.code(405).header('allow', 'POST').send({ error: 'POST only' }));
  app.post('/mcp', async (req, reply) => {
    const s = g().getSettings();
    if (!s.showAi || !s.assistantBridge || !s.bridgeToken) return reply.code(404).send({ error: 'not found' });
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!m || !crypto.timingSafeEqual(digest(m[1]!), digest(s.bridgeToken))) return reply.code(401).header('www-authenticate', 'Bearer').send({ error: 'unauthorized' });
    const body = req.body as unknown;
    if (Array.isArray(body)) {
      const out = body.flatMap((x) => (x && typeof x === 'object' ? [handle(x as Json)] : [])).filter((x): x is Json => x !== null);
      return out.length ? out : reply.code(202).send();
    }
    if (!body || typeof body !== 'object') return reply.code(400).send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    const out = handle(body as Json);
    return out ?? reply.code(202).send();
  });
}
