import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PROMPT_TEMPLATE } from '@wb/shared';
import { buildPrompt, type PromptInput } from '../src/ai/prompt.js';
import { buildApp } from '../src/api/app.js';
import { makeDeps } from '../src/api/deps.js';
import { htmlToText } from '../src/content/html.js';
import { loadConfig } from '../src/config.js';
import { CourseManager } from '../src/courses/manager.js';
import { SessionPool } from '../src/runners/pool.js';
import { EXAMPLE_CONTENT, HASKELL_LIB, PROLOG_LIB, hasBinary } from './helpers.js';

const typstBin = process.env.TYPST_BIN ?? 'typst';

const input: PromptInput = {
  title: 'Mergesort',
  task: 'Sortiere die Liste.',
  answer: 'sort = id',
  language: 'haskell',
  tests: [{ name: 'sortiert', status: 'fail', message: 'falsifiable\n[2,1]' }],
  questions: ['Warum der Basisfall?'],
  lang: 'de',
};

describe('buildPrompt', () => {
  it('fills in the exercise, the answer and the test results, in the language of the app', () => {
    const de = buildPrompt('', input);
    expect(de).toContain('Antworte auf Deutsch');
    expect(de).toContain('Mergesort\n\nSortiere die Liste.');
    expect(de).toContain('<answer language="haskell">\nsort = id\n</answer>');
    expect(de).toContain('<questions>\n- Warum der Basisfall?\n</questions>');
    expect(de).toContain('fail: sortiert\n  falsifiable\n  [2,1]');
    expect(de).not.toMatch(/\{(title|task|language|answer|tests|questions)\}/);
    expect(buildPrompt('', { ...input, lang: 'en' })).toContain('Reply in English');
  });

  it('says so when no tests ran, and labels a text answer', () => {
    const text = buildPrompt('', { ...input, tests: null, language: null, lang: 'en' });
    expect(text).toContain('No test run yet.');
    expect(buildPrompt('', { ...input, questions: [], lang: 'en' })).toContain('No open questions.');
    expect(text).toContain('<answer language="text">');
  });

  it('uses the template of the student', () => {
    expect(buildPrompt('Bitte prüfen: {answer} ({title})', input)).toBe('Bitte prüfen: sort = id (Mergesort)');
  });

  it('falls back to the default for an empty template', () => {
    expect(buildPrompt('   \n', input)).toBe(buildPrompt(DEFAULT_PROMPT_TEMPLATE.de, input));
  });

  it('never replaces anything inside what the student wrote', () => {
    const text = buildPrompt('{answer} / {title}', { ...input, answer: '{title} costs $& and $1' });
    expect(text).toBe('{title} costs $& and $1 / Mergesort');
  });

  it('leaves braces alone that are no placeholder', () => {
    expect(buildPrompt('{hints} {answer}', input)).toBe('{hints} sort = id');
  });
});

describe('htmlToText', () => {
  it('keeps blocks, lists and code readable', () => {
    const text = htmlToText('<p>Eins <code>x</code></p><ul><li>a</li><li>b</li></ul><pre><code>f x\n  = 1</code></pre>');
    expect(text).toBe('Eins x\n\n- a\n\n- b\n\nf x\n  = 1');
  });
});

describe.skipIf(!hasBinary(typstBin))('prompt API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let courses: CourseManager;

  beforeAll(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ai-'));
    const config = { ...loadConfig({ CONTENT_DIR: EXAMPLE_CONTENT, DATA_DIR: dataDir, TYPST_BIN: typstBin } as NodeJS.ProcessEnv), port: 0 };
    courses = new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst') });
    app = await buildApp(makeDeps({ config, courses, pool: new SessionPool(1, 1000), haskellLib: HASKELL_LIB, prologLib: PROLOG_LIB }));
  });
  afterAll(async () => {
    await app.close();
    courses.close();
  });

  const prompt = (body: object) => app.inject({ method: 'POST', url: '/api/work/automatic-differentiation/ai/prompt', headers: { host: 'localhost' }, payload: body });

  it('never contains hints or the reference solution', async () => {
    const res = await prompt({ answer: 'meine Antwort', tests: null, lang: 'de' });
    expect(res.statusCode).toBe(200);
    const { text } = res.json<{ text: string }>();
    expect(text).toContain('meine Antwort');
    const item = await app.inject({ method: 'GET', url: '/api/items/automatic-differentiation', headers: { host: 'localhost' } });
    const hints = item.json<{ rendered: { hints: string[] } }>().rendered.hints.map(htmlToText).filter((h) => h.length > 20);
    for (const hint of hints) expect(text).not.toContain(hint);
    const solution = courses.active!.content.current.exercise('automatic-differentiation')!.code!.solution!;
    expect(text).not.toContain(solution.trim().split('\n').slice(-3).join('\n'));
  });

  it('follows the template in the settings', async () => {
    courses.global.saveSettings({ aiPromptTemplate: 'Antwort: {answer}' });
    const { text } = (await prompt({ answer: 'x = 1', tests: null, lang: 'de' })).json<{ text: string }>();
    expect(text).toBe('Antwort: x = 1');
    courses.global.saveSettings({ aiPromptTemplate: '' });
  });

  it('rejects an empty answer', async () => {
    expect((await prompt({ answer: '  ', tests: null, lang: 'de' })).statusCode).toBe(400);
  });

  it('does not hand author notes to the browser', async () => {
    const item = await app.inject({ method: 'GET', url: '/api/items/automatic-differentiation', headers: { host: 'localhost' } });
    expect(item.json<{ rendered: object }>().rendered).not.toHaveProperty('drafts');
  });
});
