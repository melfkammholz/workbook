import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { CheckRun, Outline, ReplServerMessage, StudentState } from '@wb/shared';
import { quoteAt } from '@wb/shared';
import { textOfHtml } from '../src/annotations.js';
import { buildApp } from '../src/api/app.js';
import { makeDeps } from '../src/api/deps.js';
import { loadConfig } from '../src/config.js';
import { CourseManager } from '../src/courses/manager.js';
import { SessionPool } from '../src/runners/pool.js';
import { EXAMPLE_CONTENT, HASKELL_LIB, PROLOG_LIB, hasBinary, hasGhcWithQuickCheck, hasSldcheck } from './helpers.js';

const typstBin = process.env.TYPST_BIN ?? 'typst';
const haveTypst = hasBinary(typstBin);
const haveGhc = hasGhcWithQuickCheck();
const sldcheckBin = process.env.SLDCHECK_BIN ?? 'sldcheck';
const haveSldcheck = hasSldcheck(sldcheckBin);

let app: Awaited<ReturnType<typeof buildApp>>;
let base: string;
let pool: SessionPool;
let courses: CourseManager;

beforeAll(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-api-'));
  const config = { ...loadConfig({ CONTENT_DIR: EXAMPLE_CONTENT, DATA_DIR: dataDir, TYPST_BIN: typstBin, SLDCHECK_BIN: sldcheckBin } as NodeJS.ProcessEnv), port: 0 };
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
    expect(search.mine[0]).toMatchObject({ href: `/item/${id}`, source: 'note' });
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

  it.skipIf(!haveTypst)('keeps highlights with comments, finds them, and notices a quote that is gone', async () => {
    const task = (await api('GET', `/api/items/${id}`)).json.rendered.task as string;
    const text = textOfHtml(task);
    const start = text.search(/\S{6}/);
    const sel = quoteAt(text, start, start + 20)!;
    const add = await api('POST', '/api/annotations', { target: id, part: 'task', ...sel, color: 'yellow', comment: 'Warum gerade so herum?' });
    expect(add.status).toBe(200);
    expect(add.json).toMatchObject({ target: id, color: 'yellow', review: null });
    const gone = (await api('POST', '/api/annotations', { target: id, part: 'task', quote: 'steht nirgends im Text', prefix: '', suffix: '', color: 'blue' })).json;
    expect((await api('POST', '/api/annotations', { target: 'nope', part: 'task', ...sel, color: 'yellow' })).status).toBe(404);
    expect((await api('POST', '/api/annotations', { target: id, part: 'solution', ...sel, color: 'yellow' })).status).toBe(400);
    // The client may choose the id, so that it can show the highlight before the server has answered.
    const own = '6f1c2b8e-3d4a-4b5c-9e7f-0a1b2c3d4e5f';
    expect((await api('POST', '/api/annotations', { id: own, target: id, part: 'task', ...sel, color: 'pink' })).json).toMatchObject({ id: own });
    expect((await api('POST', '/api/annotations', { id: own, target: id, part: 'task', ...sel, color: 'pink' })).status).toBe(409);
    expect((await api('POST', '/api/annotations', { id: 'not-a-uuid', target: id, part: 'task', ...sel, color: 'pink' })).status).toBe(400);
    expect((await api('DELETE', `/api/annotations/${own}`)).status).toBe(200);

    const patched = await api('PATCH', `/api/annotations/${add.json.id}`, { review: 'open', color: 'green' });
    expect(patched.json).toMatchObject({ review: 'open', color: 'green', comment: 'Warum gerade so herum?' });
    const list = (await api('GET', '/api/annotations')).json as { id: string; found: boolean }[];
    expect(list.find((a) => a.id === add.json.id)?.found).toBe(true);
    expect(list.find((a) => a.id === gone.id)?.found).toBe(false);

    const search = (await api('GET', '/api/search?q=herum')).json;
    expect(search.mine).toContainEqual(expect.objectContaining({ source: 'annotation', href: `/item/${id}` }));

    expect((await api('DELETE', `/api/annotations/${gone.id}`)).status).toBe(200);
    expect((await api('DELETE', `/api/annotations/${gone.id}`)).status).toBe(404);
    expect((await api('PATCH', `/api/annotations/${gone.id}`, { comment: 'x' })).status).toBe(404);
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

describe.skipIf(!haveSldcheck)('SLD trees', () => {
  const id = 'sld-member';
  const file = 'member.sld';

  it('checks the tree against the program and records the attempt', async () => {
    const detail = (await api('GET', `/api/items/${id}`)).json;
    expect(detail.support['member.pl']).toContain('member(X, [_|T]) :- member(X, T).');
    expect(detail.starter[file]).toContain('?- member(X, [1, 2]), Y is X + 1.');

    const wrong = (await api('POST', `/api/work/${id}/check`, { files: { [file]: detail.starter[file] } })).json as CheckRun;
    expect(wrong.results.map((r) => r.status)).toEqual(['fail']);
    expect(wrong.diagnostics.some((d) => d.code === 'E022')).toBe(true);

    const solution = (await api('POST', `/api/work/${id}/solution`)).json.files[file] as string;
    const right = (await api('POST', `/api/work/${id}/check`, { files: { [file]: solution } })).json as CheckRun;
    expect(right.results.map((r) => r.status)).toEqual(['pass']);

    expect((await api('GET', '/api/state')).json.state.stats[id]).toMatchObject({ checkRuns: 2, checkPasses: 1 });
  });

  it('shows syntax errors on the socket while writing, and answers every load', async () => {
    const ws = new WebSocket(`ws://${base}/ws/repl/${id}`);
    const messages: ReplServerMessage[] = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString()) as ReplServerMessage));
    const until = async (done: () => boolean, what: string) => {
      const end = Date.now() + 10_000;
      while (!done()) {
        if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 25));
      }
    };
    await until(() => messages.some((m) => m.type === 'ready'), 'ready');
    const loaded = () => messages.filter((m): m is Extract<ReplServerMessage, { type: 'loaded' }> => m.type === 'loaded');

    ws.send(JSON.stringify({ type: 'load', files: { [file]: '?- member(X, [1, 2]).\n  | member(X1, [X1|_1]).\n   | {X |-> 1}\n' } }));
    await until(() => loaded().length === 1, 'the first load');
    expect(loaded()[0]).toMatchObject({ ok: false, diagnostics: [{ severity: 'error', file, line: 3 }] });

    ws.send(JSON.stringify({ type: 'load', files: { [file]: '?- member(X, [1, 2]), Y is X + 1.\n' } }));
    await until(() => loaded().length === 2, 'the second load');
    expect(loaded()[1]).toMatchObject({ ok: true, diagnostics: [] });
    ws.close();
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

  it('stops a test run on request and does not count it', async () => {
    const be = 'binary-exponentiation';
    const code = await import('../src/content/loader.js').then((m) => m.loadContent(EXAMPLE_CONTENT).exercise(be)!.code!);
    const looping = code.starter.replace('power x n = undefined', 'power x n = power x n');
    const t0 = Date.now();
    const pending = api('POST', `/api/work/${be}/check`, { files: { [code.studentPath]: looping } });
    await new Promise((r) => setTimeout(r, 1_500));
    expect((await api('POST', `/api/work/${be}/check/stop`)).status).toBe(200);
    const run = (await pending).json as CheckRun;
    expect(run.stopped).toBe(true);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect((await api('GET', '/api/state')).json.state.stats[be]?.checkRuns ?? 0).toBe(0);
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

describe('tags', () => {
  it('are made by typing a name, found again in any case, and cleaned up when merged or deleted', async () => {
    const post = async (name: string) => (await app.inject({ method: 'POST', url: '/api/tags', payload: { name } })).json() as { id: string; name: string };
    const a = await post('Rekursion');
    expect((await post('rekursion')).id).toBe(a.id);
    const b = await post('Monaden');
    await app.inject({ method: 'PUT', url: `/api/tags/on/question/q9`, payload: { ids: [b.id, 'nope'] } });
    expect((await app.inject({ method: 'PATCH', url: `/api/tags/${b.id}`, payload: { name: 'REKURSION' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/tags/${b.id}/merge`, payload: { into: a.id } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/api/tags/on/bogus/x', payload: { ids: [] } })).statusCode).toBe(404);
    const left = (await app.inject({ method: 'DELETE', url: `/api/tags/${a.id}` })).json() as { id: string }[];
    expect(left.some((t) => t.id === a.id || t.id === b.id)).toBe(false);
  });
});
