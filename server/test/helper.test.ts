import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/api/app.js';
import { makeDeps } from '../src/api/deps.js';
import { loadConfig } from '../src/config.js';
import { CourseManager } from '../src/courses/manager.js';
import { SessionPool } from '../src/runners/pool.js';
import { EXAMPLE_CONTENT, HASKELL_LIB, PROLOG_LIB } from './helpers.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let courses: CourseManager;
let key = '';
let token = '';

beforeAll(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-helper-'));
  const config = { ...loadConfig({ CONTENT_DIR: EXAMPLE_CONTENT, DATA_DIR: dataDir } as NodeJS.ProcessEnv), port: 0 };
  courses = new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst') });
  app = await buildApp(makeDeps({ config, courses, pool: new SessionPool(1, 60_000), haskellLib: HASKELL_LIB, prologLib: PROLOG_LIB }));
});
afterAll(async () => {
  await app.close();
  courses.close();
});

const api = (method: 'GET' | 'POST', url: string, payload?: object, authorization?: string) => app.inject({ method, url, ...(payload ? { payload } : {}), ...(authorization ? { headers: { authorization } } : {}) });
const helper = (url: string, method: 'GET' | 'POST' = 'GET', payload?: object) => api(method, url, payload, `Bearer ${key}`);
const mcp = async (name: string, args: object) => (await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, `Bearer ${token}`)).json().result;

describe('host helper', () => {
  it('queues nothing until the student allows it', async () => {
    expect((await api('POST', '/api/assistant/requests', { kind: 'answer' })).statusCode).toBe(409);
    await api('POST', '/api/bridge/token');
    token = (await api('POST', '/api/bridge/token')).json().bridgeToken;
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { showAi: true, assistantBridge: true, assistantRequests: true } });
    expect((await api('GET', '/api/assistant')).json()).toMatchObject({ allowed: true, connected: false, hasKey: false, requests: [] });
  });

  it('gives the helper a key that works on /api/helper only', async () => {
    expect((await helper('/api/helper/poll')).statusCode).toBe(401);
    key = (await api('POST', '/api/assistant/key')).json().key;
    expect((await api('GET', '/api/helper/poll', undefined, `Bearer ${token}`)).statusCode).toBe(401); // the MCP token is not the helper key
    expect((await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, `Bearer ${key}`)).statusCode).toBe(401);
    expect((await api('GET', '/api/questions', undefined, `Bearer ${key}`)).statusCode).toBe(401);
    expect((await helper('/api/helper/poll')).json()).toEqual({ request: null, cancel: [] });
    expect((await api('GET', '/api/assistant')).json().connected).toBe(true);
    const old = key;
    key = (await api('POST', '/api/assistant/key')).json().key;
    expect((await api('GET', '/api/helper/poll', undefined, `Bearer ${old}`)).statusCode).toBe(401);
  });

  it('hands out one request at a time and counts what it did from its own records', async () => {
    const q = (await api('POST', '/api/questions', { text: 'Why is foldr lazy?' })).json();
    const a = (await api('POST', '/api/assistant/requests', { kind: 'answer', questions: [q.id, 'nope'], note: 'short' })).json();
    const b = (await api('POST', '/api/assistant/requests', { kind: 'cards', questions: [q.id] })).json();
    expect(a).toMatchObject({ status: 'queued', skill: 'workbook-answer-recent', params: { questions: [q.id], note: 'short' } });
    expect((await api('POST', '/api/assistant/requests', { kind: 'cards' })).statusCode).toBe(400);
    expect((await api('POST', '/api/assistant/requests', { kind: 'exercise-help', item: 'nope' })).statusCode).toBe(400);

    const polled = (await helper('/api/helper/poll')).json();
    expect(polled.request).toEqual({ id: a.id, kind: 'answer', skill: 'workbook-answer-recent' }); // ids and a skill name, nothing else
    expect((await helper('/api/helper/poll')).json().request).toBeNull(); // b waits while a runs
    expect(await api('GET', '/api/assistant').then((r) => r.json().requests.map((x: { status: string }) => x.status))).toEqual(['running', 'queued']);

    // The assistant reads the request through the MCP and reads the question under its number.
    const got = JSON.parse((await mcp('get_request', { request: a.id, purpose: `workbook-answer-recent #${a.id}` })).content[0].text);
    expect(got).toMatchObject({ kind: 'answer', questions: [q.id], studentNote: 'short' });
    expect((await mcp('get_request', { request: b.id, purpose: 'x' })).isError).toBe(true); // not running
    const read = JSON.parse((await mcp('list_questions', { purpose: `workbook-answer-recent #${a.id}`, ids: [q.id] })).content[0].text);
    expect(read.questions).toHaveLength(1);

    expect((await helper(`/api/helper/report/${a.id}`, 'POST', { exitCode: 0, logTail: 'ok' })).statusCode).toBe(200);
    expect((await helper(`/api/helper/report/${a.id}`, 'POST', { exitCode: 0, logTail: 'ok' })).statusCode).toBe(404);
    expect((await api('GET', '/api/assistant')).json().requests[0]).toMatchObject({ id: a.id, status: 'done', summary: { read: 1, proposed: 0 } });

    // b runs next, the student cancels it, the helper is told and reports; it ends as cancelled
    expect((await helper('/api/helper/poll')).json().request.id).toBe(b.id);
    await api('POST', `/api/assistant/requests/${b.id}/cancel`);
    expect((await helper('/api/helper/poll?busy=1')).json().cancel).toEqual([b.id]);
    await helper(`/api/helper/report/${b.id}`, 'POST', { exitCode: 143, logTail: '' });
    expect((await api('GET', '/api/assistant')).json().requests.find((x: { id: string }) => x.id === b.id).status).toBe('cancelled');
  });

  it('shows a failure, lets the student retry or dismiss it', async () => {
    const q = (await api('POST', '/api/questions', { text: 'What is a monoid?' })).json();
    const r = (await api('POST', '/api/assistant/requests', { kind: 'assess', questions: [q.id] })).json();
    await helper('/api/helper/poll');
    await helper(`/api/helper/report/${r.id}`, 'POST', { exitCode: 1, logTail: 'claude: command not found' });
    const failed = (await api('GET', '/api/assistant')).json().requests.find((x: { id: string }) => x.id === r.id);
    expect(failed).toMatchObject({ status: 'failed', logTail: 'claude: command not found' });
    const again = (await api('POST', `/api/assistant/requests/${r.id}/retry`)).json();
    expect(again.requests.filter((x: { id: string }) => x.id === r.id)).toHaveLength(0); // the old one is dismissed
    const queued = again.requests.find((x: { status: string }) => x.status === 'queued');
    expect(queued).toMatchObject({ kind: 'assess' });
    await api('POST', `/api/assistant/requests/${queued.id}/cancel`);
  });

  it('serves the helper script with the app address and no key', async () => {
    const r = await api('GET', '/helper/workbook-helper.mjs');
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('WORKBOOK_HELPER_KEY');
    expect(r.body).not.toContain(key);
  });
});
