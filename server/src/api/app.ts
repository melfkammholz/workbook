import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { aiRoutes } from './routes-ai.js';
import { annotationRoutes } from './routes-annotations.js';
import { questionRoutes } from './routes-questions.js';
import { contentRoutes } from './routes-content.js';
import { courseRoutes } from './routes-courses.js';
import { flashcardRoutes } from './routes-flashcards.js';
import { resourceRoutes } from './routes-resources.js';
import type { Deps } from './deps.js';
import { replSocket } from './repl-socket.js';
import { widgetRoutes } from './routes-widgets.js';
import { workRoutes } from './routes-work.js';

const SLOW_MS = 50;

export async function buildApp(d: Deps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 4 * 1024 * 1024, forceCloseConnections: true });

  // Registered first: the plugin's own hooks must run before ours, or a rejected
  // WebSocket handshake leaves its socket open and blocks shutdown.
  await app.register(fastifyWebsocket);

  // The app runs student code, so it must not be drivable from other web pages.
  const allowed = new Set(d.config.allowedHosts);
  app.addHook('onRequest', async (req, reply) => {
    const host = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
    if (!allowed.has(host)) return reply.code(403).send({ error: `host "${host}" is not allowed (see ALLOWED_HOSTS)` });
    // Browsers attach Origin to cross-site requests and to every WebSocket handshake.
    const origin = req.headers.origin;
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    if (origin && (mutating || req.url.startsWith('/ws/'))) {
      let originHost = '';
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        /* malformed → rejected below */
      }
      if (originHost !== (req.headers.host ?? '').toLowerCase()) return reply.code(403).send({ error: 'cross-site request rejected' });
    }
  });

  // In development, every slow answer says so: API reads should take under 10 ms, renders and runners excepted.
  if (process.env.NODE_ENV !== 'production') {
    app.addHook('onResponse', async (req, reply) => {
      const ms = reply.elapsedTime;
      if (ms > SLOW_MS) console.warn(`slow ${req.method} ${req.routeOptions.url ?? req.url.split('?')[0]} ${Math.round(ms)} ms`);
    });
  }

  // Before the first course is added, only what it takes to add one works, flashcards, which belong to no course, and
  // the backups, which may bring courses back.
  const WITHOUT_COURSE = ['/api/courses', '/api/settings', '/api/info', '/api/flashcards', '/api/resources', '/api/reset-all', '/api/snapshots'];
  app.addHook('onRequest', async (req, reply) => {
    if (d.courses.active || !(req.url.startsWith('/api/') || req.url.startsWith('/ws/'))) return;
    if (!WITHOUT_COURSE.some((p) => req.url.startsWith(p))) return reply.code(409).send({ error: 'no course yet' });
  });

  contentRoutes(app, d);
  workRoutes(app, d);
  aiRoutes(app, d);
  annotationRoutes(app, d);
  questionRoutes(app, d);
  courseRoutes(app, d);
  flashcardRoutes(app, d);
  resourceRoutes(app, d);
  widgetRoutes(app, d);
  replSocket(app, d);

  const web = d.config.webDir;
  if (web && fs.existsSync(path.join(web, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: web,
      cacheControl: false,
      // The build writes .br and .gz next to scripts, styles and index.html.
      preCompressed: true,
      // Hashed assets never change; index.html must be re-checked so updates show up.
      setHeaders(res, filePath) {
        res.header('cache-control', filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
