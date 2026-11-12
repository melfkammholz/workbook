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
    expect(store.search('endofunk').map((r) => r.anchor.id)).toEqual(['a']);
    expect(store.search('basisfall')[0]).toMatchObject({ anchor: { id: 'b' }, source: 'answer' });
    expect(store.search('"; DROP TABLE')).toEqual([]);
    store.saveNote('a', 'typst', '');
    expect(store.search('endofunk')).toEqual([]);
  });

  it('finds questions, in the courses asked for only, and keeps the index current on edit and delete', () => {
    const { store } = make();
    const a = store.forCourse('a');
    const b = store.forCourse('b');
    const q = a.addQuestion({ text: 'Warum terminiert foldr nicht?', anchor: { kind: 'exercise', course: 'a', id: 'x' } });
    b.saveNote('y', 'typst', 'foldr Notiz in b');
    expect(store.search('foldr', { courses: ['a'] })).toEqual([expect.objectContaining({ source: 'question', course: 'a', anchor: expect.objectContaining({ id: 'x', questionId: q.id }) })]);
    expect(store.search('foldr', { courses: ['a', 'b'] })).toHaveLength(2);
    expect(store.search('foldr', { courses: [] })).toEqual([]);
    a.updateQuestion(q.id, { text: 'Warum divergiert zipWith?' });
    expect(store.search('foldr', { courses: ['a'] })).toEqual([]);
    expect(store.search('zipwith', { courses: ['a'] })).toHaveLength(1);
    a.resetWork();
    expect(store.search('zipwith', { courses: ['a'] })).toHaveLength(1);
    a.deleteQuestion(q.id);
    expect(store.search('zipwith', { courses: ['a'] })).toEqual([]);
  });

  it('indexes the text of materials apart from the rest, and drops it with the material', () => {
    const { store } = make();
    store.sql.run("INSERT INTO resources (id, title, type, created_at, updated_at) VALUES ('r1','Skript','notes',1,1)");
    store.sql.run("INSERT INTO resource_text (resource, version, page_index, text) VALUES ('r1','v',3,'Der Satz von Bayes steht hier')");
    expect(store.search('bayes', { courses: [] })).toEqual([]);
    expect(store.search('bayes', { materials: true, courses: [] })).toEqual([expect.objectContaining({ source: 'material', anchor: expect.objectContaining({ resource: 'r1', pageIndex: 3 }) })]);
    store.sql.run("DELETE FROM resources WHERE id = 'r1'");
    expect(store.search('bayes', { materials: true, courses: [] })).toEqual([]);
  });

  it('gathers the work for the review page', () => {
    const { store } = make();
    store.setStatus('x', 'review');
    store.saveAnswer('x', 'text', 'my answer');
    store.saveNote('x', 'typst', 'my note');
    store.addReflection('x', 2, ['alone'], '');
    store.addQuestion({ text: 'Warum?', anchor: { kind: 'exercise', course: '', id: 'x' } });
    const data = store.reviewData();
    expect(data.progress.x?.status).toBe('review');
    expect(data.answers.x).toEqual({ text: 'my answer' });
    expect(data.notes.x?.content).toBe('my note');
    expect(data.reflections.map((r) => r.confidence)).toEqual([2]);
    expect(data.questions.map((q) => q.text)).toEqual(['Warum?']);
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
    store.addQuestion({ text: 'Warum?', anchor: { kind: 'exercise', course: '', id: 'x' } });
    store.addActiveSeconds('x', 60);
    store.recordCheckRun('x', 1, 2);
    store.saveChecklistAnswer('q', 'a', 1, 'n');
    store.recordOpen('x');
    store.markLandingSeen();
    store.syncAchievements(new Map([['a/curious', { kind: 'achievement', id: 'curious' }]]));

    store.resetWork();

    const state = store.getState();
    expect(state).toMatchObject({ progress: {}, checklists: {}, questions: [{ text: 'Warum?' }], reflections: {}, stats: {}, lastOpenedId: null, landingSeen: false, focus: null });
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
    // The work in the main file was the mounted folder's, which is now the course `content`.
    expect(store.forCourse('content').getNote('x')?.content).toBe('kept');
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

  it('keeps questions as a list: edited, done, reopened, deleted', () => {
    let now = 1_000_000;
    const store = new Store(':memory:', () => now);
    const anchor = { kind: 'exercise', course: '', id: 'a' } as const;
    const q1 = store.addQuestion({ text: '  Warum der Basisfall?  ', anchor });
    now += 60_000;
    const q2 = store.addQuestion({ text: 'Und der Schritt?', anchor });
    now += 31 * 60_000;
    const q3 = store.addQuestion({ text: 'Neue Sitzung', anchor });
    expect(q1.text).toBe('Warum der Basisfall?');
    expect(q3.createdAt).toBeGreaterThan(q2.createdAt);
    expect(store.getState().questions.map((q) => q.text)).toEqual(['Warum der Basisfall?', 'Und der Schritt?', 'Neue Sitzung']);
    expect(store.updateQuestion(q1.id, { text: 'Anders gefragt', status: 'done' })).toMatchObject({ text: 'Anders gefragt', status: 'done', doneAt: now });
    expect(store.updateQuestion(q1.id, { status: 'open' })).toMatchObject({ status: 'open', doneAt: null });
    expect(store.listQuestions({ exercise: 'zzz' })).toEqual([]);
    expect(store.deleteQuestion(q2.id)).toBe(true);
    expect(store.deleteQuestion(q2.id)).toBe(false);
    expect(store.getState().questions).toHaveLength(2);
    store.close();
  });

  it('keeps questions when the work of a course is reset', () => {
    const store = new Store(':memory:').forCourse('a');
    store.addQuestion({ text: 'Warum?', anchor: { kind: 'exercise', course: 'a', id: 'x' } });
    store.resetWork();
    expect(store.getState().questions.map((q) => q.text)).toEqual(['Warum?']);
  });
});

describe('migration 7', () => {
  // Development builds of migration 6 came in three shapes. Each must reach the current schema.
  const variants = {
    'first version': '',
    'with used_at': 'ALTER TABLE decks ADD COLUMN used_at INTEGER NOT NULL DEFAULT 0;',
    'with used_at and card_kept': 'ALTER TABLE decks ADD COLUMN used_at INTEGER NOT NULL DEFAULT 0; CREATE TABLE card_kept (card_id TEXT PRIMARY KEY, kept_at INTEGER NOT NULL);',
  };
  for (const [name, extra] of Object.entries(variants)) {
    it(`upgrades a database from the ${name} of migration 6`, () => {
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mig-')), 'workbook.db');
      const db = new DatabaseSync(file);
      for (const step of MIGRATIONS.slice(0, 6)) db.exec(step as string);
      db.exec(extra);
      db.exec('PRAGMA user_version = 6');
      db.close();
      const store = new Store(file);
      expect(store.sql.get('PRAGMA user_version')).toMatchObject({ user_version: MIGRATIONS.length });
      expect((store.sql.all('PRAGMA table_info(decks)') as { name: string }[]).map((c) => c.name)).toContain('used_at');
      expect(store.sql.all("SELECT name FROM sqlite_master WHERE name = 'card_kept'")).toHaveLength(1);
      store.close();
    });
  }
});

/** A database file as an earlier version left it: migrations up to `version` only. */
function oldDatabase(file: string, version: number, sql = ''): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  for (const step of MIGRATIONS.slice(0, version)) {
    if (typeof step === 'string') db.exec(step);
    else step(db);
  }
  db.exec(`PRAGMA user_version = ${version}; ${sql}`);
  db.close();
}

describe('one database for all courses', () => {
  it('keeps the work of two courses apart', () => {
    const { store } = make();
    const a = store.forCourse('a');
    const b = store.forCourse('b');
    a.setStatus('x', 'done');
    a.saveAnswer('x', 'text', 'Antwort in a', 'run');
    a.saveNote('x', 'typst', 'Notiz in a');
    a.addReflection('x', 4, [], '');
    a.recordCheckRun('x', 1, 1);
    a.markLandingSeen();
    const mark = a.addAnnotation({ target: 'x', part: 'task', quote: 'Satz', prefix: '', suffix: '', color: 'yellow' });
    expect(b.getState().progress).toEqual({});
    expect(b.getAnswers('x')).toEqual({});
    expect(b.getNote('x')).toBeNull();
    expect(b.getState().landingSeen).toBe(false);
    expect(b.getAnnotation(mark.id)).toBeNull();
    expect(b.updateAnnotation(mark.id, { color: 'green' })).toBeNull();
    expect(b.search('Notiz')).toEqual([]);
    expect(a.search('Notiz')).toHaveLength(1);
    b.resetWork();
    expect(a.getState().progress.x?.status).toBe('done');
    a.resetWork();
    expect(a.getState().progress).toEqual({});
    expect(a.listAnnotations()).toHaveLength(1);
  });

  it('keeps the settings when a course or course "" is reset', () => {
    const { store } = make();
    store.saveSettings({ displayName: 'Ada' });
    store.setValue('courses', [1]);
    store.forCourse('a').resetWork();
    store.resetWork();
    expect(store.getSettings().displayName).toBe('Ada');
    expect(store.getValue('courses', [])).toEqual([1]);
    // Settings are the same from every view.
    expect(store.forCourse('a').getSettings().displayName).toBe('Ada');
  });

  it('answers every course-scoped query from an index', () => {
    const { store } = make();
    const c = store.forCourse('c');
    c.recordOpen('x');
    c.setStatus('x', 'review');
    c.saveAnswer('x', 'text', 'a', 'run');
    c.listVersions('x', 'text');
    c.saveNote('x', 'typst', 'n');
    c.addReflection('x', 3, [], '');
    c.listReflections('x');
    const q = c.addQuestion({ text: 'q', anchor: { kind: 'exercise', course: 'a', id: 'x' } });
    c.listQuestions({ course: 'a', exercise: 'x' });
    c.updateQuestion(q.id, { status: 'done' });
    c.deleteQuestion(q.id);
    c.saveChecklistAnswer('l', 'q', 3, '');
    c.saveChecklistAnswer('l', 'q', null, '');
    c.listChecklistRatings();
    c.syncAchievements(new Map([['k', { kind: 'first-done' } as never]]));
    c.listAchievements();
    c.markAchievementsSeen();
    const mark = c.addAnnotation({ target: 'x', part: 'task', quote: 'q', prefix: '', suffix: '', color: 'yellow' });
    c.updateAnnotation(mark.id, { comment: 'c' });
    c.deleteAnnotation(mark.id);
    c.resolvedMarkCount();
    c.noteCount();
    c.addActiveSeconds('x', 5);
    c.resetActiveTime('x');
    c.recordHints('x', 1);
    c.recordSolutionViewed('x');
    c.recordCheckRun('x', 1, 2);
    c.getState();
    c.reviewData();
    c.resetWork();

    const tables = ['progress', 'answers', 'answer_versions', 'notes', 'reflections', 'stats', 'check_history', 'questions', 'checklist_answers', 'checklist_ratings', 'achievements', 'annotations', 'settings'];
    const scans: string[] = [];
    const plans = new Map<string, string[]>();
    for (const sql of store.preparedSql) {
      if (!/^\s*(SELECT|INSERT|UPDATE|DELETE)/i.test(sql)) continue;
      const plan = (store.sql.all(`EXPLAIN QUERY PLAN ${sql}`) as { detail: string }[]).map((r) => r.detail);
      plans.set(sql, plan);
      for (const d of plan) if (tables.some((t) => new RegExp(`^SCAN ${t}\\b`).test(d))) scans.push(`${d} in: ${sql}`);
    }
    expect(scans).toEqual([]);
    const latest = [...plans].find(([sql]) => sql.includes('GROUP BY exercise_id'))![1];
    expect(latest.join('\n')).toMatch(/COVERING INDEX reflections_lookup/);
  });
});

describe('importing per-course databases of earlier versions', () => {
  it('copies their work into the one database, under their course', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-import-'));
    const oldA = path.join(dir, 'a.db');
    const oldB = path.join(dir, 'b.db');
    // An old version of the schema: no annotations yet.
    oldDatabase(oldA, 7, `
      INSERT INTO progress (exercise_id, status, updated_at) VALUES ('x', 'done', 1);
      INSERT INTO answers (exercise_id, slot, content, updated_at) VALUES ('x', 'text', 'Apfel', 1);
      INSERT INTO answer_versions (exercise_id, slot, content, reason, created_at) VALUES ('x', 'text', 'A0', 'run', 1), ('x', 'text', 'A1', 'run', 2);
      INSERT INTO reflections (exercise_id, confidence, how, created_at) VALUES ('x', 2, '[]', 1), ('x', 5, '[]', 2);
      INSERT INTO settings (key, value) VALUES ('landingSeen', 'true');
      INSERT INTO open_questions (exercise_id, content, updated_at) VALUES ('x', 'Warum?', 1);
    `);
    oldDatabase(oldB, 9, `
      INSERT INTO progress (exercise_id, status, updated_at) VALUES ('x', 'in_progress', 1);
      INSERT INTO reflections (exercise_id, confidence, how, created_at) VALUES ('x', 1, '[]', 1);
      INSERT INTO annotations (id, target, part, quote, prefix, suffix, color, created_at, updated_at, label) VALUES ('m1', 'x', 'task', 'Satz', '', '', 'yellow', 1, 1, 'l');
    `);
    const bytes = fs.readFileSync(oldA);

    const store = new Store(path.join(dir, 'workbook.db'));
    store.forCourse('b').addReflection('y', 3, [], ''); // ids of the new database are taken already
    expect(store.forCourse('a').importLegacy(oldA)).toBe(true);
    expect(store.forCourse('b').importLegacy(oldB)).toBe(true);
    expect(store.forCourse('a').importLegacy(oldA)).toBe(false);

    const a = store.forCourse('a');
    const b = store.forCourse('b');
    expect(a.getState().progress.x?.status).toBe('done');
    expect(a.getState().landingSeen).toBe(true);
    expect(a.getState().reflections.x?.confidence).toBe(5);
    expect(a.getState().questions).toMatchObject([{ text: 'Warum?', course: 'a', anchor: { kind: 'exercise', course: 'a', id: 'x' } }]);
    expect(b.getState().questions).toEqual([]);
    expect(a.listVersions('x', 'text').map((v) => v.content)).toEqual(['A1', 'A0']);
    expect(a.search('Apfel')).toHaveLength(1);
    expect(b.getState().progress.x?.status).toBe('in_progress');
    expect(b.getState().reflections.x?.confidence).toBe(1);
    expect(b.getAnnotation('m1')).toMatchObject({ quote: 'Satz', label: 'l' });
    expect(a.getAnnotation('m1')).toBeNull();
    expect(b.getState().landingSeen).toBe(false);
    // The old file is left as it was.
    expect(fs.readFileSync(oldA).equals(bytes)).toBe(true);
    expect(fs.readdirSync(dir).filter((f) => f.includes('importing'))).toEqual([]);
    store.close();
  });

  it('imports nothing from a file that is not a database', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-import-'));
    const bad = path.join(dir, 'bad.db');
    fs.writeFileSync(bad, 'not a database at all, just some text that is long enough');
    const store = new Store(path.join(dir, 'workbook.db'));
    expect(() => store.forCourse('a').importLegacy(bad)).toThrow();
    expect(fs.readFileSync(bad, 'utf8')).toContain('not a database');
    expect(store.forCourse('a').getState().progress).toEqual({});
    store.close();
  });
});

describe('migration 16', () => {
  it('moves the highlight labels and the page marks out of the settings, keeping ids and order', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-m16-'));
    const file = path.join(dir, 'workbook.db');
    const settings = { displayName: 'Ada', highlightLabels: [{ id: 'l1', name: 'Wichtig', color: '#ff0000' }, { id: 'l2', name: '', color: 'blue' }], pdfPageMarks: [{ id: 'm1', name: 'Klausur' }, { id: 'm2', name: 'Unklar' }] };
    oldDatabase(file, 15, `INSERT INTO settings (course, key, value) VALUES ('', 'settings', '${JSON.stringify(settings)}')`);
    const store = new Store(file);
    const got = store.getSettings();
    expect(got.displayName).toBe('Ada');
    expect(got.highlightLabels).toEqual([{ id: 'l1', name: 'Wichtig', color: '#ff0000' }, { id: 'l2', name: '', color: 'blue' }]);
    expect(got.pdfPageMarks).toEqual([{ id: 'm1', name: 'Klausur' }, { id: 'm2', name: 'Unklar' }]);
    expect(String(store.sql.get("SELECT value FROM settings WHERE course = '' AND key = 'settings'")!.value)).not.toContain('Wichtig');
    // Changing one list leaves the other alone.
    store.saveSettings({ pdfPageMarks: [{ id: 'm2', name: 'Unklar!' }] });
    expect(store.getSettings().highlightLabels).toHaveLength(2);
    expect(store.getSettings().pdfPageMarks).toEqual([{ id: 'm2', name: 'Unklar!' }]);
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('migration 17', () => {
  it('turns each open question into a question anchored to its exercise', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-m17-'));
    const file = path.join(dir, 'workbook.db');
    oldDatabase(file, 16, `INSERT INTO open_questions (course, exercise_id, content, updated_at) VALUES ('c1', 'e1', 'Warum?', 5), ('c2', 'e1', 'Wie?', 6)`);
    const store = new Store(file);
    expect(store.forCourse('c1').getState().questions).toMatchObject([{ text: 'Warum?', status: 'open', course: 'c1', anchor: { kind: 'exercise', course: 'c1', id: 'e1' }, createdAt: 5 }]);
    expect(store.listQuestions().map((q) => q.text)).toEqual(['Warum?', 'Wie?']);
    expect(store.sql.get("SELECT name FROM sqlite_master WHERE name = 'open_questions'")).toBeUndefined();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
