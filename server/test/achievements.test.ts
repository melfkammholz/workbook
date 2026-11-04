import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AchievementsResponse, ChapterMeta, Outline, StudentState } from '@wb/shared';
import { chapterStage, qualifiesFor, type AchievementInput } from '../src/achievements.js';
import { buildApp } from '../src/api/app.js';
import { makeDeps } from '../src/api/deps.js';
import { loadConfig } from '../src/config.js';
import { loadContent } from '../src/content/loader.js';
import { CourseManager } from '../src/courses/manager.js';
import { Store } from '../src/db/store.js';
import { SessionPool } from '../src/runners/pool.js';
import { EXAMPLE_CONTENT, HASKELL_LIB, PROLOG_LIB } from './helpers.js';

const exercise = (id: string, startHere = false) => ({ type: 'exercise', id, title: id, startHere }) as never;
const checklist = (id: string, questionCount: number) => ({ type: 'checklist', id, title: id, questionCount }) as never;
const chapter = (items: never[]): ChapterMeta => ({ id: 'c', number: 1, title: 'Kapitel', summary: null, hasIntro: false, partId: null, sections: [], items });
const state = (done: string[] = [], more: Partial<StudentState> = {}): StudentState => ({
  progress: Object.fromEntries(done.map((id) => [id, { status: 'done', updatedAt: 1, reviewDueAt: null, reviewCount: 0 }])),
  checklists: {},
  landingSeen: true,
  openQuestions: {},
  reflections: {},
  stats: {},
  lastOpenedId: null,
  ...more,
});
const stats = (o: object) => ({ activeSeconds: 0, checkRuns: 0, checkPasses: 0, hintsRevealed: 0, solutionViewedAt: null, firstOpenedAt: null, lastOpenedAt: null, ...o });

describe('chapterStage', () => {
  const recommended = chapter([exercise('a', true), exercise('b', true), exercise('x'), exercise('y'), exercise('z')]);

  it('grows with the recommended exercises, not with all of them', () => {
    expect(chapterStage(recommended, state())).toBe(0);
    expect(chapterStage(recommended, state(['x']))).toBe(1);
    expect(chapterStage(recommended, state(['a']))).toBe(2);
    expect(chapterStage(recommended, state(['a', 'b']))).toBe(3);
  });

  it('counts half of all exercises without recommended ones', () => {
    const plain = chapter([exercise('a'), exercise('b'), exercise('c'), exercise('d')]);
    expect(chapterStage(plain, state(['a']))).toBe(2);
    expect(chapterStage(plain, state(['a', 'b']))).toBe(3);
  });

  it('needs the checklist answered for the last stage, whatever the rating', () => {
    const c = chapter([exercise('a', true), checklist('q', 2)]);
    const answer = { confidence: 1 as const, note: '', updatedAt: 1 };
    expect(chapterStage(c, state(['a']))).toBe(2);
    expect(chapterStage(c, state(['a'], { checklists: { q: { one: answer } } }))).toBe(2);
    expect(chapterStage(c, state(['a'], { checklists: { q: { one: answer, two: answer } } }))).toBe(3);
  });

  it('starts from a checklist answer too, and leaves empty chapters alone', () => {
    const c = chapter([exercise('a'), checklist('q', 2)]);
    expect(chapterStage(c, state([], { checklists: { q: { one: { confidence: 3, note: '', updatedAt: 1 } } } }))).toBe(1);
    expect(chapterStage(chapter([]), state())).toBe(0);
  });
});

describe('qualifiesFor', () => {
  const outline = (items: never[], threads: Outline['threads'] = []) => ({ chapters: [chapter(items)], threads }) as unknown as Outline;
  const input = (o: Partial<AchievementInput>): AchievementInput => ({ outline: outline([exercise('a'), exercise('b')]), state: state(), reflections: [], checklistRatings: [], noteCount: 0, ...o });
  const rating = (exerciseId: string, confidence: number) => ({ id: 1, exerciseId, confidence, how: [], comment: '', createdAt: 1 }) as never;
  const ids = (i: AchievementInput) => [...qualifiesFor(i).keys()];

  it('gives nothing for nothing', () => {
    expect(ids(input({}))).toEqual([]);
  });

  it('notices a comeback only from low to high, in that order', () => {
    const got = qualifiesFor(input({ reflections: [rating('a', 1), rating('a', 3), rating('a', 4)] }));
    expect(got.get('comeback/e/a')).toEqual({ kind: 'comeback', title: 'a', from: 1, to: 4 });
    expect(got.has('a/first-comeback')).toBe(true);
    expect(ids(input({ reflections: [rating('a', 4), rating('a', 1)] }))).not.toContain('comeback/e/a');
    expect(ids(input({ reflections: [rating('a', 3), rating('a', 5)] }))).not.toContain('comeback/e/a');
  });

  it('notices a comeback on a checklist question', () => {
    const c = outline([checklist('q', 1)]);
    const got = ids(input({ outline: c, checklistRatings: [{ checklistId: 'q', questionId: 'x', confidence: 2 }, { checklistId: 'q', questionId: 'x', confidence: 5 }] }));
    expect(got).toContain('comeback/c/q/x');
  });

  it('rewards an honest low rating', () => {
    expect(ids(input({ reflections: [rating('a', 2)] }))).toContain('a/honest');
    expect(ids(input({ reflections: [rating('a', 3)] }))).not.toContain('a/honest');
  });

  it('counts solving it alone only with tests passed, no hints and no solution', () => {
    const with_ = (s: object) => ids(input({ state: state(['a'], { stats: { a: stats(s) } }) }));
    expect(with_({ checkRuns: 2, checkPasses: 1 })).toContain('a/on-your-own');
    expect(with_({ checkRuns: 2, checkPasses: 1, hintsRevealed: 1 })).not.toContain('a/on-your-own');
    expect(with_({ checkRuns: 2, checkPasses: 1, solutionViewedAt: 5 })).not.toContain('a/on-your-own');
    expect(with_({ checkRuns: 0 })).not.toContain('a/on-your-own');
  });

  it('rewards sticking with it only once it finally passes', () => {
    const with_ = (s: object) => ids(input({ state: state([], { stats: { a: stats(s) } }) }));
    expect(with_({ checkRuns: 6, checkPasses: 1 })).toContain('a/persistent');
    expect(with_({ checkRuns: 9, checkPasses: 0 })).not.toContain('a/persistent');
  });

  it('finishes an adventure with any option of a step, and ignores simple paths', () => {
    const threads = [
      { id: 't', title: 'T', description: null, steps: [['a'], ['b', 'c']], adventure: true, finale: null },
      { id: 'p', title: 'P', description: null, steps: [['a']], adventure: false, finale: null },
    ];
    const got = ids(input({ outline: outline([exercise('a'), exercise('b'), exercise('c')], threads), state: state(['a', 'b']) }));
    expect(got).toContain('adventure/t');
    expect(got).toContain('a/adventurer');
    expect(got).not.toContain('adventure/p');
  });

  it('collects the animal of a finished recommended exercise, and nothing else', () => {
    const animal = (id: string, emoji: string | null, startHere = true) => ({ ...(exercise(id, startHere) as object), emoji }) as never;
    const got = qualifiesFor(input({ outline: outline([animal('a', '🦔'), animal('b', '🦔'), animal('c', null, false)]), state: state(['a', 'c']) }));
    expect(got.get('animal/a')).toEqual({ kind: 'animal', exerciseId: 'a', title: 'a', emoji: '🦔' });
    expect(got.has('animal/b')).toBe(false);
    expect(got.has('animal/c')).toBe(false);
  });

  it('does not reward speed anywhere', () => {
    const got = ids(input({ state: state(['a', 'b'], { stats: { a: stats({ activeSeconds: 1 }), b: stats({ activeSeconds: 999_999 }) } }) }));
    expect(got.filter((k) => k.startsWith('a/')).sort()).toEqual(['a/first-steps', 'a/forest']);
  });
});

describe('Store', () => {
  const event = { kind: 'achievement', id: 'first-steps' } as const;

  it('treats what already qualifies as seen the first time, and new things as unseen after that', () => {
    const store = new Store(':memory:');
    store.syncAchievements(new Map([['a/first-steps', event]]));
    expect(store.listAchievements().map((a) => a.seen)).toEqual([true]);
    store.syncAchievements(new Map([['a/first-steps', event], ['a/curious', { kind: 'achievement', id: 'curious' }]]));
    expect(store.listAchievements().find((a) => a.key === 'a/curious')!.seen).toBe(false);
    store.markAchievementsSeen();
    expect(store.listAchievements().every((a) => a.seen)).toBe(true);
  });

  it('never takes anything away', () => {
    const store = new Store(':memory:');
    store.syncAchievements(new Map([['a/first-steps', event]]));
    store.syncAchievements(new Map());
    expect(store.listAchievements()).toHaveLength(1);
  });

  it('keeps each change of a checklist rating, and nothing else', () => {
    const store = new Store(':memory:');
    store.saveChecklistAnswer('q', 'x', 2, '');
    store.saveChecklistAnswer('q', 'x', 2, 'only the note changed');
    store.saveChecklistAnswer('q', 'x', null, 'rating cleared');
    store.saveChecklistAnswer('q', 'x', 5, '');
    expect(store.listChecklistRatings().map((r) => r.confidence)).toEqual([2, 5]);
  });
});

describe('API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let courses: CourseManager;
  const host = { host: 'localhost' };
  const get = async () => (await app.inject({ method: 'GET', url: '/api/achievements', headers: host })).json<AchievementsResponse>();
  const send = (method: 'PUT' | 'POST', url: string, payload: object = {}) => app.inject({ method, url, headers: host, payload });

  beforeAll(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ach-'));
    const config = { ...loadConfig({ CONTENT_DIR: EXAMPLE_CONTENT, DATA_DIR: dataDir } as NodeJS.ProcessEnv), port: 0 };
    courses = new CourseManager({ config, typstAssets: path.resolve(import.meta.dirname, '../assets/typst') });
    app = await buildApp(makeDeps({ config, courses, pool: new SessionPool(1, 1000), haskellLib: HASKELL_LIB, prologLib: PROLOG_LIB }));
  });
  afterAll(async () => {
    await app.close();
    courses.close();
  });

  it('is off by default: nothing is worked out, and nothing is earned', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/settings', headers: host })).json()).toMatchObject({ showAchievements: false });
    await send('PUT', '/api/progress/side-effects', { status: 'done' });
    expect(await get()).toEqual({ earned: [], unseen: [] });
    expect(courses.active!.store.listAchievements()).toEqual([]);
  });

  it('shows what already qualifies when turned on, without celebrating it', async () => {
    await send('PUT', '/api/settings', { showAchievements: true });
    const r = await get();
    expect(r.earned.map((e) => e.key)).toContain('a/first-steps');
    expect(r.unseen).toEqual([]);
  });

  it('celebrates what comes after that once, and keeps it when the work is undone', async () => {
    await send('PUT', '/api/work/side-effects/question', { content: 'Warum?' });
    expect((await get()).unseen.map((e) => e.key)).toEqual(['a/curious']);
    await send('POST', '/api/achievements/seen');
    expect((await get()).unseen).toEqual([]);
    await send('PUT', '/api/work/side-effects/question', { content: '' });
    expect((await get()).earned.map((e) => e.key)).toContain('a/curious');
  });

  it('says the second of the same animal found a friend, and keeps the animal when reopened', async () => {
    const recommended = courses.active!.content.current.outline.chapters.flatMap((c) => c.items).filter((i) => i.type === 'exercise' && i.startHere) as { id: string; emoji: string }[];
    const emoji = recommended.find((a) => recommended.filter((b) => b.emoji === a.emoji).length > 1)!.emoji;
    const [first, second] = recommended.filter((e) => e.emoji === emoji);
    await send('PUT', `/api/progress/${first!.id}`, { status: 'done' });
    await new Promise((r) => setTimeout(r, 5));
    const one = (await get()).unseen.find((e) => e.key === `animal/${first!.id}`)!;
    expect(one.event).toMatchObject({ kind: 'animal', emoji, friend: false });
    await send('POST', '/api/achievements/seen');
    await send('PUT', `/api/progress/${second!.id}`, { status: 'done' });
    const two = (await get()).unseen.find((e) => e.key === `animal/${second!.id}`)!;
    expect(two.event).toMatchObject({ kind: 'animal', emoji, friend: true });
    await send('PUT', `/api/progress/${first!.id}`, { status: 'todo' });
    expect((await get()).earned.map((e) => e.key)).toContain(`animal/${first!.id}`);
  });

  it('keeps a plant grown when an exercise is reopened', async () => {
    const plants = async () => (await get()).earned.filter((e) => e.key.startsWith('plant/haskell-grundlagen/')).length;
    const before = await plants();
    expect(before).toBeGreaterThan(0);
    await send('PUT', '/api/progress/side-effects', { status: 'todo' });
    expect(await plants()).toBe(before);
  });
});

it('finds the questions of a checklist in the example course', () => {
  const item = loadContent(EXAMPLE_CONTENT).get('selbstevaluation-typklassen')!;
  expect((item.meta as { questionCount: number }).questionCount).toBe(3);
});
