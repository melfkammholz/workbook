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
let token = '';

beforeAll(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mcp-'));
  const config = { ...loadConfig({ CONTENT_DIR: EXAMPLE_CONTENT, DATA_DIR: dataDir } as NodeJS.ProcessEnv), port: 0 };
  courses = new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst') });
  app = await buildApp(makeDeps({ config, courses, pool: new SessionPool(1, 60_000), haskellLib: HASKELL_LIB, prologLib: PROLOG_LIB }));
});
afterAll(async () => {
  await app.close();
  courses.close();
});

const rpc = (method: string, params?: object, headers: Record<string, string> = {}, id: number | null = 1) =>
  app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${token}`, ...headers }, payload: { jsonrpc: '2.0', ...(id !== null ? { id } : {}), method, ...(params ? { params } : {}) } });
const tool = async (name: string, args: object = {}) => {
  const r = (await rpc('tools/call', { name, arguments: args })).json();
  return { error: !!r.result.isError, text: r.result.content[0].text as string };
};

describe('assistant bridge', () => {
  it('is not there until turned on', async () => {
    expect((await rpc('ping')).statusCode).toBe(404);
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { showAi: true, assistantBridge: true } });
    expect((await rpc('ping')).statusCode).toBe(404); // no token yet
    token = (await app.inject({ method: 'POST', url: '/api/bridge/token' })).json().bridgeToken;
    expect(token.length).toBeGreaterThan(20);
  });

  it('checks the token and the host', async () => {
    expect((await rpc('ping', undefined, { authorization: 'Bearer nope' })).statusCode).toBe(401);
    expect((await rpc('ping', undefined, { authorization: '' })).statusCode).toBe(401);
    expect((await rpc('ping', undefined, { host: 'evil.example' })).statusCode).toBe(403);
    expect((await rpc('ping')).json().result).toEqual({});
  });

  it('a new token ends the old one', async () => {
    const old = token;
    token = (await app.inject({ method: 'POST', url: '/api/bridge/token' })).json().bridgeToken;
    expect(token).not.toBe(old);
    expect((await rpc('ping', undefined, { authorization: `Bearer ${old}` })).statusCode).toBe(401);
  });

  it('speaks the protocol', async () => {
    const init = (await rpc('initialize', { protocolVersion: '2025-03-26' })).json().result;
    expect(init.protocolVersion).toBe('2025-03-26');
    expect(init.capabilities.tools).toBeDefined();
    expect((await rpc('notifications/initialized', undefined, {}, null)).statusCode).toBe(202);
    const names = (await rpc('tools/list')).json().result.tools.map((x: { name: string }) => x.name);
    expect([...names].sort()).toEqual(['get_context', 'list_digests', 'list_questions', 'read_page', 'search', 'write_digest']);
    expect((await rpc('nope')).json().error.code).toBe(-32601);
  });

  it('lists questions, with filters', async () => {
    const item = courses.active!.content.current.all()[0]!.meta.id;
    await app.inject({ method: 'POST', url: '/api/questions', payload: { item, text: 'Was ist foldr?' } });
    const all = JSON.parse((await tool('list_questions')).text);
    expect(all.some((q: { text: string }) => q.text === 'Was ist foldr?')).toBe(true);
    expect(JSON.parse((await tool('list_questions', { status: 'done' })).text)).toEqual([]);
  });

  it('searches and reads an item, with solutions only if allowed', async () => {
    const ex = courses.active!.content.current.all().find((i) => i.meta.type === 'exercise' && 'code' in i && i.code?.solution)!;
    const withSol = await tool('read_page', { item: ex.meta.id });
    expect(withSol.error).toBe(false);
    expect(withSol.text).toContain('Solution');
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { bridgeIncludeSolutions: false } });
    const without = await tool('read_page', { item: ex.meta.id });
    expect(without.text).not.toContain('Solution, ');
    expect((await tool('read_page', { item: 'nonexistent' })).error).toBe(true);
    expect((await tool('search', { query: 'foldr' })).error).toBe(false);
    expect((await tool('read_page', {})).error).toBe(true);
  });

  it('keeps digests, which the student can delete', async () => {
    const { text } = await tool('write_digest', { title: 'Skript', content: 'Kapitel 1', resource: 'r-1' });
    const { id } = JSON.parse(text);
    await tool('write_digest', { id, title: 'Skript 2', content: 'Kapitel 1 und 2' });
    const list = JSON.parse((await tool('list_digests')).text);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Skript 2');
    expect((await app.inject({ method: 'GET', url: '/api/bridge/digests' })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/bridge/digests/${id}` })).statusCode).toBe(200);
    expect(JSON.parse((await tool('list_digests')).text)).toEqual([]);
  });

  it('is off again when the student turns it off', async () => {
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { assistantBridge: false } });
    expect((await rpc('ping')).statusCode).toBe(404);
  });
});
