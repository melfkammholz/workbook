import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ReplServerMessage } from '@wb/shared';
import { commonLines } from '../../web/src/lib/diff.js';
import { adventureOfSection } from '../../web/src/lib/sections.js';
import { confidenceRows } from '../../web/src/lib/confidence.js';
import { buildApp } from '../src/api/app.js';
import { loadContent } from '../src/content/loader.js';
import { makeDeps } from '../src/api/deps.js';
import { loadConfig } from '../src/config.js';
import { fold, plainText, snippetOf } from '../src/content/search.js';
import { CourseManager } from '../src/courses/manager.js';
import { GhciSession, firstParagraph } from '../src/runners/ghci.js';
import { SessionPool } from '../src/runners/pool.js';
import { EXAMPLE_CONTENT, HASKELL_LIB, PROLOG_LIB, hasBinary } from './helpers.js';

describe('plainText', () => {
  it('keeps the words and drops the markup', () => {
    expect(plainText('Nutze *foldr* und `map`.\n\n#remark[Siehe #link("https://x.org")[hier]]')).toBe('Nutze foldr und map . Siehe hier');
    expect(plainText('#import "/x.typ": *\n// Kommentar\nText')).toBe('Text');
  });

  it('leaves formulas out, since their source means nothing to a reader', () => {
    const text = plainText('Mit $cal(O)(log n)$ Multiplikationen, das kostet 5\\$ pro $x^2$ Stück.');
    expect(text).not.toContain('cal(O)');
    expect(text).not.toContain('x^2');
    expect(text).toContain('Multiplikationen');
    expect(text).toContain('Stück');
  });

  it('never contains hints or author notes, however nested', () => {
    const text = plainText('Aufgabe. #hint[Nimm [eine [Schleife]] hier] Mitte. #draft-note[geheim [sehr]] Ende.');
    expect(text).toBe('Aufgabe. Mitte. Ende.');
  });
});

describe('fold and snippetOf', () => {
  it('finds words regardless of case and accents, and keeps positions', () => {
    expect(fold('Rückgabe')).toBe('ruckgabe');
    expect(fold('Straße').length).toBe('Straße'.length);
    expect(snippetOf('Die Rückgabe ist gut', ['ruckgabe'])).toBe('Die «Rückgabe» ist gut');
    expect(snippetOf('nichts', ['foldr'])).toBeNull();
  });

  it('shortens long texts around the word', () => {
    const s = snippetOf(`${'a '.repeat(100)}foldr${' b'.repeat(100)}`, ['foldr'])!;
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('«foldr»');
    expect(s.length).toBeLessThan(160);
  });
});

describe('firstParagraph', () => {
  it('takes the opening paragraph of what :doc prints, without Haddock markup', () => {
    const out = "map :: (a -> b) -> [a] -> [b]\n  \t-- Identifier defined in ‘Base’\n-- | \\(\\mathcal{O}(n)\\). 'map' @f xs@ is the list\n-- of results.\n--\n-- > map f [x1] == [f x1]\n";
    expect(firstParagraph(out)).toBe('O(n). map f xs is the list of results.');
  });

  it('has nothing to say for names without documentation', () => {
    expect(firstParagraph('<has no documentation>\n')).toBeNull();
    expect(firstParagraph("<interactive>:1:1: error: [GHC-76037] Not in scope: ‘x’")).toBeNull();
  });

  it('does not end on words that lead into an example it leaves out', () => {
    expect(firstParagraph('-- | applies f to each element of xs, i.e.,\n--\n-- > map f xs')).toBe('applies f to each element of xs…');
    expect(firstParagraph('-- | Example:\n--\n-- > x')).toBe('Example…');
    expect(firstParagraph('-- | Ends properly.')).toBe('Ends properly.');
  });

  it('keeps long documentation short', () => {
    const long = firstParagraph(`-- | ${'wort '.repeat(200)}\n`)!;
    expect(long.length).toBeLessThan(370);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('commonLines', () => {
  it('marks what two texts share, in order, ignoring trailing spaces', () => {
    expect(commonLines('a\nb  \nc', 'a\nb\nx\nc')).toEqual({ a: [true, true, true], b: [true, true, false, true] });
    expect(commonLines('a\nb', 'b\na').a.filter(Boolean)).toHaveLength(1);
  });

  it('does not count lining things up differently as a difference', () => {
    expect(commonLines('even n = 1\n  x', 'even n    =   1\nx')).toEqual({ a: [true, true], b: [true, true] });
  });

  it('gives up on texts too long to compare, instead of freezing', () => {
    const long = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join('\n');
    expect(commonLines(long, long)).toBeNull();
  });
});

describe.skipIf(!hasBinary('ghci'))('GhciSession.typeAt', () => {
  const start = async (files: Record<string, string>) => {
    const s = new GhciSession({ bin: 'ghci', dir: fs.mkdtempSync(path.join(os.tmpdir(), 'wb-type-')), libDir: HASKELL_LIB, options: [], targets: Object.keys(files) }).start();
    await s.ready;
    return s;
  };

  it('answers for names and operators, and with the type used at that place', async () => {
    const files = { 'A.hs': 'module A (f) where\n\nf :: Int -> [Int] -> Int\nf x ys = foldr (+) x ys + 1\n' };
    const s = await start(files);
    try {
      expect((await s.load(files)).ok).toBe(true);
      expect((await s.typeAt('A.hs', 4, 1, 4, 2, 'f'))!.type).toBe('Int -> [Int] -> Int');
      expect((await s.typeAt('A.hs', 4, 3, 4, 4, 'x'))!.type).toBe('Int');
      expect((await s.typeAt('A.hs', 4, 10, 4, 15, 'foldr'))!.type).toContain('Int -> Int -> Int');
      expect((await s.typeAt('A.hs', 4, 25, 4, 26, '+'))!.type).toBe('Int -> Int -> Int');
    } finally {
      s.kill();
    }
  });

  it('has no answer for keywords and places without a term, and survives asking', async () => {
    const files = { 'A.hs': 'module A where\n\nx :: Int\nx = 1\n' };
    const s = await start(files);
    try {
      await s.load(files);
      expect(await s.typeAt('A.hs', 1, 1, 1, 7, 'module')).toBeNull();
      expect(await s.typeAt('A.hs', 99, 1, 99, 2, 'z')).toBeNull();
      expect((await s.typeAt('A.hs', 4, 1, 4, 2, 'x'))!.type).toBe('Int');
    } finally {
      s.kill();
    }
  });

  it('does not answer while the code does not compile', async () => {
    const s = await start({ 'A.hs': '' });
    try {
      await s.load({ 'A.hs': 'module A where\nx = "a" + \n' });
      expect(await s.typeAt('A.hs', 2, 1, 2, 2, 'x')).toBeNull();
    } finally {
      s.kill();
    }
  });

  it('tells library names from the student\'s own, even when they are called the same', async () => {
    const files = { 'A.hs': 'module A where\nmine :: Int\nmine = 1\nf map = map\ng :: [Int] -> [Bool]\ng xs = map even xs\n' };
    const s = await start(files);
    try {
      await s.load(files);
      const lib = (await s.typeAt('A.hs', 6, 8, 6, 11, 'map'))!;
      expect(lib.library).toBe(true);
      expect(lib.doc).toMatch(/list obtained by applying f/);
      expect(lib.doc).not.toMatch(/@|mathcal/);
      expect(await s.typeAt('A.hs', 4, 9, 4, 12, 'map')).toMatchObject({ library: false, doc: null });
      expect(await s.typeAt('A.hs', 3, 1, 3, 5, 'mine')).toMatchObject({ library: false, doc: null });
      expect((await s.typeAt('A.hs', 6, 12, 6, 16, 'even'))!.library).toBe(true);
    } finally {
      s.kill();
    }
  });

  it('counts a function from another of the student\'s own files as their own', async () => {
    const files = { 'B.hs': 'module B where\nhelper :: Int -> Int\nhelper = id\n', 'A.hs': 'module A where\nimport B\nx :: Int\nx = helper 1 + 2\n' };
    const s = await start(files);
    try {
      expect((await s.load(files)).ok).toBe(true);
      expect(await s.typeAt('A.hs', 4, 5, 4, 11, 'helper')).toMatchObject({ type: 'Int -> Int', library: false, doc: null });
      expect(await s.typeAt('A.hs', 4, 14, 4, 15, '+')).toMatchObject({ library: true });
    } finally {
      s.kill();
    }
  });

  it('never passes on a name that is not a name', async () => {
    const files = { 'A.hs': 'module A where\ng :: [Int] -> [Int]\ng xs = map id xs\n' };
    const s = await start(files);
    let seen = '';
    s.on('output', (t) => (seen += t));
    try {
      await s.load(files);
      expect(await s.typeAt('A.hs', 3, 8, 3, 11, 'map\n:! echo hacked')).toMatchObject({ library: false, doc: null });
      expect(await s.typeAt('A.hs', 3, 8, 3, 11, 'map 1')).toMatchObject({ library: false, doc: null });
      expect(seen).toBe('');
    } finally {
      s.kill();
    }
  });

  it('does not add anything to what the student sees', async () => {
    const files = { 'A.hs': 'module A where\nx :: Int\nx = 1\n' };
    const s = await start(files);
    let seen = '';
    s.on('output', (t) => (seen += t));
    try {
      await s.load(files);
      await s.typeAt('A.hs', 3, 1, 3, 2, 'x');
      expect(seen).toBe('');
    } finally {
      s.kill();
    }
  });
});

describe('API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let courses: CourseManager;
  let base: string;
  const search = async (q: string) => (await (await fetch(`http://${base}/api/search?q=${encodeURIComponent(q)}`)).json()) as { items: { id: string; title: string; href: string; snippet: string | null }[]; mine: { exerciseId: string }[] };

  beforeAll(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-nav-'));
    const config = { ...loadConfig({ CONTENT_DIR: EXAMPLE_CONTENT, DATA_DIR: dataDir } as NodeJS.ProcessEnv), port: 0 };
    courses = new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst') });
    app = await buildApp(makeDeps({ config, courses, pool: new SessionPool(2, 60_000), haskellLib: HASKELL_LIB, prologLib: PROLOG_LIB }));
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app.close();
    courses.close();
  });

  it('finds words inside exercise texts, with the place they were found', async () => {
    const { items } = await search('multiplikationen');
    expect(items.map((i) => i.id)).toContain('binary-exponentiation');
    expect(items.find((i) => i.id === 'binary-exponentiation')!.snippet).toMatch(/«Multiplikationen»/);
  });

  it('needs every word, and puts titles first', async () => {
    expect((await search('multiplikationen quatschwort')).items).toEqual([]);
    const { items } = await search('mergesort');
    expect(items[0]!.title).toMatch(/Mergesort/);
  });

  it('also finds chapter introductions, adventures and the landing page, with their own links', async () => {
    expect((await search('Learn You a Haskell')).items.find((i) => i.href === '/chapter/typklassen')).toBeDefined();
    expect((await search('Schritt für Schritt')).items.find((i) => i.href === '/adventure/taschenrechner')).toBeDefined();
    expect((await search('Mattermost')).items.find((i) => i.href === '/welcome')).toBeDefined();
  });

  it.skipIf(!hasBinary('ghci'))('only passes numbers and declared files on to the interpreter', async () => {
    const ws = new WebSocket(`ws://${base}/ws/repl/binary-exponentiation`);
    const inbox: ReplServerMessage[] = [];
    ws.on('message', (m) => inbox.push(JSON.parse(m.toString()) as ReplServerMessage));
    const until = async (done: () => boolean) => {
      for (let i = 0; i < 400 && !done(); i++) await new Promise((r) => setTimeout(r, 25));
      if (!done()) throw new Error(`timed out; got ${JSON.stringify(inbox).slice(0, 400)}`);
    };
    const answer = async (requestId: number, q: object) => {
      ws.send(JSON.stringify({ type: 'typeAt', requestId, name: 'power', ...q }));
      await until(() => inbox.some((m) => m.type === 'typeAt' && m.requestId === requestId));
      return (inbox.find((m) => m.type === 'typeAt' && m.requestId === requestId) as { result: { type: string } | null }).result?.type ?? null;
    };
    await until(() => inbox.some((m) => m.type === 'ready'));
    const file = 'BinaryExponentiation.hs';
    ws.send(JSON.stringify({ type: 'load', files: { [file]: 'module BinaryExponentiation where\npower :: Int\npower = 1\n' } }));
    await until(() => inbox.some((m) => m.type === 'loaded'));
    expect(await answer(1, { file, line: 3, column: 1, endLine: 3, endColumn: 6 })).toBe('Int');
    expect(await answer(2, { file: 'Other.hs', line: 3, column: 1, endLine: 3, endColumn: 6 })).toBeNull();
    expect(await answer(3, { file: `${file} 1 1 1 1\n:! touch /tmp/x`, line: 1, column: 1, endLine: 1, endColumn: 2 })).toBeNull();
    expect(await answer(4, { file, line: '3\n:quit', column: 1, endLine: 3, endColumn: 6 })).toBeNull();
    expect(await answer(5, { file, line: 3, column: 1, endLine: 3, endColumn: 6 })).toBe('Int');
    ws.close();
  });
});

describe('adventureOfSection', () => {
  const outline = loadContent(EXAMPLE_CONTENT).outline;
  const typklassen = outline.chapters.find((c) => c.id === 'typklassen')!;
  const grundlagen = outline.chapters.find((c) => c.id === 'haskell-grundlagen')!;

  it('finds the adventure of a section made of its exercises, even with a checklist in it', () => {
    const section = typklassen.sections.find((s) => s.title === 'Ein kleiner Taschenrechner')!;
    expect(adventureOfSection(outline, typklassen, section.id)?.id).toBe('taschenrechner');
  });

  it('finds none for sections that are no adventure, and ignores simple paths', () => {
    for (const section of grundlagen.sections) expect(adventureOfSection(outline, grundlagen, section.id)).toBeUndefined();
    const path = { ...outline.threads.find((t) => t.id === 'taschenrechner')!, adventure: false };
    const section = typklassen.sections.find((s) => s.title === 'Ein kleiner Taschenrechner')!;
    expect(adventureOfSection({ ...outline, threads: [path] }, typklassen, section.id)).toBeUndefined();
  });

  it('finds none for a section with only part of its exercises in the adventure', () => {
    const section = typklassen.sections.find((s) => s.title === 'Ein kleiner Taschenrechner')!;
    const partial = { ...outline.threads.find((t) => t.id === 'taschenrechner')!, steps: [['rechner-auswerten']] };
    expect(adventureOfSection({ ...outline, threads: [partial] }, typklassen, section.id)).toBeUndefined();
  });
});

describe('topics on the review page', () => {
  const outline = loadContent(EXAMPLE_CONTENT).outline;
  const reflection = (exerciseId: string, confidence: number) => ({ id: 1, exerciseId, confidence, how: [], comment: '', createdAt: 1 }) as never;
  const data = { progress: {}, stats: {}, openQuestions: {}, answers: {}, notes: {}, checklists: [], reflections: [reflection('symbolic-differentiation', 2), reflection('mutual-recursion', 4)] } as never;

  it('lists course topics, and leaves out topics that are only examples', () => {
    const { topics } = confidenceRows(outline, data);
    expect(topics.map((t) => t.label).sort()).toEqual(['Rekursion', 'Typklassen']);
  });

  it('counts self-evaluation questions in a chapter, both as rated and in the total', () => {
    const withAnswer = { progress: {}, stats: {}, openQuestions: {}, answers: {}, notes: {}, reflections: [], checklists: [{ checklistId: 'selbstevaluation-typklassen', title: 'x', question: { id: 'q', html: '' }, answer: { confidence: 1, note: '', updatedAt: 1 } }] } as never;
    const { chapters, topics } = confidenceRows(outline, withAnswer);
    const typklassen = chapters.find((c) => c.label === 'Typklassen')!;
    const exercises = outline.chapters.find((c) => c.id === 'typklassen')!.items.filter((i) => i.type === 'exercise').length;
    expect(typklassen).toMatchObject({ low: 1, total: exercises + 3 });
    expect(topics).toEqual([]);
  });

  it('keeps those topics for filtering', () => {
    expect(outline.tags.find((t) => t.id === 'diff')).toMatchObject({ review: false, label: 'Differenzieren' });
    expect(outline.tags.find((t) => t.id === 'rekursion')).toMatchObject({ review: true });
    expect(outline.tags.find((t) => t.id === 'deep-dive')?.review).toBe(true);
  });
});

describe('sample answers and looking after finishing', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let courses: CourseManager;
  const host = { host: 'localhost' };
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => app.inject({ method, url, headers: host, ...(payload ? { payload } : {}) });
  const stats = async (id: string) => (await call('GET', '/api/state')).json<{ state: { stats: Record<string, { solutionViewedAt: number | null } | undefined> } }>().state.stats[id];

  beforeAll(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-sample-'));
    const config = { ...loadConfig({ CONTENT_DIR: EXAMPLE_CONTENT, DATA_DIR: dataDir } as NodeJS.ProcessEnv), port: 0 };
    courses = new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst') });
    app = await buildApp(makeDeps({ config, courses, pool: new SessionPool(1, 1000), haskellLib: HASKELL_LIB, prologLib: PROLOG_LIB }));
  });
  afterAll(async () => {
    await app.close();
    courses.close();
  });

  const SECRET = 'verändert nichts außerhalb';

  it('does not send a sample answer to the browser until it is asked for', async () => {
    const item = await call('GET', '/api/items/side-effects');
    expect(item.json<{ meta: { hasSample: boolean } }>().meta.hasSample).toBe(true);
    expect(item.body).not.toContain(SECRET);
    expect((await call('POST', '/api/work/side-effects/ai/prompt', { answer: 'x', tests: null, lang: 'de' })).body).not.toContain(SECRET);
    expect((await (await call('GET', '/api/search?q=au%C3%9Ferhalb')).json<{ items: { id: string }[] }>()).items.map((i) => i.id)).not.toContain('side-effects');
    expect(courses.active!.content.current.exercise('mutual-recursion')!.meta.hasSample).toBe(false);
    expect((await call('POST', '/api/work/mutual-recursion/sample')).statusCode).toBe(404);
  });

  it('gives it when asked, and notes that while the exercise is still open', async () => {
    const r = await call('POST', '/api/work/side-effects/sample');
    expect(r.json<{ samples: string[] }>().samples[0]).toContain(SECRET);
    expect((await stats('side-effects'))?.solutionViewedAt).toBeTypeOf('number');
  });

  it('does not count looking after finishing against anyone', async () => {
    await call('PUT', '/api/progress/binary-exponentiation', { status: 'done' });
    expect((await call('POST', '/api/work/binary-exponentiation/solution')).statusCode).toBe(200);
    expect((await stats('binary-exponentiation'))?.solutionViewedAt ?? null).toBeNull();
    await call('PUT', '/api/progress/binary-exponentiation', { status: 'in_progress' });
    await call('POST', '/api/work/binary-exponentiation/solution');
    expect((await stats('binary-exponentiation'))?.solutionViewedAt).toBeTypeOf('number');
  });

  it('keeps the new editor settings, within sensible limits', async () => {
    expect((await call('PUT', '/api/settings', { editorFontSize: 15, editorKeys: 'vim' })).json()).toMatchObject({ editorFontSize: 15, editorKeys: 'vim' });
    expect((await call('PUT', '/api/settings', { editorFontSize: 200 })).statusCode).toBe(400);
    expect((await call('PUT', '/api/settings', { editorKeys: 'nano' })).statusCode).toBe(400);
  });
});
