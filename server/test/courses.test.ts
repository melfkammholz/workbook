import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CoursesResponse, Outline } from '@wb/shared';
import { buildApp } from '../src/api/app.js';
import { makeDeps } from '../src/api/deps.js';
import { loadConfig } from '../src/config.js';
import { CourseError, CourseManager, normalizeUrl } from '../src/courses/manager.js';
import { SessionPool } from '../src/runners/pool.js';
import { git, publish, startGitServer } from './git-server.js';
import { EXAMPLE_CONTENT, HASKELL_LIB, PROLOG_LIB, hasBinary } from './helpers.js';

describe('normalizeUrl', () => {
  it('accepts public http(s) addresses', () => {
    expect(normalizeUrl(' https://example.org/a/b.git/ ')).toBe('https://example.org/a/b.git');
    expect(normalizeUrl('http://example.org/a')).toBe('http://example.org/a');
  });

  it.each(['git@github.com:a/b.git', 'ssh://git@example.org/a', 'file:///etc', 'ext::sh -c id', '--upload-pack=x', 'nonsense', ''])('rejects %s', (url) => {
    expect(() => normalizeUrl(url)).toThrow(CourseError);
  });

  it('refuses a login inside the address, which would be stored and shown', () => {
    expect(() => normalizeUrl('https://me:token@example.org/a.git')).toThrow('has-credentials');
  });
});

describe.skipIf(!hasBinary('git'))('courses', () => {
  let server: Awaited<ReturnType<typeof startGitServer>>;
  let work: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let courses: CourseManager;
  let dataDir: string;
  let base: string;
  const switches: number[] = [];

  const api = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`http://${base}${url}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: res.status, json: (await res.json()) as never };
  };
  const list = async () => (await api('GET', '/api/courses')).json as CoursesResponse;
  const setTitle = (title: string) => {
    const file = path.join(work, 'workbook.yml');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^title:.*$/m, `title: ${title}`));
    git(work, 'commit', '-qam', 'new title');
    git(work, 'push', '-q', 'origin', 'main');
  };

  beforeAll(async () => {
    server = await startGitServer();
    work = publish(server.root, 'course', EXAMPLE_CONTENT);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-empty-'));
    fs.writeFileSync(path.join(empty, 'README.md'), 'Not a course\n');
    publish(server.root, 'not-a-course', empty);

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-courses-'));
    // No folder mounted, as for a student.
    const config = { ...loadConfig({ CONTENT_DIR: path.join(dataDir, 'nothing-here'), DATA_DIR: dataDir } as NodeJS.ProcessEnv), port: 0 };
    const pool = new SessionPool(1, 60_000);
    courses = new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst'), onSwitch: () => switches.push(Date.now()) });
    app = await buildApp(makeDeps({ config, courses, pool, haskellLib: HASKELL_LIB, prologLib: PROLOG_LIB }));
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app.close();
    courses.close();
    await server.close();
  });

  // These build on each other: a student's first steps, in order.

  it('starts without a course, and only what it takes to add one works', async () => {
    expect(await list()).toEqual({ courses: [], activeId: null });
    expect((await api('GET', '/api/settings')).status).toBe(200);
    expect((await api('GET', '/api/info')).status).toBe(200);
    expect((await api('GET', '/api/outline')).status).toBe(409);
    expect((await api('GET', '/api/state')).status).toBe(409);
  });

  it('explains why a course could not be added, and leaves nothing behind', async () => {
    expect(await api('POST', '/api/courses', { url: 'not a url' })).toEqual({ status: 400, json: { error: 'bad-url' } });
    expect(await api('POST', '/api/courses', { url: server.url('missing') })).toEqual({ status: 400, json: { error: 'clone-failed' } });
    expect(await api('POST', '/api/courses', { url: server.url('not-a-course') })).toEqual({ status: 400, json: { error: 'not-a-course' } });
    expect((await list()).courses).toEqual([]);
    expect(fs.existsSync(path.join(dataDir, 'courses')) ? fs.readdirSync(path.join(dataDir, 'courses')) : []).toEqual([]);
  });

  it('downloads a repository and opens it', async () => {
    const { status, json } = await api('POST', '/api/courses', { url: server.url('course') });
    expect(status).toBe(200);
    const data = json as CoursesResponse;
    expect(data.courses).toHaveLength(1);
    expect(data.courses[0]).toMatchObject({ title: 'Deklarative Programmierung', source: 'git', url: server.url('course'), update: 'current' });
    expect(data.activeId).toBe(data.courses[0]!.id);
    expect(((await api('GET', '/api/outline')).json as Outline).chapters.length).toBeGreaterThan(0);
  });

  it('opens a course that is already here instead of adding it twice', async () => {
    const { json } = await api('POST', '/api/courses', { url: `${server.url('course')}/` });
    expect((json as CoursesResponse).courses).toHaveLength(1);
  });

  it('only says there is an update once there is one, and then applies it on request', async () => {
    const { id } = (await list()).courses[0]!;
    await api('PUT', '/api/work/mergesort/note', { format: 'typst', content: 'my note' });

    let data = (await api('POST', '/api/courses/check')).json as CoursesResponse;
    expect(data.courses[0]!.update).toBe('current');

    setTitle('Neuer Titel');
    data = (await api('POST', '/api/courses/check')).json as CoursesResponse;
    expect(data.courses[0]!.update).toBe('available');
    // Nothing changes until the student asks for it.
    expect(((await api('GET', '/api/outline')).json as Outline).title).toBe('Deklarative Programmierung');

    data = (await api('POST', `/api/courses/${id}/update`)).json as CoursesResponse;
    expect(data.courses[0]).toMatchObject({ title: 'Neuer Titel', update: 'current' });
    expect(((await api('GET', '/api/outline')).json as Outline).title).toBe('Neuer Titel');
    expect(((await api('GET', '/api/work/mergesort')).json as { note: { content: string } }).note.content).toBe('my note');
  });

  it('keeps the work of two courses apart and ends running sessions on a switch', async () => {
    const first = (await list()).courses[0]!.id;
    publish(server.root, 'second', EXAMPLE_CONTENT);
    const before = switches.length;
    const added = (await api('POST', '/api/courses', { url: server.url('second') })).json as CoursesResponse;
    expect(added.courses).toHaveLength(2);
    expect(switches.length).toBe(before + 1);

    expect(((await api('GET', '/api/work/mergesort')).json as { note: unknown }).note).toBeNull();
    await api('POST', `/api/courses/${first}/activate`);
    expect(((await api('GET', '/api/work/mergesort')).json as { note: { content: string } }).note.content).toBe('my note');
  });

  it('remembers the open course across a restart', () => {
    const config = loadConfig({ CONTENT_DIR: path.join(dataDir, 'nothing-here'), DATA_DIR: dataDir } as NodeJS.ProcessEnv);
    const again = new CourseManager({ config, typstAssets: '' });
    expect(again.list().activeId).toBe(courses.list().activeId);
    expect(again.list().courses.map((c) => c.title)).toEqual(['Neuer Titel', 'Deklarative Programmierung']);
    again.close();
  });

  it('resets the work in one course, and leaves the course and other courses alone', async () => {
    const before = await list();
    const open = before.activeId!;
    const other = before.courses.find((c) => c.id !== open)!.id;
    await api('PUT', '/api/work/mergesort/note', { format: 'typst', content: 'in the open course' });
    await api('POST', `/api/courses/${other}/activate`);
    await api('PUT', '/api/work/mergesort/note', { format: 'typst', content: 'in the other course' });
    await api('POST', `/api/courses/${open}/activate`);

    const before2 = switches.length;
    const after = (await api('POST', `/api/courses/${open}/reset`)).json as CoursesResponse;
    expect(after.courses).toHaveLength(before.courses.length);
    expect(after.activeId).toBe(open);
    expect(switches.length).toBe(before2 + 1);
    expect(((await api('GET', '/api/work/mergesort')).json as { note: unknown }).note).toBeNull();
    expect(((await api('GET', '/api/outline')).json as Outline).chapters.length).toBeGreaterThan(0);

    await api('POST', `/api/courses/${other}/activate`);
    expect(((await api('GET', '/api/work/mergesort')).json as { note: { content: string } }).note.content).toBe('in the other course');
    await api('POST', `/api/courses/${open}/activate`);
    expect((await api('POST', '/api/courses/nope/reset')).status).toBe(404);
  });

  it('removes a course with its work and moves on to the next', async () => {
    const before = await list();
    const open = before.activeId!;
    const other = before.courses.find((c) => c.id !== open)!.id;
    const data = (await api('DELETE', `/api/courses/${open}`)).json as CoursesResponse;
    expect(data.activeId).toBe(other);
    expect(fs.existsSync(path.join(dataDir, 'courses', open))).toBe(false);
    expect((await api('DELETE', '/api/courses/nope')).status).toBe(404);
    expect((await api('POST', '/api/courses/nope/activate')).status).toBe(404);

    const none = (await api('DELETE', `/api/courses/${other}`)).json as CoursesResponse;
    expect(none).toEqual({ courses: [], activeId: null });
    expect((await api('GET', '/api/outline')).status).toBe(409);
  });
});

describe('a mounted folder', () => {
  it('is a course of its own that cannot be removed or updated, and keeps the existing work', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mount-'));
    const config = loadConfig({ CONTENT_DIR: EXAMPLE_CONTENT, DATA_DIR: dataDir } as NodeJS.ProcessEnv);
    const courses = new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst') });
    expect(courses.list()).toEqual({ activeId: 'mounted', courses: [{ id: 'mounted', title: 'Deklarative Programmierung', source: 'mounted', url: null, update: 'unknown' }] });
    expect(courses.active!.store).toBe(courses.global);
    await expect(courses.remove('mounted')).rejects.toThrow('mounted');
    await expect(courses.update('mounted')).rejects.toThrow('mounted');
    // A mounted folder shares its database with the settings, which have to survive this.
    courses.global.saveSettings({ displayName: 'Ada' });
    courses.active!.store.saveNote('x', 'typst', 'weg');
    courses.reset('mounted');
    expect(courses.active!.store.getNote('x')).toBeNull();
    expect(courses.global.getSettings().displayName).toBe('Ada');
    expect(courses.list().activeId).toBe('mounted');
    courses.close();
  });

  it('does not count when the folder has no chapters', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mount-'));
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-empty-'));
    const courses = new CourseManager({ config: loadConfig({ CONTENT_DIR: empty, DATA_DIR: dataDir } as NodeJS.ProcessEnv), typstAssets: '' });
    expect(courses.list()).toEqual({ courses: [], activeId: null });
    courses.close();
  });
});
