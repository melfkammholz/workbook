import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/api/app.js';
import { makeDeps } from '../src/api/deps.js';
import { plainText } from '../src/content/search.js';
import { changesBus } from '../src/db/changes-bus.js';
import { hasTests } from '../src/content/loader.js';
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

const g = () => courses.global;
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
    expect([...names].sort()).toEqual(['get_context', 'get_exercise_work', 'get_progress', 'list_decks', 'list_digests', 'list_flagged_references', 'list_labels', 'list_proposals', 'list_questions', 'propose', 'propose_card', 'propose_highlight', 'propose_merge', 'propose_question', 'propose_reference', 'read_page', 'run_tests', 'search', 'write_digest']);
    expect((await rpc('nope')).json().error.code).toBe(-32601);
  });

  it('lists questions, with filters', async () => {
    const item = courses.active!.content.current.all()[0]!.meta.id;
    await app.inject({ method: 'POST', url: '/api/questions', payload: { item, text: 'Was ist foldr?' } });
    const all = JSON.parse((await tool('list_questions')).text);
    expect(all.some((q: { text: string }) => q.text === 'Was ist foldr?')).toBe(true);
    expect(JSON.parse((await tool('list_questions', { status: 'done' })).text)).toEqual([]);
    expect(JSON.parse((await tool('list_questions', { since: new Date(Date.now() + 86_400_000).toISOString() })).text)).toEqual([]);
    expect(JSON.parse((await tool('list_questions', { since: '2000-01-01T00:00:00Z' })).text)).toHaveLength(all.length);
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
    // accepting an answer does not close the question
    expect(now).toMatchObject({ kind: 'how', status: 'open', answer: 'foldr faltet von rechts.', answerBy: 'assistant' });
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
    expect(now).toMatchObject({ text: 'Wie faltet foldr eine Liste?', kind: 'check', answer: 'Von rechts.', status: 'open' });
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

  it('tells open tabs when the inbox changes', async () => {
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { assistantBridge: true } });
    const item = courses.active!.content.current.all()[0]!.meta.id;
    const made = (await app.inject({ method: 'POST', url: '/api/questions', payload: { item, text: 'Was ist zipWith?' } })).json();
    let told = 0;
    const on = () => told++;
    changesBus.on('changes', on);
    const pending = (await app.inject({ method: 'GET', url: '/api/changes' })).json().filter((c: { status: string }) => c.status === 'pending');
    await app.inject({ method: 'POST', url: '/api/changes/accept', payload: { ids: pending.slice(0, 1).map((c: { id: string }) => c.id) } });
    changesBus.off('changes', on);
    expect(made.id).toBeTruthy();
    expect(told).toBe(1);
  });

  it('shows the work on an exercise and runs only the saved code', async () => {
    const ex = courses.active!.content.current.all().find((i) => i.meta.type === 'exercise' && 'code' in i && i.code && hasTests(i.code) && i.code.language === 'haskell');
    expect(ex).toBeDefined();
    const id = ex!.meta.id;
    const code = (ex as unknown as { code: { files: Record<string, string> } }).code;
    const file = Object.keys(code.files)[0]!;
    const before = JSON.parse((await tool('get_exercise_work', { exercise: id })).text);
    expect(before.note).toContain('no code yet');
    expect(before.lastTestRun).toBe('not run yet');
    expect((await tool('run_tests', { exercise: id })).error).toBe(true); // nothing saved
    await app.inject({ method: 'PUT', url: `/api/work/${id}/answer`, payload: { slot: file, content: `${code.files[file]}\n-- mine` } });
    const work = JSON.parse((await tool('get_exercise_work', { exercise: id })).text);
    expect(work.code[file]).toContain('-- mine');
    expect(work.note).toBeUndefined();
    expect((await tool('get_exercise_work', { exercise: 'nonexistent' })).error).toBe(true);
    const run = await tool('run_tests', { exercise: id });
    expect(run.error).toBe(false);
    expect(JSON.parse(run.text)).toHaveProperty('results');
    // Running it is not an attempt of the student.
    expect(deps.store.getStats(id).checkRuns).toBe(0);
    expect(JSON.parse((await tool('get_exercise_work', { exercise: id })).text).lastTestRun).toBe('not run yet');
  });

  it('shows progress only when the student allows it', async () => {
    const id = courses.active!.content.current.all().find((i) => i.meta.type === 'exercise')!.meta.id;
    deps.store.setStatus(id, 'done');
    deps.store.addReflection(id, 4, ['alone'], '');
    const on = JSON.parse((await tool('get_progress')).text);
    expect(on.workbooks[0].done.length).toBe(1);
    expect(Object.values(on.workbooks[0].selfRating)).toEqual([4]);
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { bridgeIncludeProgress: false } });
    const off = await tool('get_progress');
    expect(off.error).toBe(true);
    expect(off.text).not.toContain('done');
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { bridgeIncludeProgress: true } });
  });

  it('offers prompts for the shipped workflows', async () => {
    expect((await rpc('initialize', {})).json().result.capabilities.prompts).toBeDefined();
    const names = (await rpc('prompts/list')).json().result.prompts.map((p: { name: string }) => p.name);
    expect(names).toEqual(['triage-questions', 'answer-recent', 'cards-from-confusion', 'draft-flashcards', 'fix-references', 'review-exercise']);
    const got = (await rpc('prompts/get', { name: 'review-exercise', arguments: { exercise: 'x1' } })).json().result;
    expect(got.messages[0].content.text).toContain('x1');
    expect((await rpc('prompts/get', { name: 'review-exercise' })).json().error.code).toBe(-32602);
    expect((await rpc('prompts/get', { name: 'nope' })).json().error.code).toBe(-32602);
  });

  it('proposes new cards, page notes and questions; accepting makes them, undo removes them', async () => {
    const ex = courses.active!.content.current.all().find((i) => i.meta.type === 'exercise')!;
    const outline = courses.active!.content.current.outline.id;
    const decide = (id: string, what: string, payload = {}) => app.inject({ method: 'POST', url: `/api/changes/${id}/${what}`, payload });
    const pending = async () => ((await app.inject({ method: 'GET', url: '/api/changes' })).json() as { id: string; field: string; status: string; ref: { kind: string; id: string }; after: any; before: any }[]).filter((c) => c.status === 'pending' && c.field === 'create');

    // the earlier tests left the inbox full
    for (const c of (await app.inject({ method: 'GET', url: '/api/changes' })).json() as { id: string; status: string }[]) if (c.status === 'pending') await decide(c.id, 'reject');
    expect((await tool('propose_card', { front: 'x', deck: 'D', item: 'no-such-item' })).error).toBe(true);
    expect((await tool('propose_card', { front: 'x', deck: 'D', item: ex.meta.id })).error).toBe(true); // no back
    expect((await tool('propose_question', { text: 'Warum?' })).error).toBe(true); // no place
    expect((await tool('propose_highlight', { resource: 'nope', page: 1, quote: 'q' })).error).toBe(true);

    // nothing exists until the student accepts
    await tool('propose_card', { front: 'Was ist `foldr`?', back: 'Eine Faltung von rechts.', deck: 'Neuer Stapel', item: ex.meta.id, reason: 'Kernbegriff' });
    await tool('propose_question', { text: 'Warum von rechts?', item: ex.meta.id });
    expect(JSON.parse((await tool('list_decks')).text)).not.toContain('Neuer Stapel');
    const [card, question] = await pending();
    expect(card!.ref).toEqual({ kind: 'card', id: '' });
    expect(card!.after).toMatchObject({ deck: { title: 'Neuer Stapel' }, cardKind: 'basic', anchor: { kind: 'exercise', course: outline, id: ex.meta.id } });

    // card: made in a new deck, with its anchor; undo takes the card and the deck it made away
    const accepted = (await decide(card!.id, 'accept', { after: { ...card!.after, front: 'Was macht `foldr`?' } })).json();
    expect(accepted).toMatchObject({ status: 'applied', ref: { kind: 'card' } });
    expect(accepted.ref.id).toBeTruthy();
    expect(accepted.before.id).toBe(accepted.ref.id);
    expect(JSON.parse((await tool('list_decks')).text)).toContain('Neuer Stapel');
    const deck = courses.flashcards.get(courses.flashcards.deckByTitle('Neuer Stapel')!.id);
    expect(deck.cards).toHaveLength(1);
    expect(deck.source).toContain('Was macht `foldr`?');
    expect(deck.cards[0]!.anchor).toMatchObject({ kind: 'exercise', id: ex.meta.id });
    expect((await decide(card!.id, 'undo')).json().status).toBe('undone');
    expect(courses.flashcards.deckByTitle('Neuer Stapel')).toBeNull();

    // question: marked as the assistant's, outside the student's passes; undo deletes it
    const q = (await decide(question!.id, 'accept')).json();
    const made = (await app.inject({ method: 'GET', url: '/api/questions' })).json().find((x: { id: string }) => x.id === q.ref.id);
    expect(made).toMatchObject({ text: 'Warum von rechts?', who: 'assistant', status: 'open' });
    await decide(question!.id, 'undo');
    expect((await app.inject({ method: 'GET', url: '/api/questions' })).json().find((x: { id: string }) => x.id === q.ref.id)).toBeUndefined();

    // a card for an existing deck, then the deck goes: the proposal is out of date
    const deckDoc = courses.flashcards.create('Alt');
    await tool('propose_card', { front: 'A', back: 'B', deck: 'Alt' });
    const [stale] = await pending();
    await decide(stale!.id, 'accept', { after: { ...stale!.after, deck: { id: deckDoc.id } } }).then((r) => expect(r.json().status).toBe('applied'));
    await decide(stale!.id, 'undo');
    expect(courses.flashcards.get(deckDoc.id).cards).toHaveLength(0); // the deck was there before: it stays
    await tool('propose_card', { front: 'A2', back: 'B2', deck: 'Alt' });
    const [gone] = await pending();
    courses.flashcards.remove(deckDoc.id);
    const bad = await decide(gone!.id, 'accept', { after: { ...gone!.after, deck: { id: deckDoc.id } } });
    expect(bad.statusCode).toBe(409);
    await decide(gone!.id, 'reject');

    // an answer and a card for one question share a group; accepting the card writes the link, undo removes it
    const qq = g().addQuestion({ text: 'Was ist foldr?', anchor: { kind: 'exercise', course: outline, id: ex.meta.id } as never });
    expect((await tool('propose_card', { question: 'nope', front: 'F', back: 'B', deck: 'Q' })).error).toBe(true);
    await tool('propose', { question: qq.id, answer: 'Eine Faltung.' });
    await tool('propose_card', { question: qq.id, front: 'F', back: 'B', deck: 'Q' });
    const group = ((await app.inject({ method: 'GET', url: '/api/changes' })).json() as { id: string; status: string; group: string; field: string }[]).filter((c) => c.status === 'pending');
    expect(new Set(group.map((c) => c.group)).size).toBe(1);
    expect(group).toHaveLength(2);
    const [qc] = await pending();
    await decide(qc!.id, 'accept');
    expect(g().getQuestion(qq.id)!.links).toMatchObject([{ kind: 'card' }]);
    await decide(qc!.id, 'undo');
    expect(g().getQuestion(qq.id)!.links).toHaveLength(0);
    const rres = (await rpc('resources/read', { uri: 'workbook://questions' })).json().result;
    expect(JSON.parse(rres.contents[0].text).find((x: { id: string }) => x.id === qq.id)).toMatchObject({ closed: false });

    // a note on a page of a material, added below what is there
    const body = Buffer.from('%PDF-1.4 notes');
    const res = (await app.inject({ method: 'POST', url: `/api/resources/upload?${new URLSearchParams({ filename: 's.pdf', title: 'S', type: 'notes' })}`, headers: { 'content-type': 'application/octet-stream' }, payload: body })).json() as { id: string };
    const filed = g().proposeCreate('assistant', 'highlight', { resource: res.id, pageIndex: 2, quote: 'wichtig', note: 'merken' });
    expect('id' in filed).toBe(true);
    const [note] = await pending();
    const done = (await decide(note!.id, 'accept')).json();
    expect(done.status).toBe('applied');
    expect(courses.resources.listPages(res.id)[0]).toMatchObject({ pageIndex: 2, note: '„wichtig“\nmerken' });
    await decide(note!.id, 'undo');
    expect(courses.resources.listPages(res.id)[0]!.note).toBe('');
  });

  it('merges duplicates: answers and labels move to the survivor, the duplicates close with a link, undo restores', async () => {
    const ask = (text: string) => g().addQuestion({ text, anchor: { kind: 'none' } }).id;
    const [a, b, c] = [ask('Was ist foldl?'), ask('Was macht foldl?'), ask('Wofuer foldl?')];
    g().updateQuestion(b, { answer: 'Faltet von links.' });
    g().updateQuestion(a, { answer: 'Eine Faltung.' });
    const lbl = (id: string, name: string) => g().propose('assistant', id, { labels: [name] });
    lbl(b, 'Faltung');
    const decide = (id: string, what: string, payload = {}) => app.inject({ method: 'POST', url: `/api/changes/${id}/${what}`, payload });
    for (const ch of (await app.inject({ method: 'GET', url: '/api/changes' })).json() as { id: string; status: string; ref: { id: string } }[]) if (ch.status === 'pending' && ch.ref.id === b) await decide(ch.id, 'accept');
    expect((await tool('propose_merge', { survivor: a, duplicates: [a] })).error).toBe(true);
    expect((await tool('propose_merge', { survivor: a, duplicates: ['nope'] })).error).toBe(true);
    // a card made from a duplicate follows to the survivor
    const deck = courses.flashcards.create('Faltungen').id;
    const card = courses.flashcards.addCard(deck, 'basic', 'Was ist foldl?', 'Eine Faltung.', null).cardId;
    expect(g().addQuestionLink(b, 'card', card)).toBe(true);
    expect((await tool('propose_merge', { survivor: a, duplicates: [b, c], text: 'Was ist foldl, und was macht es?', reason: 'gleiche Frage' })).error).toBe(false);
    const find = async (id: string) => (await app.inject({ method: 'GET', url: '/api/questions' })).json().find((x: { id: string }) => x.id === id);
    expect(await find(b)).toMatchObject({ mergedInto: null, status: 'open' });
    const merge = ((await app.inject({ method: 'GET', url: '/api/changes' })).json() as { id: string; field: string; status: string }[]).find((x) => x.field === 'merge' && x.status === 'pending')!;
    expect((await decide(merge.id, 'accept')).json().status).toBe('applied');
    expect(await find(a)).toMatchObject({ text: 'Was ist foldl, und was macht es?', answer: 'Eine Faltung.', answerBy: 'you', status: 'open' });
    expect((await find(a)).labels).toHaveLength(1);
    expect((await find(a)).links).toMatchObject([{ kind: 'card', ref: card, deck }]);
    expect((await find(b)).links).toEqual([]);
    expect(await find(b)).toMatchObject({ mergedInto: a, status: 'done' });
    expect(await find(c)).toMatchObject({ mergedInto: a, status: 'done' });
    // the survivor cannot be merged away while it survives, and a merged one cannot be merged again
    expect((await tool('propose_merge', { survivor: b, duplicates: [c] })).error).toBe(true);
    expect((await decide(merge.id, 'undo')).statusCode).toBe(200);
    expect(await find(a)).toMatchObject({ text: 'Was ist foldl?', answer: 'Eine Faltung.', labels: [] });
    expect(await find(b)).toMatchObject({ mergedInto: null, status: 'open', answer: 'Faltet von links.' });
    expect((await find(b)).links).toMatchObject([{ kind: 'card', ref: card }]);
    expect((await find(a)).links).toEqual([]);
    // reopening a merged duplicate frees it
    await tool('propose_merge', { survivor: a, duplicates: [c] });
    const again = ((await app.inject({ method: 'GET', url: '/api/changes' })).json() as { id: string; field: string; status: string }[]).find((x) => x.field === 'merge' && x.status === 'pending')!;
    await decide(again.id, 'accept');
    await app.inject({ method: 'PATCH', url: `/api/questions/${c}`, payload: { status: 'open' } });
    expect(await find(c)).toMatchObject({ mergedInto: null, status: 'open' });
    // a waiting merge goes out of date when a duplicate disappears
    await tool('propose_merge', { survivor: a, duplicates: [b] });
    g().deleteQuestion(b);
    expect(((await app.inject({ method: 'GET', url: '/api/changes' })).json() as { field: string; status: string }[]).filter((x) => x.field === 'merge' && x.status === 'pending')).toHaveLength(0);
  });

  it('writes an answer and links over the API', async () => {
    const q = g().addQuestion({ text: 'Was ist eine Faltung?', anchor: { kind: 'none' } });
    const patch = await app.inject({ method: 'PATCH', url: `/api/questions/${q.id}`, payload: { answer: 'Ein *Reduktionsmuster*.' } });
    expect(patch.json()).toMatchObject({ answer: 'Ein *Reduktionsmuster*.', answerBy: 'you', status: 'open', links: [] });
    const deck = courses.flashcards.create('Fragen').id;
    const card = courses.flashcards.addCard(deck, 'basic', 'F', 'B', null).cardId;
    expect((await app.inject({ method: 'POST', url: `/api/questions/${q.id}/links`, payload: { kind: 'card', ref: 'nope' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/questions/${q.id}/links`, payload: { kind: 'x', ref: card } })).statusCode).toBe(400);
    const linked = await app.inject({ method: 'POST', url: `/api/questions/${q.id}/links`, payload: { kind: 'card', ref: card } });
    expect(linked.json().links).toMatchObject([{ kind: 'card', ref: card, deck }]);
    const gone = await app.inject({ method: 'DELETE', url: `/api/questions/${q.id}/links?kind=card&ref=${card}` });
    expect(gone.json().links).toEqual([]);
    expect((await app.inject({ method: 'DELETE', url: `/api/questions/${q.id}/links?kind=card&ref=${card}` })).statusCode).toBe(404);
    g().deleteQuestion(q.id);
  });

  it('fixes flagged references: only unsure ones, accept writes the fields, undo restores, a lookup makes it stale', async () => {
    g().sql.run("INSERT INTO works (id, title, raw, created_at, updated_at) VALUES ('wf1', '', 'Wadler, P. Theorems for free! FPCA 1989, 347 359', 1, 1)");
    g().sql.run("INSERT INTO works (id, title, raw, created_at, updated_at) VALUES ('wf2', '', 'Garbage entry', 1, 1)");
    g().sql.run("INSERT INTO works (id, title, authors, year, venue, raw, imported, created_at, updated_at) VALUES ('wok', 'Fine', 'A B', 2000, 'V', 'Fine', 1, 1, 1)");
    const decide = (id: string, what: string, payload = {}) => app.inject({ method: 'POST', url: `/api/changes/${id}/${what}`, payload });
    const work = (id: string) => g().sql.get('SELECT * FROM works WHERE id = ?', id)!;
    const waiting = async () => ((await app.inject({ method: 'GET', url: '/api/changes' })).json() as { id: string; field: string; status: string }[]).filter((c) => c.field === 'work' && c.status === 'pending');
    for (const c of (await app.inject({ method: 'GET', url: '/api/changes' })).json() as { id: string; status: string }[]) if (c.status === 'pending') await decide(c.id, 'reject');

    const ids = async () => (JSON.parse((await tool('list_flagged_references')).text) as { id: string }[]).map((f) => f.id);
    expect(await ids()).toEqual(expect.arrayContaining(['wf1', 'wf2']));
    expect(await ids()).not.toContain('wok');
    expect((await tool('propose_reference', { reference: 'wok', title: 'X' })).error).toBe(true);
    expect((await tool('propose_reference', { reference: 'nope', title: 'X' })).error).toBe(true);
    expect((await tool('propose_reference', { reference: 'wf1', title: 'X', year: 5 })).error).toBe(true);

    expect((await tool('propose_reference', { reference: 'wf1', title: 'Theorems for free!', authors: 'Philip Wadler', year: 1989, venue: 'FPCA', reason: 'aus dem Text' })).error).toBe(false);
    expect(work('wf1')).toMatchObject({ title: '' }); // nothing changes yet
    expect(await ids()).not.toContain('wf1');
    const [p] = await waiting();
    expect((await decide(p!.id, 'accept', { after: { title: 'Theorems for free!', authors: 'Philip Wadler', year: 1989, venue: 'FPCA 1989' } })).json().status).toBe('applied');
    expect(work('wf1')).toMatchObject({ title: 'Theorems for free!', authors: 'Philip Wadler', year: 1989, venue: 'FPCA 1989', confidence: 1 });
    expect((await decide(p!.id, 'undo')).statusCode).toBe(200);
    expect(work('wf1')).toMatchObject({ title: '', authors: '', year: null, confidence: -1, updated_at: 1 });

    // rejected: the assistant sees why
    await tool('propose_reference', { reference: 'wf2', title: 'Garbage' });
    await decide((await waiting())[0]!.id, 'reject', { feedback: 'unleserlich' });
    expect(JSON.parse((await tool('list_proposals', { status: 'rejected' })).text)[0]).toMatchObject({ reference: 'wf2', field: 'work', studentSaid: 'unleserlich' });

    // a waiting proposal goes out of date when the entry is no longer unsure
    await tool('propose_reference', { reference: 'wf2', title: 'Garbage' });
    g().sql.run("UPDATE works SET confidence = 1 WHERE id = 'wf2'");
    expect(await waiting()).toHaveLength(0);
  });

  it('is off again when the student turns it off', async () => {
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { assistantBridge: false } });
    expect((await rpc('ping')).statusCode).toBe(404);
  });
});
