import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/db/migrations.js';
import { Store } from '../src/db/store.js';

const DAY = 86_400_000;
function make() {
  let t = 1_700_000_000_000;
  const store = new Store(':memory:', () => t);
  return { store, tick: (ms: number) => (t += ms), at: () => t };
}

describe('Store', () => {
  it('tracks status and schedules growing review intervals', () => {
    const { store, at, tick } = make();
    expect(store.setStatus('a', 'review').reviewDueAt).toBe(at() + 2 * DAY);
    tick(DAY);
    expect(store.setStatus('a', 'review').reviewDueAt).toBe(at() + 4 * DAY);
    expect(store.setStatus('a', 'done')).toMatchObject({ status: 'done', reviewDueAt: null, reviewCount: 2 });
  });

  it('turns todo into in-progress on first activity only', () => {
    const { store } = make();
    store.noteActivity('a');
    expect(store.getProgress('a')!.status).toBe('in_progress');
    store.setStatus('a', 'done');
    store.noteActivity('a');
    expect(store.getProgress('a')!.status).toBe('done');
  });

  it('keeps answers and a sparse history', () => {
    const { store, tick } = make();
    store.saveAnswer('a', 'X.hs', 'v1');
    store.saveAnswer('a', 'X.hs', 'v2'); // autosave within 5 minutes: no new version
    expect(store.getAnswers('a')).toEqual({ 'X.hs': 'v2' });
    expect(store.listVersions('a', 'X.hs').map((v) => v.content)).toEqual(['v1']);
    store.saveAnswer('a', 'X.hs', 'v3', 'check'); // a meaningful moment: always recorded
    tick(6 * 60_000);
    store.saveAnswer('a', 'X.hs', 'v4'); // old enough
    expect(store.listVersions('a', 'X.hs').map((v) => [v.content, v.reason])).toEqual([
      ['v4', 'autosave'],
      ['v3', 'check'],
      ['v1', 'autosave'],
    ]);
    store.saveAnswer('a', 'X.hs', 'v4', 'check'); // unchanged content: no duplicate
    expect(store.listVersions('a', 'X.hs')).toHaveLength(3);
  });

  it('stores notes and removes them when emptied', () => {
    const { store } = make();
    store.saveNote('a', 'typst', '= Title');
    expect(store.getNote('a')).toMatchObject({ format: 'typst', content: '= Title' });
    store.saveNote('a', 'typst', '   ');
    expect(store.getNote('a')).toBeNull();
  });

  it('records reflections, latest wins in state, history is kept', () => {
    const { store, tick } = make();
    store.addReflection('a', 2, ['hints'], 'hard');
    tick(1000);
    store.addReflection('a', 4, ['alone'], '');
    expect(store.getState().reflections.a!.confidence).toBe(4);
    expect(store.listReflections('a')).toHaveLength(2);
    expect(() => store.addReflection('a', 6, [], '')).toThrow();
  });

  it('accumulates stats with sane limits', () => {
    const { store } = make();
    store.recordOpen('a');
    store.addActiveSeconds('a', 30);
    store.addActiveSeconds('a', 100_000); // a forgotten tab must not inflate time
    store.recordHints('a', 2);
    store.recordHints('a', 1);
    store.recordSolutionViewed('a');
    store.recordCheckRun('a', 3, 5);
    store.recordCheckRun('a', 5, 5);
    expect(store.getStats('a')).toMatchObject({ activeSeconds: 150, hintsRevealed: 2, checkRuns: 2, checkPasses: 1 });
    expect(store.getStats('a').solutionViewedAt).not.toBeNull();
    expect(store.getState().lastOpenedId).toBe('a');
  });

  it('searches notes and answers', () => {
    const { store } = make();
    store.saveNote('a', 'typst', 'Monaden sind Monoide in der Kategorie der Endofunktoren');
    store.saveAnswer('b', 'text', 'Rekursion braucht einen Basisfall');
    expect(store.search('endofunk').map((r) => r.exerciseId)).toEqual(['a']);
    expect(store.search('basisfall')[0]).toMatchObject({ exerciseId: 'b', source: 'answer' });
    expect(store.search('"; DROP TABLE')).toEqual([]);
    store.saveNote('a', 'typst', '');
    expect(store.search('endofunk')).toEqual([]);
  });

  it('gathers the work for the review page', () => {
    const { store } = make();
    store.setStatus('x', 'review');
    store.saveAnswer('x', 'text', 'my answer');
    store.saveNote('x', 'typst', 'my note');
    store.addReflection('x', 2, ['alone'], '');
    store.saveOpenQuestion('x', 'Warum?');
    const data = store.reviewData();
    expect(data.progress.x?.status).toBe('review');
    expect(data.answers.x).toEqual({ text: 'my answer' });
    expect(data.notes.x?.content).toBe('my note');
    expect(data.reflections.map((r) => r.confidence)).toEqual([2]);
    expect(data.openQuestions.x?.content).toBe('Warum?');
  });

  it('always keeps an attempt set aside for trying again, even if nothing changed since the last version', () => {
    const { store } = make();
    store.saveAnswer('x', 'text', 'mein Versuch', 'check');
    store.saveAnswer('x', 'text', 'mein Versuch', 'retry');
    store.saveAnswer('x', 'text', '', 'reset');
    const versions = store.listVersions('x', 'text');
    expect(versions.find((v) => v.reason === 'retry')?.content).toBe('mein Versuch');
    expect(store.getAnswers('x').text).toBe('');
  });

  it('forgets all work on a reset, and keeps the settings and the list of courses', () => {
    const { store } = make();
    store.saveSettings({ displayName: 'Ada', theme: 'dark' });
    store.setValue('courses', [{ id: 'c' }]);
    store.setValue('activeCourse', 'c');
    store.setStatus('x', 'review');
    store.saveAnswer('x', 'text', 'Antwort mit Suchwort', 'check');
    store.saveNote('x', 'typst', 'Notiz');
    store.addReflection('x', 2, ['alone'], '');
    store.saveOpenQuestion('x', 'Warum?');
    store.addActiveSeconds('x', 60);
    store.recordCheckRun('x', 1, 2);
    store.saveChecklistAnswer('q', 'a', 1, 'n');
    store.recordOpen('x');
    store.markLandingSeen();
    store.syncAchievements(new Map([['a/curious', { kind: 'achievement', id: 'curious' }]]));

    store.resetWork();

    const state = store.getState();
    expect(state).toMatchObject({ progress: {}, checklists: {}, openQuestions: {}, reflections: {}, stats: {}, lastOpenedId: null, landingSeen: false, focus: null });
    expect(store.getAnswers('x')).toEqual({});
    expect(store.listVersions('x', 'text')).toEqual([]);
    expect(store.getNote('x')).toBeNull();
    expect(store.listReflections()).toEqual([]);
    expect(store.listChecklistRatings()).toEqual([]);
    expect(store.listAchievements()).toEqual([]);
    expect(store.search('Suchwort')).toEqual([]);
    expect(store.getSettings()).toMatchObject({ displayName: 'Ada', theme: 'dark' });
    expect(store.getValue('courses', [])).toEqual([{ id: 'c' }]);
    expect(store.getValue('activeCourse', '')).toBe('c');
  });

  it('after a reset, what was there before can be earned again, without a burst for what already qualifies', () => {
    const { store } = make();
    const event = { kind: 'achievement', id: 'curious' } as const;
    store.syncAchievements(new Map());
    store.syncAchievements(new Map([['a/curious', event]]));
    expect(store.listAchievements()[0]!.seen).toBe(false);
    store.resetWork();
    store.syncAchievements(new Map());
    store.syncAchievements(new Map([['a/curious', event]]));
    expect(store.listAchievements().map((a) => a.seen)).toEqual([false]);
  });

  it('resets the time of one exercise and leaves the rest alone', () => {
    const { store } = make();
    store.addActiveSeconds('x', 90);
    store.addActiveSeconds('y', 60);
    store.recordHints('x', 2);
    store.resetActiveTime('x');
    expect(store.getStats('x')).toMatchObject({ activeSeconds: 0, hintsRevealed: 2 });
    expect(store.getStats('y').activeSeconds).toBe(60);
    store.resetActiveTime('never-opened');
    expect(store.getStats('never-opened').activeSeconds).toBe(0);
  });

  it('removes saved reviews, the API key and old settings when upgrading, and keeps the work', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-store-')), 'w.db');
    const old = new DatabaseSync(file);
    old.exec(MIGRATIONS[0]!);
    old.exec(MIGRATIONS[1]!);
    old.exec('PRAGMA user_version = 2');
    old.exec(`INSERT INTO settings (key, value) VALUES ('aiKey', '"sk-secret"')`);
    old.exec(`INSERT INTO settings (key, value) VALUES ('settings', '{"displayName":"Ada","aiEnabled":true,"aiProvider":"ollama","authorMode":true}')`);
    old.exec(`INSERT INTO ai_reviews (exercise_id, provider, model, content, created_at) VALUES ('x', 'ollama', 'm', 'r', 1)`);
    old.exec(`INSERT INTO notes (exercise_id, format, content, updated_at) VALUES ('x', 'typst', 'kept', 1)`);
    old.close();

    const store = new Store(file);
    expect(store.getNote('x')?.content).toBe('kept');
    expect(store.getValue('aiKey', 'gone')).toBe('gone');
    const settings = store.getSettings() as unknown as Record<string, unknown>;
    expect(settings.displayName).toBe('Ada');
    expect(settings).not.toHaveProperty('aiEnabled');
    expect(settings).not.toHaveProperty('authorMode');
    store.close();
    const raw = new DatabaseSync(file);
    expect(raw.prepare(`SELECT name FROM sqlite_master WHERE name = 'ai_reviews'`).get()).toBeUndefined();
    expect(JSON.stringify(raw.prepare('SELECT * FROM settings').all())).not.toContain('sk-secret');
    raw.close();
  });

  it('migrates a fresh database and is idempotent on reopen', () => {
    const { store } = make();
    expect(store.getSettings()).toMatchObject({ aiPromptTemplate: '', noteFormat: 'typst' });
    expect(store.saveSettings({ theme: 'dark' }).theme).toBe('dark');
  });

  it('keeps one open question per exercise and resolves it when emptied', () => {
    const { store } = make();
    store.saveOpenQuestion('a', '  Warum der Basisfall?  ');
    expect(store.getState().openQuestions.a?.content).toBe('Warum der Basisfall?');
    store.saveOpenQuestion('a', 'Anders gefragt');
    expect(store.getState().openQuestions.a?.content).toBe('Anders gefragt');
    store.saveOpenQuestion('a', '   ');
    expect(store.getState().openQuestions.a).toBeUndefined();
  });
});
