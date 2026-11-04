import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { CheckRun, Outline, ReplServerMessage, StudentState } from '@wb/shared';
import { buildApp } from '../src/api/app.js';
import { makeDeps } from '../src/api/deps.js';
import { loadConfig } from '../src/config.js';
import { CourseManager } from '../src/courses/manager.js';
import { SessionPool } from '../src/runners/pool.js';
import { EXAMPLE_CONTENT, HASKELL_LIB, PROLOG_LIB, hasBinary } from './helpers.js';

const typstBin = process.env.TYPST_BIN ?? 'typst';
const haveTypst = hasBinary(typstBin);
const haveGhc = hasBinary('ghci');

let app: Awaited<ReturnType<typeof buildApp>>;
let base: string;
let pool: SessionPool;
let courses: CourseManager;

beforeAll(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-api-'));
  const config = { ...loadConfig({ CONTENT_DIR: EXAMPLE_CONTENT, DATA_DIR: dataDir, TYPST_BIN: typstBin } as NodeJS.ProcessEnv), port: 0 };
  pool = new SessionPool(4, 60_000);
  courses = new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst') });
  app = await buildApp(makeDeps({ config, courses, pool, haskellLib: HASKELL_LIB, prologLib: PROLOG_LIB }));
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  pool.closeAll();
  await app.close();
  courses.close();
});

const api = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(`http://${base}${url}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
};

describe('content API', () => {
  it('serves the outline', async () => {
    const { json } = await api('GET', '/api/outline');
    const outline = json as Outline;
    expect(outline.title).toBe('Deklarative Programmierung');
    expect(outline.problems).toEqual([]);
    expect(outline.threads.map((t) => t.id)).toEqual(['ableitungen', 'rekursion', 'taschenrechner']);
  });

  it('404s for unknown items', async () => {
    expect((await api('GET', '/api/items/nope')).status).toBe(404);
    expect((await api('GET', '/api/work/nope')).status).toBe(404);
  });

  it.skipIf(!haveTypst)('serves a rendered item with its starter code', async () => {
    const { json } = await api('GET', '/api/items/automatic-differentiation');
    expect(json.rendered.hints).toHaveLength(3);
    expect(json.starter['Playground/AutomaticDifferentiation.hs']).toContain('instance Num a => Num (D a) where');
    expect(json.starter['Playground/AutomaticDifferentiation.hs']).not.toContain('#ifdef');
  });
});

describe('student data API', () => {
  const id = 'strong-typing';

  it('tracks progress and suggests what to do next', async () => {
    expect((await api('PUT', `/api/progress/${id}`, { status: 'review' })).json).toMatchObject({ status: 'review', reviewCount: 1 });
    expect((await api('PUT', `/api/progress/${id}`, { status: 'bogus' })).status).toBe(400);
    const { json } = await api('GET', '/api/state');
    expect((json.state as StudentState).progress[id]!.status).toBe('review');
    expect(json.suggestions.length).toBeGreaterThan(0);
  });

  it('autosaves answers and notes and returns them', async () => {
    await api('PUT', `/api/work/${id}/answer`, { slot: 'text', content: 'Jeder Ausdruck hat einen Typ.' });
    await api('PUT', `/api/work/${id}/note`, { format: 'typst', content: '= Idee\nTypen prüfen zur *Compilezeit*.' });
    const { json } = await api('GET', `/api/work/${id}`);
    expect(json.answers).toEqual({ text: 'Jeder Ausdruck hat einen Typ.' });
    expect(json.note.content).toContain('Compilezeit');
    const search = (await api('GET', '/api/search?q=compilezeit')).json;
    expect(search.mine[0]).toMatchObject({ exerciseId: id, source: 'note' });
  });

  it('records a reflection and activity', async () => {
    await api('POST', `/api/work/${id}/open`);
    await api('POST', `/api/work/${id}/tick`, { seconds: 45 });
    await api('POST', `/api/work/${id}/hints`, { count: 1 });
    expect((await api('POST', `/api/work/${id}/reflection`, { confidence: 9 })).status).toBe(400);
    const r = await api('POST', `/api/work/${id}/reflection`, { confidence: 2, how: ['hints'], comment: 'unsicher bei Typklassen' });
    expect(r.json).toMatchObject({ confidence: 2, how: ['hints'] });
    const { json } = await api('GET', '/api/state');
    expect(json.state.reflections[id].confidence).toBe(2);
    expect(json.state.stats[id]).toMatchObject({ activeSeconds: 45, hintsRevealed: 1 });
  });

  it('stores settings, and ignores what no longer exists', async () => {
    expect((await api('PUT', '/api/settings', { theme: 'dark', aiPromptTemplate: 'x {answer}', aiEnabled: true })).json).toMatchObject({ theme: 'dark', aiPromptTemplate: 'x {answer}' });
    const { json } = await api('GET', '/api/settings');
    expect(json.theme).toBe('dark');
    expect(json).not.toHaveProperty('aiEnabled');
    await api('PUT', '/api/settings', { aiPromptTemplate: '' });
  });

  it('gives the review page the answers and notes', async () => {
    const { json } = await api('GET', '/api/review');
    expect(json.answers[id].text).toBe('Jeder Ausdruck hat einen Typ.');
    expect(json.reflections.at(-1).confidence).toBe(2);
  });

  it('resets the timer of one exercise', async () => {
    expect((await api('POST', `/api/work/${id}/timer/reset`)).status).toBe(200);
    expect((await api('GET', `/api/work/${id}`)).json.stats.activeSeconds).toBe(0);
    expect((await api('POST', '/api/work/nope/timer/reset')).status).toBe(404);
    expect((await api('POST', '/api/work/nope/tick', { seconds: 5 })).status).toBe(404);
  });

  it('no longer offers export and import', async () => {
    expect((await api('GET', '/api/export')).status).toBe(404);
    expect((await api('POST', '/api/import', {})).status).toBe(404);
  });
});

describe('security guards', () => {
  it('rejects unknown Host headers (DNS rebinding)', async () => {
    const res = await new Promise<number>((resolve, reject) => {
      const [host, port] = base.split(':');
      // agent:false → a one-off connection; the body must be consumed so the socket can close.
      const req = http.request({ host, port: Number(port), path: '/api/info', headers: { host: 'evil.example' }, agent: false }, (r) => {
        r.resume();
        resolve(r.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(res).toBe(403);
  });

  it('rejects cross-site writes and cross-site WebSocket handshakes', async () => {
    const r = await api('PUT', '/api/progress/loops', { status: 'done' }, { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://${base}/ws/repl/strong-typing`, { origin: 'https://evil.example' });
      ws.on('unexpected-response', (_req, res) => {
        resolve(res.statusCode ?? 0);
        res.destroy();
      });
      ws.on('open', () => resolve(101));
      ws.on('error', () => {});
    });
    expect(code).toBe(403);
  });
});

describe.skipIf(!haveGhc)('running code', () => {
  const ad = 'automatic-differentiation';
  const file = 'Playground/AutomaticDifferentiation.hs';

  it('runs the checks and records the attempt', async () => {
    const starter = (await api('GET', '/api/items/' + ad)).json?.starter?.[file] as string | undefined;
    const content = await import('../src/content/loader.js').then((m) => m.loadContent(EXAMPLE_CONTENT).exercise(ad)!.code!);
    const wrong = await api('POST', `/api/work/${ad}/check`, { files: { [file]: starter ?? content.starter } });
    const run = wrong.json as CheckRun;
    expect(run.compiled).toBe(true);
    expect(run.results.some((r) => r.status === 'error')).toBe(true);

    const right = (await api('POST', `/api/work/${ad}/check`, { files: { [file]: content.solution } })).json as CheckRun;
    expect(right.results.every((r) => r.status === 'pass')).toBe(true);

    const state = (await api('GET', '/api/state')).json.state as StudentState;
    expect(state.stats[ad]).toMatchObject({ checkRuns: 2, checkPasses: 1 });
    expect(state.progress[ad]!.status).toBe('in_progress');
    const versions = (await api('GET', `/api/work/${ad}/versions?slot=${encodeURIComponent(file)}`)).json;
    expect(versions.length).toBe(2);
  });

  it('refuses to write files the exercise does not declare', async () => {
    const r = await api('POST', `/api/work/${ad}/check`, { files: { 'Evil.hs': 'main = pure ()' } });
    expect(r.status).toBe(400);
  });

  it('hands out the solution only on request and remembers that it did', async () => {
    expect((await api('GET', '/api/state')).json.state.stats[ad].solutionViewedAt).toBeNull();
    const r = await api('POST', `/api/work/${ad}/solution`);
    expect(r.json.files[file]).toContain('D x1 d1 + D x2 d2');
    expect((await api('GET', '/api/state')).json.state.stats[ad].solutionViewedAt).not.toBeNull();
    expect((await api('POST', '/api/work/strong-typing/solution')).status).toBe(404);
  });

  describe('order of code and queries on one connection', () => {
    const file = 'BinaryExponentiation.hs';
    const version = (n: number) => `module BinaryExponentiation (power) where\npower :: Num a => a -> Integer -> a\npower _ _ = ${n}\n`;
    /** A connected session, and a way to wait until its output contains something. */
    const session = async () => {
      const ws = new WebSocket(`ws://${base}/ws/repl/binary-exponentiation`);
      const messages: ReplServerMessage[] = [];
      let wake = () => {};
      ws.on('message', (raw) => {
        messages.push(JSON.parse(raw.toString()) as ReplServerMessage);
        wake();
      });
      const until = async (done: () => boolean, what: string) => {
        const end = Date.now() + 15_000;
        while (!done()) {
          if (Date.now() > end) throw new Error(`timed out waiting for ${what}; output: ${output()}`);
          await new Promise<void>((r) => {
            wake = r;
            setTimeout(r, 100);
          });
        }
      };
      const output = () => messages.flatMap((m) => (m.type === 'output' ? [m.text] : [])).join('');
      const loaded = () => messages.filter((m) => m.type === 'loaded').length;
      const send = (m: object) => ws.send(JSON.stringify(m));
      await until(() => messages.some((m) => m.type === 'ready'), 'ready');
      return { ws, send, until, output, loaded, messages };
    };

    it('runs a query against the code sent just before it, even with a reload still running', async () => {
      const s = await session();
      for (let round = 1; round <= 5; round++) {
        // The first load is under way when the second one and the query arrive.
        s.send({ type: 'load', files: { [file]: version(1000 + round) } });
        s.send({ type: 'load', files: { [file]: version(2000 + round) } });
        s.send({ type: 'input', text: 'power 2 10' });
        await s.until(() => s.output().includes(String(2000 + round)) || s.output().includes(String(1000 + round)), `round ${round}`);
        expect(s.output()).not.toContain(String(1000 + round));
        // Back at the prompt, as a person would be before typing the next thing.
        await s.until(() => s.messages.filter((m) => m.type === 'busy').at(-1)?.busy === false, 'the prompt');
      }
      s.ws.close();
    });

    it('still gives input to a running program while code waits to be loaded', async () => {
      const s = await session();
      s.send({ type: 'load', files: { [file]: version(1) } });
      await s.until(() => s.loaded() >= 1, 'first load');
      s.send({ type: 'input', text: 'getLine >>= putStrLn . reverse' });
      await s.until(() => s.messages.some((m) => m.type === 'busy' && m.busy), 'program started');
      s.send({ type: 'load', files: { [file]: version(2) } });
      s.send({ type: 'input', text: 'olleh' });
      await s.until(() => s.output().includes('hello'), 'the program to answer');
      await s.until(() => s.loaded() >= 2, 'the waiting load');
      s.send({ type: 'input', text: 'power 2 10' });
      await s.until(() => /^2$/m.test(s.output()), 'the new code');
      s.ws.close();
    });
  });

  it('drives a live REPL over WebSocket: load, diagnostics, evaluate, fix', async () => {
    const ws = new WebSocket(`ws://${base}/ws/repl/binary-exponentiation`);
    const inbox: ReplServerMessage[] = [];
    ws.on('message', (m) => inbox.push(JSON.parse(m.toString())));
    const waitFor = async <T extends ReplServerMessage['type']>(type: T, pred: (m: Extract<ReplServerMessage, { type: T }>) => boolean = () => true) => {
      for (let i = 0; i < 400; i++) {
        const idx = inbox.findIndex((m) => m.type === type && pred(m as never));
        if (idx >= 0) return inbox.splice(idx, 1)[0] as Extract<ReplServerMessage, { type: T }>;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`timed out waiting for ${type}; got ${JSON.stringify(inbox)}`);
    };
    await new Promise((r) => ws.once('open', r));
    await waitFor('ready');
    const send = (m: unknown) => ws.send(JSON.stringify(m));

    send({ type: 'load', files: { 'BinaryExponentiation.hs': 'module BinaryExponentiation (power) where\npower :: Num a => a -> Integer -> a\npower x n = x * "oops"\n' } });
    const bad = await waitFor('loaded');
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics[0]).toMatchObject({ severity: 'error', file: 'BinaryExponentiation.hs', line: 3 });

    send({ type: 'load', files: { 'BinaryExponentiation.hs': 'module BinaryExponentiation (power) where\npower :: Num a => a -> Integer -> a\npower x 0 = 1\npower x n = x * power x (n - 1)\n' } });
    expect((await waitFor('loaded')).ok).toBe(true);

    send({ type: 'input', text: 'power 2 10' });
    await waitFor('busy', (m) => m.busy === false);
    const outs: string[] = [];
    while (inbox.some((m) => m.type === 'output')) outs.push((await waitFor('output')).text);
    expect(outs.join('')).toContain('1024');

    // a scratch ghci cannot write files the exercise does not declare
    send({ type: 'load', files: { 'Evil.hs': 'x = 1' } });
    const closed = new Promise((r) => ws.once('close', r));
    ws.close();
    await closed;
  });
});
