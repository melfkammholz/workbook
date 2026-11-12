import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Resource, ResourcesResponse } from '@wb/shared';
import { buildApp } from '../src/api/app.js';
import { makeDeps } from '../src/api/deps.js';
import { loadConfig } from '../src/config.js';
import { CourseManager } from '../src/courses/manager.js';
import { SessionPool } from '../src/runners/pool.js';
import { EXAMPLE_CONTENT, HASKELL_LIB, PROLOG_LIB } from './helpers.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let courses: CourseManager;
let dataDir: string;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-res-'));
  const config = { ...loadConfig({ CONTENT_DIR: EXAMPLE_CONTENT, DATA_DIR: dataDir } as NodeJS.ProcessEnv), port: 0 };
  courses = new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst') });
  app = await buildApp(makeDeps({ config, courses, pool: new SessionPool(1, 60_000), haskellLib: HASKELL_LIB, prologLib: PROLOG_LIB }));
});
afterAll(async () => {
  await app.close();
  courses.close();
});

const up = (query: Record<string, string>, body: Buffer | string) =>
  app.inject({ method: 'POST', url: `/api/resources/upload?${new URLSearchParams(query)}`, headers: { 'content-type': 'application/octet-stream' }, payload: body });

describe('materials', () => {
  it('stores an upload by its hash, once, and lists it by course', async () => {
    const body = Buffer.from('%PDF-1.4 hello');
    const sha = crypto.createHash('sha256').update(body).digest('hex');
    const a = await up({ filename: 'Skript 1.pdf', title: 'Skript', type: 'notes', courses: 'content, other', author: 'Prof' }, body);
    expect(a.statusCode).toBe(200);
    const ra = a.json() as Resource;
    expect(ra).toMatchObject({ title: 'Skript', type: 'notes', author: 'Prof', courses: ['content', 'other'], file: { sha256: sha, size: body.length, mime: 'application/pdf' } });
    expect(fs.readFileSync(path.join(dataDir, 'files', sha))).toEqual(body);
    const b = await up({ filename: 'copy.pdf', title: 'Copy', type: 'other' }, body);
    expect(fs.readdirSync(path.join(dataDir, 'files'))).toEqual([sha]);

    const all = (await app.inject('/api/resources')).json() as ResourcesResponse;
    expect(all.resources.map((r) => r.title).sort()).toEqual(['Copy', 'Skript']);
    const mine = (await app.inject('/api/resources?course=content')).json() as ResourcesResponse;
    expect(mine.resources.map((r) => r.title)).toEqual(['Skript']);

    // The file stays until the last resource using it is gone.
    await app.inject({ method: 'DELETE', url: `/api/resources/${(b.json() as Resource).id}` });
    expect(fs.existsSync(path.join(dataDir, 'files', sha))).toBe(true);
    const left = (await app.inject({ method: 'DELETE', url: `/api/resources/${ra.id}` })).json() as ResourcesResponse;
    expect(left.resources).toEqual([]);
    expect(left.courses.map((c) => c.id)).toEqual(['deklarative-programmierung']);
    expect(fs.existsSync(path.join(dataDir, 'files', sha))).toBe(false);
  });

  it('puts parts into a series in the order they come, and drops a series that is empty', async () => {
    const one = (await up({ filename: 'a.pdf', title: 'Part 1', type: 'slides', newSeries: 'Lectures' }, 'one')).json() as Resource;
    const two = (await up({ filename: 'b.pdf', title: 'Part 2', type: 'slides', series: one.series! }, 'two')).json() as Resource;
    expect([one.position, two.position]).toEqual([0, 1]);
    const list = (await app.inject('/api/resources')).json() as ResourcesResponse;
    expect(list.series).toMatchObject([{ title: 'Lectures', type: 'slides' }]);

    const moved = await app.inject({ method: 'PUT', url: `/api/resources/${two.id}`, payload: { title: 'Part 2', type: 'slides', series: null, courses: [] } });
    expect((moved.json() as Resource).series).toBeNull();
    await app.inject({ method: 'DELETE', url: `/api/resources/${one.id}` });
    const after = (await app.inject({ method: 'DELETE', url: `/api/resources/${two.id}` })).json() as ResourcesResponse;
    expect(after.series).toEqual([]);
  });

  it('serves the file with a cache key, and never shows HTML as a page', async () => {
    const r = (await up({ filename: 'x.html', title: 'Page', type: 'other' }, '<script>alert(1)</script>')).json() as Resource;
    const res = await app.inject(`/api/resources/${r.id}/file`);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers.etag).toBe(`"${r.file.sha256}"`);
    expect((await app.inject({ url: `/api/resources/${r.id}/file`, headers: { 'if-none-match': res.headers.etag as string } })).statusCode).toBe(304);
    await app.inject({ method: 'DELETE', url: `/api/resources/${r.id}` });
  });

  it('remembers the page the viewer was on', async () => {
    const r = (await up({ filename: 'p.pdf', title: 'P', type: 'notes' }, '%PDF-1.4')).json() as Resource;
    expect((await app.inject({ method: 'PUT', url: `/api/resources/${r.id}/page`, payload: { page: 37 } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'PUT', url: `/api/resources/${r.id}/page`, payload: { page: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/resources/none/page', payload: { page: 2 } })).statusCode).toBe(404);
    const list = (await app.inject('/api/resources')).json() as ResourcesResponse;
    expect(list.resources.find((x) => x.id === r.id)?.lastPage).toBe(37);
    await app.inject({ method: 'DELETE', url: `/api/resources/${r.id}` });
  });

  it('refuses what is not a file or a resource', async () => {
    expect((await up({ filename: 'x.pdf', title: 'x', type: 'other' }, Buffer.alloc(0))).statusCode).toBe(400);
    expect((await up({ filename: 'x.pdf', title: 'x', type: 'bogus' }, 'a')).statusCode).toBe(400);
    expect((await up({ filename: 'x.pdf', title: 'x', type: 'other', series: 'nope' }, 'a')).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/resources/none' })).statusCode).toBe(404);
    expect((await app.inject('/api/resources/none/file')).statusCode).toBe(404);
  });
});
