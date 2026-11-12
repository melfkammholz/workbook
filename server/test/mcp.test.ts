import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/api/app.js';
import { makeDeps } from '../src/api/deps.js';
import { plainText } from '../src/content/search.js';
import { loadConfig } from '../src/config.js';
import { CourseManager } from '../src/courses/manager.js';
import { SessionPool } from '../src/runners/pool.js';
import { EXAMPLE_CONTENT, HASKELL_LIB, PROLOG_LIB } from './helpers.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let courses: CourseManager;
let token = '';
let deps: ReturnType<typeof makeDeps>;

beforeAll(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mcp-'));
  const config = { ...loadConfig({ CONTENT_DIR: EXAMPLE_CONTENT, DATA_DIR: dataDir } as NodeJS.ProcessEnv), port: 0 };
  courses = new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst') });
  deps = makeDeps({ config, courses, pool: new SessionPool(1, 60_000), haskellLib: HASKELL_LIB, prologLib: PROLOG_LIB });
  app = await buildApp(deps);
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
    expect([...names].sort()).toEqual(['get_context', 'list_digests', 'list_labels', 'list_proposals', 'list_questions', 'propose', 'read_page', 'search', 'write_digest']);
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

  it('marks where a question was asked, and follows the solutions setting', async () => {
    const item = courses.active!.content.current.all().find((i) => i.meta.type === 'exercise' && 'code' in i && i.code?.solution)!;
    const quote = plainText(item.typst).split(' ').slice(2, 5).join(' ');
    const whole = deps.store.addQuestion({ text: 'ganz', anchor: { kind: 'exercise', course: deps.store.course, id: item.meta.id } });
    const at = deps.store.addQuestion({ text: 'hier', anchor: { kind: 'text', course: deps.store.course, target: item.meta.id, part: 'x', quote, prefix: '', suffix: '' } });
    for (const full of [true, false]) {
      await app.inject({ method: 'PUT', url: '/api/settings', payload: { bridgeIncludeSolutions: full } });
      const a = JSON.parse((await tool('get_context', { question: at.id })).text).item as string;
      expect(a).toContain('⟦the student asked their question here⟧');
      expect(a).toContain(full ? 'Included: hints, author notes and solutions' : 'are left out');
      expect(a.includes('Solution, ')).toBe(full);
      expect(JSON.parse((await tool('get_context', { question: whole.id })).text).item).toContain('whole item');
    }
  });

  it('says plainly when the text of a page is not read yet', async () => {
    const q = deps.store.addQuestion({ text: 'S', anchor: { kind: 'page', resource: 'r-none', version: 'v', pageIndex: 2, fingerprint: 'f' } });
    const out = JSON.parse((await tool('get_context', { question: q.id })).text);
    expect(out.pages).toEqual({});
    expect(out.note).toContain('not been read yet');
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

  it('proposes, and nothing changes until the student accepts', async () => {
    const q = JSON.parse((await tool('list_questions')).text)[0];
    expect((await tool('propose', { question: q.id, type: 'nonsense' })).error).toBe(true);
    expect((await tool('propose', { question: 'nope', type: 'why' })).error).toBe(true);
    const filed = await tool('propose', { question: q.id, type: 'concept', labels: ['Faltung'], answer: 'foldr faltet von rechts.', reason: 'Begriff' });
    expect(JSON.parse(filed.text).filed).toBe(3);
    expect(JSON.parse((await tool('list_questions')).text)[0]).toMatchObject({ type: null, labels: [], answer: null });
    // a new proposal for the same field replaces the waiting one
    await tool('propose', { question: q.id, type: 'why' });
    const changes = (await app.inject({ method: 'GET', url: '/api/changes' })).json() as { id: string; field: string; status: string; after: unknown }[];
    const pending = changes.filter((c) => c.status === 'pending');
    expect(pending).toHaveLength(3);
    const kind = pending.find((c) => c.field === 'kind')!;
    expect(kind.after).toBe('why');
    const decide = (id: string, what: string, payload = {}) => app.inject({ method: 'POST', url: `/api/changes/${id}/${what}`, payload });
    expect((await decide(kind.id, 'accept', { after: 'how', feedback: 'eher wie' })).json()).toMatchObject({ status: 'applied', after: 'how', feedback: 'eher wie' });
    const labels = pending.find((c) => c.field === 'labels')!;
    await decide(labels.id, 'accept');
    const answer = pending.find((c) => c.field === 'answer')!;
    await decide(answer.id, 'accept');
    expect((await decide(answer.id, 'accept')).statusCode).toBe(409);
    const now = (await app.inject({ method: 'GET', url: '/api/questions' })).json().find((x: { id: string }) => x.id === q.id);
    expect(now).toMatchObject({ kind: 'how', status: 'done', answer: 'foldr faltet von rechts.' });
    expect(now.labels).toHaveLength(1);
    expect(JSON.parse((await tool('list_labels')).text)).toContain('Faltung');
    // undo puts back what was there
    await decide(answer.id, 'undo');
    await decide(kind.id, 'undo');
    const undone = (await app.inject({ method: 'GET', url: '/api/questions' })).json().find((x: { id: string }) => x.id === q.id);
    expect(undone).toMatchObject({ kind: null, status: 'open', answer: null });
    // rejected proposals stay visible to the assistant, with what the student said
    await tool('propose', { question: q.id, type: 'example' });
    const next = (await app.inject({ method: 'GET', url: '/api/changes' })).json().find((c: { status: string }) => c.status === 'pending');
    await decide(next.id, 'reject', { feedback: 'kein Beispiel' });
    const mine = JSON.parse((await tool('list_proposals', { status: 'rejected' })).text);
    expect(mine[0]).toMatchObject({ field: 'kind', after: 'example', studentSaid: 'kein Beispiel' });
  });

  it('rewrites a question and accepts and undoes several proposals as one batch', async () => {
    const q = JSON.parse((await tool('list_questions')).text)[0];
    const before = (await app.inject({ method: 'GET', url: '/api/questions' })).json().find((x: { id: string }) => x.id === q.id);
    const filed = await tool('propose', { question: q.id, type: 'check', text: 'Wie faltet foldr eine Liste?', answer: 'Von rechts.' });
    expect(JSON.parse(filed.text).filed).toBe(3);
    const pending = ((await app.inject({ method: 'GET', url: '/api/changes' })).json() as { id: string; field: string; status: string; before: unknown }[]).filter((c) => c.status === 'pending');
    expect(pending.find((c) => c.field === 'text')!.before).toBe(before.text);
    const ids = pending.map((c) => c.id);
    const accepted = (await app.inject({ method: 'POST', url: '/api/changes/accept', payload: { ids } })).json() as { batch: string; changes: { status: string }[] };
    expect(accepted.changes.every((c) => c.status === 'applied')).toBe(true);
    const now = (await app.inject({ method: 'GET', url: '/api/questions' })).json().find((x: { id: string }) => x.id === q.id);
    expect(now).toMatchObject({ text: 'Wie faltet foldr eine Liste?', kind: 'check', answer: 'Von rechts.', status: 'done' });
    // accepting again fails and changes nothing
    expect((await app.inject({ method: 'POST', url: '/api/changes/accept', payload: { ids } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/changes/batch/${accepted.batch}/undo` })).statusCode).toBe(200);
    const undone = (await app.inject({ method: 'GET', url: '/api/questions' })).json().find((x: { id: string }) => x.id === q.id);
    expect(undone).toMatchObject({ text: before.text, kind: before.kind, answer: before.answer, status: before.status });
    expect((await app.inject({ method: 'POST', url: `/api/changes/batch/${accepted.batch}/undo` })).statusCode).toBe(409);
  });

  it('expires an answer proposal when the question was edited, and caps the inbox', async () => {
    const q = JSON.parse((await tool('list_questions')).text)[0];
    await tool('propose', { question: q.id, answer: 'Antwort' });
    await app.inject({ method: 'PATCH', url: `/api/questions/${q.id}`, payload: { text: 'Was ist foldl?' } });
    const changes = (await app.inject({ method: 'GET', url: '/api/changes' })).json() as { field: string; status: string }[];
    expect(changes.find((c) => c.field === 'answer' && c.status === 'pending')).toBeUndefined();
    expect(changes.some((c) => c.field === 'answer' && c.status === 'expired')).toBe(true);
    const item = courses.active!.content.current.all()[0]!.meta.id;
    for (let i = 0; i < 100; i++) {
      const made = (await app.inject({ method: 'POST', url: '/api/questions', payload: { item, text: `Frage ${i}` } })).json();
      await tool('propose', { question: made.id, type: 'how' });
    }
    const made = (await app.inject({ method: 'POST', url: '/api/questions', payload: { item, text: 'Eine zu viel' } })).json();
    const full = await tool('propose', { question: made.id, type: 'how' });
    expect(full.error).toBe(true);
    expect(full.text).toContain('inbox full');
  });

  it('is off again when the student turns it off', async () => {
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { assistantBridge: false } });
    expect((await rpc('ping')).statusCode).toBe(404);
  });
});
