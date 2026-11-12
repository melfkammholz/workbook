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

describe('highlights in PDFs', () => {
  it('are saved with the resource, changed, listed and removed with it', async () => {
    const body = Buffer.from('%PDF-1.4 highlighted');
    const res = (await up({ filename: 'h.pdf', title: 'H', type: 'notes' }, body)).json() as Resource;
    const id = crypto.randomUUID();
    const make = { id, version: res.file.sha256, pageIndex: 2, rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }], quote: 'ein Typ', prefix: 'vor', suffix: 'nach', color: '#aabbcc' };
    const added = await app.inject({ method: 'POST', url: `/api/resources/${res.id}/annotations`, payload: make });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toMatchObject({ id, pageIndex: 2, review: null, comment: '', rects: make.rects });
    expect((await app.inject({ method: 'POST', url: `/api/resources/${res.id}/annotations`, payload: make })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/resources/${res.id}/annotations`, payload: { ...make, id: undefined, rects: [{ x: 2, y: 0, w: 1, h: 1 }] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/resources/nope/annotations', payload: { ...make, id: undefined } })).statusCode).toBe(404);

    const patched = await app.inject({ method: 'PATCH', url: `/api/pdf-annotations/${id}`, payload: { comment: 'klar', review: 'open' } });
    expect(patched.json()).toMatchObject({ comment: 'klar', review: 'open', color: '#aabbcc' });
    expect((await app.inject({ method: 'GET', url: `/api/resources/${res.id}/annotations` })).json()).toHaveLength(1);
    expect(((await app.inject({ method: 'GET', url: '/api/pdf-annotations' })).json() as unknown[]).length).toBeGreaterThanOrEqual(1);

    await app.inject({ method: 'DELETE', url: `/api/pdf-annotations/${id}` });
    expect((await app.inject({ method: 'GET', url: `/api/resources/${res.id}/annotations` })).json()).toHaveLength(0);

    await app.inject({ method: 'POST', url: `/api/resources/${res.id}/annotations`, payload: make });
    await app.inject({ method: 'DELETE', url: `/api/resources/${res.id}` });
    expect(((await app.inject({ method: 'GET', url: '/api/pdf-annotations' })).json() as { resource: string }[]).some((a) => a.resource === res.id)).toBe(false);
  });

  it('keeps one item per page: made with the client\'s id, then changed in place, and gone with the file', async () => {
    const res = (await up({ filename: 'p.pdf', title: 'P', type: 'slides' }, Buffer.from('%PDF-1.4 pages'))).json() as Resource;
    const id = crypto.randomUUID();
    const base = { version: res.file.sha256, fingerprint: 'index:2' };
    const made = await app.inject({ method: 'PUT', url: `/api/resources/${res.id}/pages/2`, payload: { ...base, id, marks: ['m1'], review: 'open' } });
    expect(made.statusCode).toBe(200);
    expect(made.json()).toMatchObject({ id, pageIndex: 2, note: '', marks: ['m1'], review: 'open' });
    // The same page again keeps the id and only changes what is sent.
    const changed = await app.inject({ method: 'PUT', url: `/api/resources/${res.id}/pages/2`, payload: { ...base, id: crypto.randomUUID(), note: 'Kernidee' } });
    expect(changed.json()).toMatchObject({ id, note: 'Kernidee', marks: ['m1'], review: 'open' });
    const cleared = await app.inject({ method: 'PUT', url: `/api/resources/${res.id}/pages/2`, payload: { ...base, review: null, marks: [] } });
    expect(cleared.json()).toMatchObject({ id, note: 'Kernidee', marks: [], review: null });
    expect((await app.inject({ method: 'GET', url: `/api/resources/${res.id}/pages` })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'PUT', url: `/api/resources/${res.id}/pages/x`, payload: base })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: `/api/resources/${res.id}/pages/1`, payload: { ...base, review: 'later' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/resources/nope/pages/1', payload: base })).statusCode).toBe(404);
    expect(((await app.inject({ method: 'GET', url: '/api/pdf-pages' })).json() as unknown[]).length).toBeGreaterThanOrEqual(1);
    await app.inject({ method: 'DELETE', url: `/api/resources/${res.id}` });
    expect(((await app.inject({ method: 'GET', url: '/api/pdf-pages' })).json() as { resource: string }[]).some((p) => p.resource === res.id)).toBe(false);
  });

  it('takes a removed mark off every page', async () => {
    const res = (await up({ filename: 'm.pdf', title: 'M', type: 'slides' }, Buffer.from('%PDF-1.4 marks'))).json() as Resource;
    const base = { version: res.file.sha256, fingerprint: 'index:0' };
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { pdfPageMarks: [{ id: 'a', name: 'exam' }, { id: 'b', name: 'unclear' }] } });
    for (const i of [0, 1]) await app.inject({ method: 'PUT', url: `/api/resources/${res.id}/pages/${i}`, payload: { ...base, id: crypto.randomUUID(), marks: ['a', 'b'] } });
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { pdfPageMarks: [{ id: 'b', name: 'unclear' }] } });
    const pages = (await app.inject({ method: 'GET', url: `/api/resources/${res.id}/pages` })).json() as { marks: string[] }[];
    expect(pages.map((p) => p.marks)).toEqual([['b'], ['b']]);
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { pdfPageMarks: [] } });
    await app.inject({ method: 'DELETE', url: `/api/resources/${res.id}` });
  });
});
