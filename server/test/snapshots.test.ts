import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CoursesResponse } from '@wb/shared';
import { buildApp } from '../src/api/app.js';
import { makeDeps } from '../src/api/deps.js';
import { loadConfig } from '../src/config.js';
import { CourseManager } from '../src/courses/manager.js';
import { Store } from '../src/db/store.js';
import { SessionPool } from '../src/runners/pool.js';
import { dayOf, retained, Snapshots } from '../src/snapshots.js';
import { EXAMPLE_CONTENT, HASKELL_LIB, PROLOG_LIB } from './helpers.js';

/** Every day from `from`, `n` days long, as snapshot ids. */
const days = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

describe('which snapshots stay', () => {
  it('keeps the last 7 days and the newest of each of the last 4 weeks', () => {
    // Monday 2026-10-05 to Thursday 2026-11-12, every day.
    const ids = days('2026-10-05', 39);
    expect([...retained(ids)].sort()).toEqual([
      // Weekly: the newest of the two weeks before last (Sundays); the current week and last week are in the 7 days.
      '2026-10-25',
      '2026-11-01',
      // The last 7 days; the current week's newest (Thursday) and last week's Sunday are among them.
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ].sort());
  });

  it('counts days the app ran, not calendar days, and keeps everything while there are few', () => {
    const ids = ['2026-01-01', '2026-03-10', '2026-06-01'];
    expect(retained(ids)).toEqual(new Set(ids));
  });

  it('keeps only the newest of a day, including one taken before a restore', () => {
    expect(retained(['2026-11-12', '2026-11-12-153000', '2026-11-11'])).toEqual(new Set(['2026-11-12-153000', '2026-11-11']));
  });
});

describe('snapshots', () => {
  const setup = () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-snap-'));
    let now = new Date('2026-11-01T09:00:00').getTime();
    const store = new Store(path.join(dataDir, 'workbook.db'), () => now);
    const snapshots = new Snapshots(dataDir, store, () => now);
    const files = path.join(dataDir, 'files');
    fs.mkdirSync(files);
    return { dataDir, store, snapshots, files, advance: (days: number) => (now += days * 86_400_000), today: () => dayOf(now) };
  };

  it('takes one a day with the database and the uploaded files, kept once by hash, and prunes the old ones', () => {
    const { dataDir, store, snapshots, files, advance, today } = setup();
    fs.writeFileSync(path.join(files, 'aaa'), 'a pdf');
    store.forCourse('c').saveNote('x', 'typst', 'first');
    expect(snapshots.daily()).toBe(today());
    // Once a day only.
    expect(snapshots.daily()).toBeNull();
    const first = snapshots.list();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: today(), reason: 'daily' });
    expect(first[0]!.bytes).toBeGreaterThan(fs.statSync(path.join(files, 'aaa')).size);
    const kept = path.join(dataDir, 'snapshots', 'files', 'aaa');
    // A hard link: the same file, no second copy.
    expect(fs.statSync(kept).ino).toBe(fs.statSync(path.join(files, 'aaa')).ino);

    // The file goes from the library; the snapshot still has it until the snapshot itself goes.
    fs.rmSync(path.join(files, 'aaa'));
    fs.writeFileSync(path.join(files, 'bbb'), 'another');
    for (let i = 0; i < 40; i++) {
      advance(1);
      snapshots.daily();
    }
    const ids = snapshots.list().map((s) => s.id);
    expect(ids.length).toBeLessThanOrEqual(7 + 4);
    expect(ids).not.toContain('2026-11-01');
    expect(fs.existsSync(kept)).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'snapshots', 'files', 'bbb'))).toBe(true);
    store.close();
  });

  it('restores the database in place after taking one more snapshot, and brings back missing files', async () => {
    const { store, snapshots, files, advance } = setup();
    const course = store.forCourse('c');
    fs.writeFileSync(path.join(files, 'aaa'), 'a pdf');
    course.saveNote('x', 'typst', 'then');
    const then = snapshots.daily()!;
    advance(1);
    course.saveNote('x', 'typst', 'now');
    fs.rmSync(path.join(files, 'aaa'));
    fs.writeFileSync(path.join(files, 'bbb'), 'added since');

    const before = await snapshots.restore(then);
    expect(course.getNote('x')?.content).toBe('then');
    // The app keeps writing to the same open database.
    course.saveNote('y', 'typst', 'after');
    expect(course.getNote('y')?.content).toBe('after');
    expect(fs.readFileSync(path.join(files, 'aaa'), 'utf8')).toBe('a pdf');
    expect(fs.existsSync(path.join(files, 'bbb'))).toBe(true);

    expect(snapshots.list().find((s) => s.id === before)).toMatchObject({ reason: 'before-restore' });
    await snapshots.restore(before);
    expect(course.getNote('x')?.content).toBe('now');
    await expect(snapshots.restore('../nope')).rejects.toThrow('unknown-snapshot');
    store.close();
  });
});

describe('restoring from the settings', () => {
  it('needs the word, and brings the course list and work back as they were', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-snap-api-'));
    const config = { ...loadConfig({ CONTENT_DIR: EXAMPLE_CONTENT, DATA_DIR: dataDir } as NodeJS.ProcessEnv), port: 0 };
    const switches: number[] = [];
    const courses = new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst'), onSwitch: () => switches.push(1) });
    const app = await buildApp(makeDeps({ config, courses, pool: new SessionPool(1, 60_000), haskellLib: HASKELL_LIB, prologLib: PROLOG_LIB }));
    const call = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => {
      const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
      return { status: res.statusCode, json: res.json() as never };
    };

    await call('PUT', '/api/work/mergesort/note', { format: 'typst', content: 'then' });
    const id = courses.snapshots.daily()!;
    await call('PUT', '/api/work/mergesort/note', { format: 'typst', content: 'now' });

    expect(((await call('GET', '/api/snapshots')).json as { snapshots: { id: string }[] }).snapshots.map((s) => s.id)).toEqual([id]);
    expect((await call('POST', `/api/snapshots/${id}/restore`)).status).toBe(400);
    expect((await call('POST', '/api/snapshots/2020-01-01/restore', { confirm: 'restore' })).status).toBe(404);
    const restored = await call('POST', `/api/snapshots/${id}/restore`, { confirm: 'restore' });
    expect(restored.status).toBe(200);
    expect((restored.json as CoursesResponse).activeId).toBe('content');
    expect(switches.length).toBeGreaterThan(0);
    expect(((await call('GET', '/api/work/mergesort')).json as { note: { content: string } }).note.content).toBe('then');
    expect(((await call('GET', '/api/snapshots')).json as { snapshots: unknown[] }).snapshots).toHaveLength(2);

    await app.close();
    courses.close();
  });
});
