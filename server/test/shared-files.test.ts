import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { CheckRun, ItemDetail, Outline, ReplServerMessage, ReviewData, StudentState } from '@wb/shared';
import { buildApp } from '../src/api/app.js';
import { makeDeps } from '../src/api/deps.js';
import { loadConfig } from '../src/config.js';
import { solutionBlocks } from '../src/content/cpp.js';
import { loadContent } from '../src/content/loader.js';
import { CourseManager } from '../src/courses/manager.js';
import { PrologSession } from '../src/runners/prolog.js';
import { runChecks } from '../src/runners/checks.js';
import { SessionPool } from '../src/runners/pool.js';
import { EXAMPLE_CONTENT, HASKELL_LIB, PROLOG_LIB, hasBinary } from './helpers.js';

const typstBin = process.env.TYPST_BIN ?? 'typst';
const example = loadContent(EXAMPLE_CONTENT);

describe('exercises of an adventure in a chapter', () => {
  const course = (section: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-section-'));
    const files: Record<string, string> = {
      'workbook.yml': 'title: Kurs\nchapters: [01-a]\n',
      'threads/route.yml': 'title: Die Route\npage: route.typ\nsteps: [one]\n',
      'threads/route.typ': 'Text.\n',
      'chapters/01-a/chapter.yml': `title: A\nitems:\n  - section: ${section}\n  - id: one\n    title: Eins\n`,
      'chapters/01-a/one.typ': 'Aufgabe.\n',
    };
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), text);
    }
    return loadContent(dir).outline.problems.filter((x) => x.severity === 'warning').map((x) => x.message);
  };

  it('stand in a section with its name', () => {
    expect(course('Die Route')).toEqual([]);
    expect(course('Etwas anderes').join()).toContain('belongs to "Die Route"');
  });
});

describe('solutionBlocks', () => {
  it('finds which part belongs to which exercise, and skips what nobody is named on', () => {
    const source = ['a', '#ifdef TEMPLATE one two', 'stub', '#else', 'sol 1', '#endif', '#ifdef TEMPLATE', 'stub', '#else', 'secret', '#endif', '#ifndef TEMPLATE three', 'sol 3', '#else', 'stub', '#endif'].join('\n');
    expect(solutionBlocks(source)).toEqual([
      { exercises: ['one', 'two'], text: 'sol 1' },
      { exercises: ['three'], text: 'sol 3' },
    ]);
  });

  it('keeps conditionals inside a part apart from its own #else', () => {
    const source = ['#ifdef TEMPLATE one', 'stub', '#else', '#ifdef OTHER', 'x', '#else', 'y', '#endif', 'z', '#endif'].join('\n');
    expect(solutionBlocks(source)[0]!.text).toContain('z');
  });
});

describe('content: shared files', () => {
  const course = (files: Record<string, string>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-course-'));
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), text);
    }
    return loadContent(dir);
  };
  const errors = (c: ReturnType<typeof loadContent>) => c.outline.problems.filter((p) => p.severity === 'error').map((p) => p.message).join('\n');

  it('gives every exercise of a thread the same files, starting from the template', () => {
    const a = example.exercise('rechner-auswerten')!.code!;
    const b = example.exercise('rechner-anzeigen')!.code!;
    expect(Object.keys(a.files)).toEqual(['Expr.hs', 'Pretty.hs']);
    expect(b.files).toEqual(a.files);
    expect(a.shared).toBe('taschenrechner');
    expect(a.files['Expr.hs']).toContain('eval = undefined');
    expect(a.files['Expr.hs']).not.toContain('#ifdef');
    expect(a.files['Expr.hs']).not.toContain('eval (Num n)');
  });

  it('reveals only what the author assigned to that exercise', () => {
    const a = example.exercise('rechner-auswerten')!.code!;
    expect(a.reveal['Expr.hs']).toContain('eval (Num n) = n');
    expect(a.reveal['Expr.hs']).not.toContain('simplify');
    expect(a.reveal).not.toHaveProperty('Pretty.hs');
    expect(example.exercise('rechner-anzeigen')!.code!.reveal).toEqual({ 'Pretty.hs': expect.stringContaining('paren') });
    // The tools still see all of it, to verify the tests.
    expect(a.fullSolution['Expr.hs']).toContain('simplify (Add a b)');
  });

  it('tells the browser which of the shared files an exercise works in', () => {
    expect(example.exercise('rechner-auswerten')!.meta.code!.edits).toEqual(['Expr.hs']);
    expect(example.exercise('rechner-anzeigen')!.meta.code!.edits).toEqual(['Pretty.hs']);
    expect(example.exercise('binary-exponentiation')!.meta.code!.edits).toEqual(['BinaryExponentiation.hs']);
  });

  it('marks a thread with a page as an adventure, and leaves others as paths', () => {
    const byId = new Map(example.outline.threads.map((t) => [t.id, t]));
    expect(byId.get('taschenrechner')!.adventure).toBe(true);
    expect(byId.get('rekursion')!.adventure).toBe(false);
    expect(example.doc('thread/taschenrechner')).toBeDefined();
  });

  it('keeps the finale of an adventure, and reports one that is not a step', () => {
    expect(example.outline.threads.find((t) => t.id === 'taschenrechner')!.finale).toBe('rechner-anzeigen');
    const c = course({
      'threads/t.yml': 'title: T\nsteps: [a]\nfinale: b\n',
      'chapters/c/chapter.yml': 'title: C\nitems:\n  - id: a\n  - id: b\n',
      'chapters/c/a.typ': 'Text',
      'chapters/c/b.typ': 'Text',
    });
    expect(errors(c)).toContain('finale: "b" is not one of the steps');
    expect(c.outline.threads[0]!.finale).toBeNull();
  });

  it('leaves exercises outside shared files as they were', () => {
    const code = example.exercise('binary-exponentiation')!.code!;
    expect(code.shared).toBeNull();
    expect(Object.keys(code.files)).toEqual(['BinaryExponentiation.hs']);
    expect(code.reveal).toEqual(code.fullSolution);
  });

  it('reports a solution part naming an exercise that does not use the files', () => {
    const c = course({
      'threads/t.yml': 'title: T\nsteps: [a]\nfiles: [F.hs]\n',
      'threads/F.hs': 'module F where\n#ifdef TEMPLATE nobody\nx = 1\n#else\nx = 2\n#endif\n',
      'chapters/c/chapter.yml': 'title: C\nitems:\n  - id: a\n    code: { shared: t }\n',
      'chapters/c/a.typ': 'Text',
    });
    expect(errors(c)).toContain('#ifdef TEMPLATE nobody');
  });

  it('reports an exercise asking for files that do not exist, and "file" next to "shared"', () => {
    const missing = course({ 'chapters/c/chapter.yml': 'title: C\nitems:\n  - id: a\n    code: { shared: nope }\n', 'chapters/c/a.typ': 'Text' });
    expect(errors(missing)).toContain('no thread "nope"');
    const both = course({
      'threads/t.yml': 'title: T\nsteps: [a]\nfiles: [F.hs]\n',
      'threads/F.hs': 'module F where\n',
      'chapters/c/chapter.yml': 'title: C\nitems:\n  - id: a\n    code: { shared: t, file: G.hs }\n',
      'chapters/c/a.typ': 'Text',
      'chapters/c/G.hs': '',
    });
    expect(errors(both)).toContain('do not go with "shared"');
  });

  it('reports missing texts for the landing page, a chapter and a checklist, without breaking the course', () => {
    const c = course({
      'workbook.yml': 'title: X\nlanding: nope.typ\n',
      'chapters/c/chapter.yml': 'title: C\nintro: nope.typ\nitems:\n  - checklist: q\n  - id: a\n',
      'chapters/c/a.typ': 'Text',
    });
    const text = errors(c);
    expect(text).toContain('landing page');
    expect(text).toContain('introduction of chapter');
    expect(text).toContain('checklist "q"');
    expect(c.outline.landing).toBe(false);
    expect(c.exercise('a')).toBeDefined();
  });

  it('warns about a checklist without questions, places checklists in order, and reads tag descriptions', () => {
    const c = course({
      'tags.yml': 'hard: { label: Hart, description: Nur für Mutige. }\n',
      'chapters/c/chapter.yml': 'title: C\nitems:\n  - section: S\n  - id: a\n    tags: [hard]\n  - checklist: q\n  - section: T\n  - id: b\n  - checklist: r\n',
      'chapters/c/a.typ': 'Text',
      'chapters/c/b.typ': 'Text',
      'chapters/c/q.typ': 'Nur Text.',
      'chapters/c/r.typ': '#question[Alles klar?]',
    });
    expect(c.outline.problems.map((p) => p.message).join()).toContain('has no #question');
    const items = c.outline.chapters[0]!.items;
    expect(items.map((i) => i.type)).toEqual(['exercise', 'checklist', 'exercise', 'checklist']);
    // One after a section belongs to it, the one that ends the chapter to none.
    expect(items[1]!.sectionId).toBe(items[0]!.sectionId);
    expect(items[2]!.sectionId).not.toBe(items[0]!.sectionId);
    expect(items[3]!.sectionId).toBeNull();
    expect(items[1]!.title).toBe('Self-evaluation');
    expect(c.outline.tags[0]!.description).toBe('Nur für Mutige.');
    expect(c.outline.chapters[0]!.items.filter((i) => i.type === 'exercise')).toHaveLength(2);
  });
});

describe.skipIf(!hasBinary(typstBin))('API: new course pages and shared work', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let courses: CourseManager;
  let base: string;
  const api = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`http://${base}${url}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: res.status, json: (await res.json()) as never };
  };

  beforeAll(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-shared-'));
    const config = { ...loadConfig({ CONTENT_DIR: EXAMPLE_CONTENT, DATA_DIR: dataDir, TYPST_BIN: typstBin } as NodeJS.ProcessEnv), port: 0 };
    courses = new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst') });
    app = await buildApp(makeDeps({ config, courses, pool: new SessionPool(2, 60_000), haskellLib: HASKELL_LIB, prologLib: PROLOG_LIB }));
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app.close();
    courses.close();
  });

  it('carries work in a shared file over to the next exercise, and only there', async () => {
    await api('PUT', '/api/work/rechner-auswerten/answer', { slot: 'Expr.hs', content: 'module Expr where -- meins', reason: 'run' });
    const next = (await api('GET', '/api/work/rechner-anzeigen')).json as { answers: Record<string, string> };
    expect(next.answers['Expr.hs']).toContain('-- meins');
    const other = (await api('GET', '/api/work/binary-exponentiation')).json as { answers: Record<string, string> };
    expect(other.answers).toEqual({});
    const versions = (await api('GET', '/api/work/rechner-anzeigen/versions?slot=Expr.hs')).json as { content: string }[];
    expect(versions.at(-1)!.content).toContain('-- meins');
  });

  it('keeps status per exercise, even with shared files', async () => {
    const { state } = (await api('GET', '/api/state')).json as { state: StudentState };
    expect(state.progress['rechner-auswerten']?.status).toBe('in_progress');
    expect(state.progress['rechner-anzeigen']).toBeUndefined();
  });

  it('finds shared work in search, linked to an exercise', async () => {
    const { mine } = (await api('GET', '/api/search?q=meins')).json as { mine: { exerciseId: string }[] };
    expect(mine[0]!.exerciseId).toMatch(/^rechner-/);
  });

  it('shows only that exercise its part of the solution, and records who looked', async () => {
    const r = (await api('POST', '/api/work/rechner-vereinfachen/solution')).json as { files: Record<string, string> };
    expect(r.files['Expr.hs']).toContain('simplify (Add a b)');
    expect(JSON.stringify(r.files)).not.toContain('eval (Num n)');
    expect(JSON.stringify(r.files)).not.toContain('paren');
    const { state } = (await api('GET', '/api/state')).json as { state: StudentState };
    expect(state.stats['rechner-vereinfachen']?.solutionViewedAt).toBeTypeOf('number');
    expect(state.stats['rechner-auswerten']?.solutionViewedAt ?? null).toBeNull();
  });

  it('needs every file for a test run', async () => {
    const r = await api('POST', '/api/work/rechner-auswerten/check', { files: { 'Expr.hs': 'x' } });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json)).toContain('Pretty.hs');
  });

  it.skipIf(!hasBinary('runghc'))('runs tests over several files that import each other', async () => {
    const { fullSolution } = courses.active!.content.current.exercise('rechner-anzeigen')!.code!;
    const r = (await api('POST', '/api/work/rechner-anzeigen/check', { files: fullSolution })).json as CheckRun;
    expect(r.compiled).toBe(true);
    expect(r.results.map((x) => x.status)).toEqual(['pass', 'pass']);
  });

  it.skipIf(!hasBinary('ghci'))('puts all shared modules in scope, including what they do not export', async () => {
    const ws = new WebSocket(`ws://${base}/ws/repl/rechner-anzeigen`);
    const inbox: ReplServerMessage[] = [];
    ws.on('message', (m) => inbox.push(JSON.parse(m.toString()) as ReplServerMessage));
    const until = async (done: () => boolean) => {
      for (let i = 0; i < 600 && !done(); i++) await new Promise((r) => setTimeout(r, 25));
      if (!done()) throw new Error(`timed out; got ${JSON.stringify(inbox)}`);
    };
    const out = () => inbox.flatMap((m) => (m.type === 'output' ? [m.text] : [])).join('');
    await until(() => inbox.some((m) => m.type === 'ready'));
    const { fullSolution } = courses.active!.content.current.exercise('rechner-anzeigen')!.code!;
    const files = { ...fullSolution, 'Expr.hs': `${fullSolution['Expr.hs']}\nhiddenHelper :: Int\nhiddenHelper = 41\n`, 'Evil.hs': 'module Evil where' };
    ws.send(JSON.stringify({ type: 'load', files }));
    await until(() => inbox.some((m) => m.type === 'loaded'));
    expect(inbox.find((m) => m.type === 'loaded')).toMatchObject({ ok: true });
    ws.send(JSON.stringify({ type: 'input', text: 'pretty (Add (Num 1) (Num hiddenHelper))' }));
    await until(() => out().includes('1 + 41'));
    const closed = new Promise((r) => ws.once('close', r));
    ws.close();
    await closed;
  });

  it('serves the landing page once as new, and the other course texts', async () => {
    const outline = (await api('GET', '/api/outline')).json as Outline;
    expect(outline.landing).toBe(true);
    expect((await api('GET', '/api/landing')).json).toMatchObject({ task: expect.stringContaining('Willkommen') });
    expect(((await api('GET', '/api/state')).json as { state: StudentState }).state.landingSeen).toBe(false);
    await api('POST', '/api/landing/seen');
    expect(((await api('GET', '/api/state')).json as { state: StudentState }).state.landingSeen).toBe(true);
    expect((await api('GET', '/api/chapters/typklassen/intro')).json).toMatchObject({ task: expect.stringContaining('Typklassen') });
    expect((await api('GET', '/api/threads/taschenrechner/page')).status).toBe(200);
    expect((await api('GET', '/api/threads/rekursion/page')).status).toBe(404);
    expect((await api('GET', '/api/chapters/nope/intro')).status).toBe(404);
  });

  it('keeps checklist answers, shows them for review, and removes them when cleared', async () => {
    const id = 'selbstevaluation-typklassen';
    const { rendered, meta } = (await api('GET', `/api/items/${id}`)).json as ItemDetail;
    expect(meta.type).toBe('checklist');
    expect(rendered.questions).toHaveLength(3);
    expect(rendered.questions[0]!.html).toContain('Typklassen');
    const q = rendered.questions[0]!.id;

    expect((await api('PUT', `/api/checklists/${id}/${q}`, { confidence: 2, note: 'Noch unklar' })).status).toBe(200);
    const { state } = (await api('GET', '/api/state')).json as { state: StudentState };
    expect(state.checklists[id]![q]).toMatchObject({ confidence: 2, note: 'Noch unklar' });
    const review = (await api('GET', '/api/review')).json as ReviewData;
    expect(review.checklists).toEqual([expect.objectContaining({ checklistId: id, title: 'Selbstevaluation', answer: expect.objectContaining({ confidence: 2 }) })]);
    expect(review.checklists[0]!.question.html).toContain('Typklassen');

    // A rating is enough; a note alone is too.
    await api('PUT', `/api/checklists/${id}/${q}`, { confidence: null, note: 'Nur Text' });
    await api('PUT', `/api/checklists/${id}/${q}`, { confidence: null, note: '' });
    expect(((await api('GET', '/api/state')).json as { state: StudentState }).state.checklists[id]).toBeUndefined();

    expect((await api('PUT', `/api/checklists/${id}/${q}`, { confidence: 9, note: '' })).status).toBe(400);
    expect((await api('PUT', `/api/checklists/rechner-auswerten/${q}`, { confidence: 1, note: '' })).status).toBe(404);
  });
});

describe.skipIf(!hasBinary('swipl'))('Prolog with several files', () => {
  const code = (check: string | null) => ({
    language: 'prolog',
    runnable: true,
    options: [],
    studentPath: 'a.pl',
    starter: '',
    solution: null,
    files: { 'a.pl': '', 'b.pl': '' },
    fullSolution: {},
    reveal: {},
    shared: 't',
    check,
    support: {},
  });

  it('runs tests over all of them', async () => {
    const r = await runChecks({
      runghcBin: 'runghc',
      swiplBin: 'swipl',
      haskellLib: HASKELL_LIB,
      prologLib: PROLOG_LIB,
      workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wb-pl-')),
      code: code('check("beide", holds(user:gross(1))).\n'),
      files: { 'a.pl': 'klein(1).\n', 'b.pl': 'gross(X) :- klein(X).\n' },
    });
    expect(r.runnerError).toBeNull();
    expect(r.results.map((x) => x.status)).toEqual(['pass']);
  });

  it('loads all of them in the interpreter and reports problems per file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-pl-'));
    const s = new PrologSession({ bin: 'swipl', dir, libDir: PROLOG_LIB, targets: ['a.pl', 'b.pl'] }).start();
    try {
      await s.ready;
      expect((await s.load({ 'a.pl': 'klein(1).\n', 'b.pl': 'gross(X) :- klein(X).\n' })).ok).toBe(true);
      const bad = await s.load({ 'a.pl': 'klein(1).\n', 'b.pl': 'gross(X :- klein(X).\n' });
      expect(bad.ok).toBe(false);
      expect(bad.diagnostics[0]!.file).toBe('b.pl');
    } finally {
      s.kill();
    }
  });
});
