import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { CourseError, CourseManager } from '../src/courses/manager.js';
import { git } from './git-server.js';
import { EXAMPLE_CONTENT, hasBinary } from './helpers.js';

const setTitle = (dir: string, title: string) => {
  const file = path.join(dir, 'workbook.yml');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^title:.*$/m, `title: ${title}`));
};

describe.skipIf(!hasBinary('git'))('workbooks from the workbooks folder', () => {
  let tmp: string;
  let workbooks: string;
  let courses: CourseManager;
  const make = () => {
    const config = loadConfig({ CONTENT_DIR: path.join(tmp, 'nothing-here'), DATA_DIR: path.join(tmp, 'data'), WORKBOOKS_DIR: workbooks } as NodeJS.ProcessEnv);
    return new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst') });
  };

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-local-'));
    workbooks = path.join(tmp, 'workbooks');
    fs.mkdirSync(workbooks);
    fs.cpSync(EXAMPLE_CONTENT, path.join(workbooks, 'plain'), { recursive: true });
    fs.cpSync(EXAMPLE_CONTENT, path.join(workbooks, 'repo'), { recursive: true });
    const repo = path.join(workbooks, 'repo');
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'start');
    fs.mkdirSync(path.join(workbooks, 'empty'));
    fs.writeFileSync(path.join(workbooks, 'empty', 'README.md'), 'no chapters\n');
    // A link leading out of the folder.
    fs.symlinkSync(os.tmpdir(), path.join(workbooks, 'escape'));
    courses = make();
  });
  afterAll(() => courses.close());

  it('lists folders that look like workbooks, with their title and kind', () => {
    expect(courses.listLocal()).toEqual([
      { name: 'plain', title: 'Deklarative Programmierung', git: false, added: false },
      { name: 'repo', title: 'Deklarative Programmierung', git: true, added: false },
    ]);
  });

  it.each(['../data', '..', '.', 'a/b', '/etc', 'escape', 'missing', 'empty', ''])('refuses %j', async (name) => {
    await expect(courses.add({ local: name })).rejects.toThrow(CourseError);
  });

  it('adds a plain folder, notices a change and updates on request', async () => {
    const data = await courses.add({ local: 'plain' });
    const c = data.courses[0]!;
    expect(c).toMatchObject({ source: 'local', url: null, folder: 'plain', update: 'current' });
    expect(courses.listLocal().find((w) => w.name === 'plain')!.added).toBe(true);

    await courses.checkUpdates();
    expect(courses.list().courses[0]!.update).toBe('current');
    setTitle(path.join(workbooks, 'plain'), 'Geändert');
    await courses.checkUpdates();
    expect(courses.list().courses[0]!.update).toBe('available');
    expect(courses.list().courses[0]!.title).toBe('Deklarative Programmierung');

    const after = await courses.update(c.id);
    expect(after.courses[0]).toMatchObject({ title: 'Geändert', update: 'current' });
    await courses.checkUpdates();
    expect(courses.list().courses[0]!.update).toBe('current');
  });

  it('adds a git repo, sees only committed changes and updates on request', async () => {
    const repo = path.join(workbooks, 'repo');
    const data = await courses.add({ local: 'repo' });
    const c = data.courses.find((x) => x.folder === 'repo')!;
    expect(c.update).toBe('current');

    setTitle(repo, 'Nur auf der Platte');
    await courses.checkUpdates();
    expect(courses.list().courses.find((x) => x.id === c.id)!.update).toBe('current');

    git(repo, 'commit', '-qam', 'new title');
    await courses.checkUpdates();
    expect(courses.list().courses.find((x) => x.id === c.id)!.update).toBe('available');
    const after = await courses.update(c.id);
    expect(after.courses.find((x) => x.id === c.id)).toMatchObject({ title: 'Nur auf der Platte', update: 'current' });
  });

  it('adding the same folder again opens it, and a removed one comes back', async () => {
    const before = courses.list().courses.length;
    const again = await courses.add({ local: 'plain' });
    expect(again.courses).toHaveLength(before);
    const id = again.courses.find((c) => c.folder === 'plain')!.id;
    courses.remove(id);
    expect(courses.list().courses.some((c) => c.id === id)).toBe(false);
    expect((await courses.add({ local: 'plain' })).courses.some((c) => c.id === id)).toBe(true);
  });

  it('still reads records from before there were local workbooks', () => {
    // A record has no `local`: it is an address, as it always was.
    const records = courses.global.getValue<{ id: string; url: string; title: string }[]>('courses', []);
    courses.global.setValue('courses', [...records, { id: 'c-old', url: 'https://example.org/old.git', title: 'Alt' }]);
    expect(courses.list().courses.find((c) => c.id === 'c-old')).toMatchObject({ source: 'git', url: 'https://example.org/old.git', folder: null });
  });
});
