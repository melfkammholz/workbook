import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ItemDetail } from '@wb/shared';
import { buildApp } from '../src/api/app.js';
import { makeDeps } from '../src/api/deps.js';
import { loadConfig } from '../src/config.js';
import { CourseManager } from '../src/courses/manager.js';
import { SessionPool } from '../src/runners/pool.js';
import { HASKELL_LIB, PROLOG_LIB, hasBinary } from './helpers.js';

const typstBin = process.env.TYPST_BIN ?? 'typst';

const files: Record<string, string> = {
  'workbook.yml': 'title: Kurs\nchapters: [01-a]\n',
  'chapters/01-a/chapter.yml': 'title: A\nitems:\n  - id: with-support\n    title: Mit\n    code:\n      file: code/Task.hs\n      support: [code/Helper.hs]\n  - id: without\n    title: Ohne\n',
  'chapters/01-a/with-support.typ': 'Aufgabe.\n',
  'chapters/01-a/without.typ': 'Frage.\n',
  'chapters/01-a/code/Task.hs': 'module Task where\nimport Helper\n#ifdef TEMPLATE\nf = undefined\n#else\nf = helper\n#endif\n',
  'chapters/01-a/code/Helper.hs': 'module Helper where\n\nhelper :: Int\nhelper = 1\n',
};

describe.skipIf(!hasBinary(typstBin))('API: support files', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let courses: CourseManager;
  let base: string;
  const item = async (id: string) => (await (await fetch(`http://${base}/api/items/${id}`)).json()) as ItemDetail;

  beforeAll(async () => {
    const content = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-support-'));
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(content, name)), { recursive: true });
      fs.writeFileSync(path.join(content, name), text);
    }
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-support-data-'));
    const config = { ...loadConfig({ CONTENT_DIR: content, DATA_DIR: dataDir, TYPST_BIN: typstBin } as NodeJS.ProcessEnv), port: 0 };
    courses = new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst') });
    app = await buildApp(makeDeps({ config, courses, pool: new SessionPool(1, 60_000), haskellLib: HASKELL_LIB, prologLib: PROLOG_LIB }));
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app.close();
    courses.close();
  });

  it('sends support files to the browser, apart from the files a student edits', async () => {
    const d = await item('with-support');
    expect(d.support).toEqual({ 'Helper.hs': files['chapters/01-a/code/Helper.hs'] });
    expect(Object.keys(d.starter)).toEqual(['Task.hs']);
    expect(d.starter['Task.hs']).not.toContain('f = helper');
  });

  it('has none for an exercise without code', async () => {
    expect((await item('without')).support).toEqual({});
  });
});
