import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import {
  DEFAULT_SETTINGS,
  type AchievementEvent,
  type Annotation,
  type AnnotationColor,
  type AnnotationPlace,
  type AnnotationReview,
  type AnswerVersion,
  type ChecklistAnswer,
  type EarnedEvent,
  type Focus,
  type HowSolved,
  type NoteDoc,
  type NoteFormat,
  type OpenQuestion,
  type ProgressEntry,
  type Reflection,
  type ReviewData,
  type Settings,
  type Stats,
  type Status,
  type StudentState,
  type TextQuote,
} from '@wb/shared';
import { COURSE_TABLES, GLOBAL_KEYS, migrate } from './migrations.js';

const DAY = 86_400_000;
/** Review intervals in days: how long "review later" waits, growing each time it is chosen again. */
const REVIEW_DAYS = [2, 4, 8, 16, 30];
/** An autosave only becomes a history entry if the last one is at least this old. */
const VERSION_MIN_GAP = 5 * 60_000;
const MAX_VERSIONS = 60;
/** One tick from the client is at most this many seconds, so a forgotten open tab cannot inflate time spent. */
const MAX_TICK_SECONDS = 120;

type Row = Record<string, unknown>;
type SearchSource = 'note' | 'answer' | 'annotation';
/** Course of the rows that belong to the student rather than to a course. */
const GLOBAL = '';

/** The one SQLite file, shared by every view of it. */
class Db {
  readonly raw: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private readonly optimizer: NodeJS.Timeout;
  inTx = false;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;
      PRAGMA cache_size = -16000; PRAGMA temp_store = MEMORY; PRAGMA mmap_size = 268435456;`);
    migrate(this.raw);
    this.optimizer = setInterval(() => this.optimize(), DAY);
    this.optimizer.unref();
  }

  /** Statements are prepared once per SQL text. */
  prepare(sql: string): StatementSync {
    let st = this.statements.get(sql);
    if (!st) {
      st = this.raw.prepare(sql);
      this.statements.set(sql, st);
    }
    return st;
  }

  /** Every SQL text prepared so far, for tests that look at query plans. */
  get prepared(): string[] {
    return [...this.statements.keys()];
  }

  tx<T>(fn: () => T): T {
    if (this.inTx) return fn();
    this.raw.exec('BEGIN');
    this.inTx = true;
    try {
      const r = fn();
      this.raw.exec('COMMIT');
      return r;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    } finally {
      this.inTx = false;
    }
  }

  private optimize(): void {
    try {
      this.raw.exec('PRAGMA optimize');
    } catch {
      /* only a hint for the query planner */
    }
  }

  close(): void {
    clearInterval(this.optimizer);
    this.optimize();
    this.statements.clear();
    this.raw.close();
  }
}

/**
 * All student data, in one SQLite file.
 *
 * `new Store(file)` opens the file; its own methods see the rows of course '' (settings, the course list, decks).
 * `forCourse(id)` is a view of the same file with the same methods, scoped to one course: courses keep their work
 * apart, because their exercise ids may clash.
 */
export class Store {
  private readonly db: Db;
  private readonly owner: boolean;

  constructor(file: string | Db, private readonly now: () => number = Date.now, readonly course: string = GLOBAL) {
    this.owner = typeof file === 'string';
    this.db = typeof file === 'string' ? new Db(file) : file;
  }

  /** The work of one course. Settings and other global values stay shared with this store. */
  forCourse(course: string): Store {
    return new Store(this.db, this.now, course);
  }

  /** Closes the file; a course's view leaves it to the store it came from. */
  close(): void {
    if (this.owner) this.db.close();
  }

  /** Every SQL text prepared so far, for tests that look at query plans. */
  get preparedSql(): string[] {
    return this.db.prepared;
  }

  /** Runs `fn` atomically. Re-entrant: a nested call simply joins the outer transaction. */
  private tx<T>(fn: () => T): T {
    return this.db.tx(fn);
  }

  private all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }
  private get(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }
  private run(sql: string, ...params: SQLInputValue[]): void {
    this.db.prepare(sql).run(...params);
  }

  /** For the flashcards, which keep their own tables in the main database. */
  get sql() {
    return {
      all: (q: string, ...params: SQLInputValue[]) => this.all(q, ...params),
      get: (q: string, ...params: SQLInputValue[]) => this.get(q, ...params),
      run: (q: string, ...params: SQLInputValue[]) => this.run(q, ...params),
      tx: <T>(fn: () => T) => this.tx(fn),
    };
  }

  // ───────────────────────── state ─────────────────────────

  getState(): StudentState {
    const c = this.course;
    const progress: Record<string, ProgressEntry> = {};
    for (const r of this.all('SELECT * FROM progress WHERE course = ?', c)) progress[r.exercise_id as string] = rowToProgress(r);

    const reflections: Record<string, Reflection> = {};
    for (const r of this.all(
      'SELECT * FROM reflections WHERE id IN (SELECT MAX(id) FROM reflections WHERE course = ? GROUP BY exercise_id)',
      c,
    ))
      reflections[r.exercise_id as string] = rowToReflection(r);

    const stats: Record<string, Stats> = {};
    for (const r of this.all('SELECT * FROM stats WHERE course = ?', c)) stats[r.exercise_id as string] = rowToStats(r);

    const checklists: StudentState['checklists'] = {};
    for (const r of this.all('SELECT * FROM checklist_answers WHERE course = ?', c))
      (checklists[r.checklist_id as string] ??= {})[r.question_id as string] = {
        confidence: r.confidence === null ? null : (Number(r.confidence) as ChecklistAnswer['confidence']),
        note: r.note as string,
        updatedAt: Number(r.updated_at),
      };

    return {
      progress,
      checklists,
      landingSeen: this.getSettingRaw<boolean>('landingSeen', false),
      focus: this.getSettingRaw<Focus | null>('focus', null),
      openQuestions: this.allOpenQuestions(),
      reflections,
      stats,
      lastOpenedId: this.getSettingRaw<string | null>('lastOpenedId', null),
    };
  }

  // ───────────────────────── progress ─────────────────────────

  getProgress(id: string): ProgressEntry | null {
    const r = this.get('SELECT * FROM progress WHERE course = ? AND exercise_id = ?', this.course, id);
    return r ? rowToProgress(r) : null;
  }

  setStatus(id: string, status: Status): ProgressEntry {
    const prev = this.getProgress(id);
    const t = this.now();
    let reviewCount = prev?.reviewCount ?? 0;
    let due: number | null = null;
    if (status === 'review') {
      reviewCount += 1;
      due = t + REVIEW_DAYS[Math.min(reviewCount - 1, REVIEW_DAYS.length - 1)]! * DAY;
    }
    this.run(
      `INSERT INTO progress (course, exercise_id, status, updated_at, review_due_at, review_count) VALUES (?,?,?,?,?,?)
       ON CONFLICT(course, exercise_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at,
         review_due_at=excluded.review_due_at, review_count=excluded.review_count`,
      this.course,
      id,
      status,
      t,
      due,
      reviewCount,
    );
    return this.getProgress(id)!;
  }

  /** Called when the student starts working: a "todo" exercise becomes "in progress". */
  noteActivity(id: string): void {
    const p = this.getProgress(id);
    if (!p) this.setStatus(id, 'in_progress');
    else if (p.status === 'todo') this.setStatus(id, 'in_progress');
  }

  // ───────────────────────── answers ─────────────────────────

  getAnswers(id: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of this.all('SELECT slot, content FROM answers WHERE course = ? AND exercise_id = ?', this.course, id)) out[r.slot as string] = r.content as string;
    return out;
  }

  /**
   * Saves the current content of an answer slot. History entries are only
   * written for meaningful moments (`reason` ≠ autosave) or when the last one
   * is old enough, so typing does not flood the history.
   */
  saveAnswer(id: string, slot: string, content: string, reason = 'autosave'): void {
    const c = this.course;
    const t = this.now();
    const prev = this.get('SELECT content FROM answers WHERE course = ? AND exercise_id = ? AND slot = ?', c, id, slot);
    if (prev?.content === content && reason === 'autosave') return;
    this.tx(() => {
      this.run(
        `INSERT INTO answers (course, exercise_id, slot, content, updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(course, exercise_id, slot) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at`,
        c,
        id,
        slot,
        content,
        t,
      );
      const last = this.get(
        'SELECT content, created_at FROM answer_versions WHERE course = ? AND exercise_id = ? AND slot = ? ORDER BY id DESC LIMIT 1',
        c,
        id,
        slot,
      );
      const changed = last?.content !== content;
      const due = reason !== 'autosave' || !last || t - Number(last.created_at) >= VERSION_MIN_GAP;
      // An attempt set aside for trying again is always kept as such, even if it is the same as the last version.
      if ((changed && due) || reason === 'retry') {
        this.run('INSERT INTO answer_versions (course, exercise_id, slot, content, reason, created_at) VALUES (?,?,?,?,?,?)', c, id, slot, content, reason, t);
        this.run(
          `DELETE FROM answer_versions WHERE course = ? AND exercise_id = ? AND slot = ? AND id NOT IN
             (SELECT id FROM answer_versions WHERE course = ? AND exercise_id = ? AND slot = ? ORDER BY id DESC LIMIT ?)`,
          c,
          id,
          slot,
          c,
          id,
          slot,
          MAX_VERSIONS,
        );
      }
      this.reindex(id, 'answer', Object.values(this.getAnswers(id)).join('\n\n'));
    });
  }

  listVersions(id: string, slot: string): AnswerVersion[] {
    return this.all(
      'SELECT id, slot, content, reason, created_at FROM answer_versions WHERE course = ? AND exercise_id = ? AND slot = ? ORDER BY id DESC',
      this.course,
      id,
      slot,
    ).map((r) => ({
      id: Number(r.id),
      slot: r.slot as string,
      content: r.content as string,
      reason: r.reason as string,
      createdAt: Number(r.created_at),
    }));
  }

  // ───────────────────────── notes ─────────────────────────

  getNote(id: string): NoteDoc | null {
    const r = this.get('SELECT format, content, updated_at FROM notes WHERE course = ? AND exercise_id = ?', this.course, id);
    return r ? { format: r.format as NoteFormat, content: r.content as string, updatedAt: Number(r.updated_at) } : null;
  }

  saveNote(id: string, format: NoteFormat, content: string): void {
    this.tx(() => {
      if (content.trim() === '') {
        this.run('DELETE FROM notes WHERE course = ? AND exercise_id = ?', this.course, id);
      } else {
        this.run(
          `INSERT INTO notes (course, exercise_id, format, content, updated_at) VALUES (?,?,?,?,?)
           ON CONFLICT(course, exercise_id) DO UPDATE SET format=excluded.format, content=excluded.content, updated_at=excluded.updated_at`,
          this.course,
          id,
          format,
          content,
          this.now(),
        );
      }
      this.reindex(id, 'note', content);
    });
  }

  // ───────────────────────── reflections ─────────────────────────

  addReflection(id: string, confidence: number, how: HowSolved[], comment: string): Reflection {
    if (!Number.isInteger(confidence) || confidence < 1 || confidence > 5) throw new RangeError('confidence must be 1–5');
    this.run(
      'INSERT INTO reflections (course, exercise_id, confidence, how, comment, created_at) VALUES (?,?,?,?,?,?)',
      this.course,
      id,
      confidence,
      JSON.stringify(how),
      comment.slice(0, 2000),
      this.now(),
    );
    return rowToReflection(this.get('SELECT * FROM reflections WHERE course = ? AND exercise_id = ? ORDER BY id DESC LIMIT 1', this.course, id)!);
  }

  listReflections(id?: string): Reflection[] {
    const rows = id
      ? this.all('SELECT * FROM reflections WHERE course = ? AND exercise_id = ? ORDER BY id', this.course, id)
      : this.all('SELECT * FROM reflections WHERE course = ? ORDER BY id', this.course);
    return rows.map(rowToReflection);
  }

  // ───────────────────────── open questions ─────────────────────────

  private allOpenQuestions(): Record<string, OpenQuestion> {
    const out: Record<string, OpenQuestion> = {};
    for (const r of this.all('SELECT * FROM open_questions WHERE course = ?', this.course))
      out[r.exercise_id as string] = { content: r.content as string, updatedAt: Number(r.updated_at) };
    return out;
  }

  /** An empty question removes it: that is how a question gets resolved. */
  saveOpenQuestion(id: string, content: string): void {
    const text = content.trim().slice(0, 2000);
    if (!text) {
      this.run('DELETE FROM open_questions WHERE course = ? AND exercise_id = ?', this.course, id);
      return;
    }
    this.run(
      `INSERT INTO open_questions (course, exercise_id, content, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(course, exercise_id) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at`,
      this.course,
      id,
      text,
      this.now(),
    );
  }

  // ───────────────────────── checklists ─────────────────────────

  /** Clearing both the rating and the note removes the answer. */
  saveChecklistAnswer(checklistId: string, questionId: string, confidence: number | null, note: string): void {
    if (confidence !== null && (!Number.isInteger(confidence) || confidence < 1 || confidence > 5)) throw new RangeError('confidence must be 1–5');
    const c = this.course;
    const text = note.slice(0, 4000);
    // Kept whatever the settings say, so a comeback can be noticed if achievements are turned on later.
    const previous = this.get('SELECT confidence FROM checklist_answers WHERE course = ? AND checklist_id = ? AND question_id = ?', c, checklistId, questionId);
    if (confidence !== null && previous?.confidence !== confidence)
      this.run('INSERT INTO checklist_ratings (course, checklist_id, question_id, confidence, created_at) VALUES (?,?,?,?,?)', c, checklistId, questionId, confidence, this.now());
    if (confidence === null && !text.trim()) {
      this.run('DELETE FROM checklist_answers WHERE course = ? AND checklist_id = ? AND question_id = ?', c, checklistId, questionId);
      return;
    }
    this.run(
      `INSERT INTO checklist_answers (course, checklist_id, question_id, confidence, note, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(course, checklist_id, question_id) DO UPDATE SET confidence=excluded.confidence, note=excluded.note, updated_at=excluded.updated_at`,
      c,
      checklistId,
      questionId,
      confidence,
      text,
      this.now(),
    );
  }

  listChecklistRatings(): { checklistId: string; questionId: string; confidence: number }[] {
    return this.all('SELECT checklist_id, question_id, confidence FROM checklist_ratings WHERE course = ? ORDER BY id', this.course).map((r) => ({
      checklistId: r.checklist_id as string,
      questionId: r.question_id as string,
      confidence: Number(r.confidence),
    }));
  }

  // ───────────────────────── annotations ─────────────────────────

  listAnnotations(target?: string): Annotation[] {
    const rows = target
      ? this.all('SELECT * FROM annotations WHERE course = ? AND target = ? ORDER BY created_at, id', this.course, target)
      : this.all('SELECT * FROM annotations WHERE course = ? ORDER BY created_at, id', this.course);
    return rows.map(rowToAnnotation);
  }

  getAnnotation(id: string): Annotation | null {
    const r = this.get('SELECT * FROM annotations WHERE id = ? AND course = ?', id, this.course);
    return r ? rowToAnnotation(r) : null;
  }

  addAnnotation(a: AnnotationPlace & TextQuote & { id?: string; color: AnnotationColor; label?: string | null; comment?: string; review?: AnnotationReview | null }): Annotation {
    const id = a.id ?? randomUUID();
    const t = this.now();
    this.tx(() => {
      this.run(
        'INSERT INTO annotations (course, id, target, part, quote, prefix, suffix, color, label, comment, review, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        this.course,
        id,
        a.target,
        a.part,
        a.quote,
        a.prefix,
        a.suffix,
        a.color,
        a.label ?? null,
        (a.comment ?? '').slice(0, 4000),
        a.review ?? null,
        t,
        t,
      );
      this.reindexAnnotations(a.target);
    });
    return this.getAnnotation(id)!;
  }

  /** Null when there is no such annotation. */
  updateAnnotation(id: string, patch: { color?: AnnotationColor; label?: string | null; comment?: string; review?: AnnotationReview | null }): Annotation | null {
    const prev = this.getAnnotation(id);
    if (!prev) return null;
    const next = { ...prev, ...patch, comment: (patch.comment ?? prev.comment).slice(0, 4000) };
    this.tx(() => {
      this.run(
        'UPDATE annotations SET color = ?, label = ?, comment = ?, review = ?, updated_at = ? WHERE id = ? AND course = ?',
        next.color,
        next.label,
        next.comment,
        next.review,
        this.now(),
        id,
        this.course,
      );
      this.reindexAnnotations(prev.target);
    });
    return this.getAnnotation(id);
  }

  deleteAnnotation(id: string): boolean {
    const prev = this.getAnnotation(id);
    if (!prev) return false;
    this.tx(() => {
      this.run('DELETE FROM annotations WHERE id = ? AND course = ?', id, this.course);
      this.reindexAnnotations(prev.target);
    });
    return true;
  }

  /** Quotes and comments are found by search, under the text they belong to. */
  private reindexAnnotations(target: string): void {
    const text = this.listAnnotations(target)
      .map((a) => (a.comment ? `${a.quote}\n${a.comment}` : a.quote))
      .join('\n\n');
    this.reindex(target, 'annotation', text);
  }

  resolvedMarkCount(): number {
    return Number(this.get("SELECT COUNT(*) AS n FROM annotations WHERE course = ? AND review = 'resolved'", this.course)!.n);
  }

  noteCount(): number {
    return Number(this.get('SELECT COUNT(*) AS n FROM notes WHERE course = ?', this.course)!.n);
  }

  // ───────────────────────── achievements ─────────────────────────

  /**
   * Records what was newly earned. Earned stays earned: nothing is ever removed here.
   * The first time in a course, what already qualifies counts as seen, so turning
   * this on does not set off a burst of celebrations.
   */
  syncAchievements(qualifying: Map<string, AchievementEvent>): void {
    const first = !this.getSettingRaw<boolean>('achievementsStarted', false);
    this.tx(() => {
      for (const [key, event] of qualifying)
        this.run('INSERT OR IGNORE INTO achievements (course, key, earned_at, seen, event) VALUES (?,?,?,?,?)', this.course, key, this.now(), first ? 1 : 0, JSON.stringify(event));
      if (first) this.setSetting('achievementsStarted', true);
    });
  }

  listAchievements(): (EarnedEvent & { seen: boolean })[] {
    return this.all('SELECT * FROM achievements WHERE course = ? ORDER BY earned_at, key', this.course).map((r) => ({
      key: r.key as string,
      earnedAt: Number(r.earned_at),
      seen: Number(r.seen) === 1,
      event: JSON.parse(r.event as string) as AchievementEvent,
    }));
  }

  markAchievementsSeen(): void {
    this.run('UPDATE achievements SET seen = 1 WHERE course = ? AND seen = 0', this.course);
  }

  markLandingSeen(): void {
    this.setSetting('landingSeen', true);
  }

  /** Per course, like all work: a student may want all of one course and the essentials of another. */
  setFocus(focus: Focus): void {
    this.setSetting('focus', focus);
  }

  // ───────────────────────── stats ─────────────────────────

  private ensureStats(id: string): void {
    this.run('INSERT OR IGNORE INTO stats (course, exercise_id) VALUES (?,?)', this.course, id);
  }

  getStats(id: string): Stats {
    const r = this.get('SELECT * FROM stats WHERE course = ? AND exercise_id = ?', this.course, id);
    return r ? rowToStats(r) : emptyStats();
  }

  recordOpen(id: string): void {
    const t = this.now();
    this.tx(() => {
      this.ensureStats(id);
      this.run('UPDATE stats SET last_opened_at = ?, first_opened_at = COALESCE(first_opened_at, ?) WHERE course = ? AND exercise_id = ?', t, t, this.course, id);
      this.setSetting('lastOpenedId', id);
    });
  }

  addActiveSeconds(id: string, seconds: number): void {
    const s = Math.max(0, Math.min(MAX_TICK_SECONDS, Math.floor(seconds)));
    if (s === 0) return;
    this.ensureStats(id);
    this.run('UPDATE stats SET active_seconds = active_seconds + ? WHERE course = ? AND exercise_id = ?', s, this.course, id);
  }

  /** The student's own choice, from the timer. Nothing else about the exercise changes. */
  resetActiveTime(id: string): void {
    this.run('UPDATE stats SET active_seconds = 0 WHERE course = ? AND exercise_id = ?', this.course, id);
  }

  /** `count` is how many hints are now visible; only ever grows. */
  recordHints(id: string, count: number): void {
    this.ensureStats(id);
    this.run('UPDATE stats SET hints_revealed = MAX(hints_revealed, ?) WHERE course = ? AND exercise_id = ?', Math.max(0, Math.floor(count)), this.course, id);
  }

  recordSolutionViewed(id: string): void {
    this.ensureStats(id);
    this.run('UPDATE stats SET solution_viewed_at = COALESCE(solution_viewed_at, ?) WHERE course = ? AND exercise_id = ?', this.now(), this.course, id);
  }

  recordCheckRun(id: string, passed: number, total: number): void {
    this.tx(() => {
      this.ensureStats(id);
      this.run('INSERT INTO check_history (course, exercise_id, at, passed, total) VALUES (?,?,?,?,?)', this.course, id, this.now(), passed, total);
      this.run(
        'UPDATE stats SET check_runs = check_runs + 1, check_passes = check_passes + ? WHERE course = ? AND exercise_id = ?',
        total > 0 && passed === total ? 1 : 0,
        this.course,
        id,
      );
    });
  }

  // ───────────────────────── settings ─────────────────────────

  /** The student's settings, the same from every view. */
  getSettings(): Settings {
    return { ...DEFAULT_SETTINGS, ...this.getRaw<Partial<Settings>>(GLOBAL, 'settings', {}) };
  }

  saveSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.getSettings(), ...patch };
    this.setRaw(GLOBAL, 'settings', next);
    return next;
  }

  /** Forgets all work in this course, and nothing else. */
  resetWork(): void {
    this.tx(() => {
      for (const table of COURSE_TABLES) if (table !== 'settings') this.run(`DELETE FROM ${table} WHERE course = ?`, this.course);
      // Course '' is also where the student's own values live.
      this.run(`DELETE FROM settings WHERE course = ? AND key NOT IN (${GLOBAL_KEYS.map(() => '?').join(',')})`, this.course, ...GLOBAL_KEYS);
    });
  }

  /** Back to the defaults, as on the first start. */
  resetSettings(): void {
    this.run("DELETE FROM settings WHERE course = '' AND key = 'settings'");
  }

  /** A named value outside the student's settings and outside any course, e.g. the list of courses. */
  getValue<T>(key: string, fallback: T): T {
    return this.getRaw(GLOBAL, key, fallback);
  }

  setValue(key: string, value: unknown): void {
    this.setRaw(GLOBAL, key, value);
  }

  /** A value of this course, e.g. which exercise was open last. */
  private getSettingRaw<T>(key: string, fallback: T): T {
    return this.getRaw(this.course, key, fallback);
  }

  private setSetting(key: string, value: unknown): void {
    this.setRaw(this.course, key, value);
  }

  private getRaw<T>(course: string, key: string, fallback: T): T {
    const r = this.get('SELECT value FROM settings WHERE course = ? AND key = ?', course, key);
    if (!r) return fallback;
    try {
      return JSON.parse(r.value as string) as T;
    } catch {
      return fallback;
    }
  }

  private setRaw(course: string, key: string, value: unknown): void {
    this.run(
      'INSERT INTO settings (course, key, value) VALUES (?, ?, ?) ON CONFLICT(course, key) DO UPDATE SET value = excluded.value',
      course,
      key,
      JSON.stringify(value),
    );
  }

  // ───────────────────────── search ─────────────────────────

  private reindex(id: string, source: SearchSource, text: string): void {
    this.run('DELETE FROM search WHERE course = ? AND exercise_id = ? AND source = ?', this.course, id, source);
    if (text.trim()) this.run('INSERT INTO search (course, exercise_id, source, content) VALUES (?,?,?,?)', this.course, id, source, text);
  }

  /** Full-text search over the student's own notes, answers and annotations. `exerciseId` is an annotation's target. */
  search(query: string, limit = 20): { exerciseId: string; source: SearchSource; snippet: string }[] {
    const terms = query.match(/[\p{L}\p{N}_]+/gu);
    if (!terms) return [];
    const match = terms.map((t) => `"${t}"*`).join(' ');
    return this.all(
      `SELECT exercise_id, source, snippet(search, 3, '«', '»', '…', 12) AS snippet
       FROM search WHERE search MATCH ? AND course = ? ORDER BY rank LIMIT ?`,
      match,
      this.course,
      limit,
    ).map((r) => ({ exerciseId: r.exercise_id as string, source: r.source as SearchSource, snippet: r.snippet as string }));
  }

  // ───────────────────────── review ─────────────────────────

  reviewData(): Omit<ReviewData, 'checklists'> {
    const state = this.getState();
    const answers: ReviewData['answers'] = {};
    for (const r of this.all('SELECT exercise_id, slot, content FROM answers WHERE course = ?', this.course))
      (answers[r.exercise_id as string] ??= {})[r.slot as string] = r.content as string;
    const notes: ReviewData['notes'] = {};
    for (const r of this.all('SELECT exercise_id, format, content, updated_at FROM notes WHERE course = ?', this.course))
      notes[r.exercise_id as string] = { format: r.format as NoteFormat, content: r.content as string, updatedAt: Number(r.updated_at) };
    return { progress: state.progress, reflections: this.listReflections(), openQuestions: state.openQuestions, stats: state.stats, answers, notes };
  }

  // ───────────────────────── old databases ─────────────────────────

  /**
   * Copies the work in an old per-course database file into this course, in one transaction. The file itself
   * is not changed: a copy of it is brought up to the current schema first. Throws if anything fails; then
   * nothing was imported. Returns false if this course already holds an import.
   */
  importLegacy(file: string): boolean {
    if (this.getSettingRaw<boolean>('legacyImported', false)) return false;
    const tmp = `${file}.${randomUUID().slice(0, 8)}.importing`;
    const parts = ['', '-wal'];
    try {
      for (const p of parts) if (fs.existsSync(file + p)) fs.copyFileSync(file + p, tmp + p);
      const old = new DatabaseSync(tmp);
      try {
        migrate(old);
      } finally {
        old.close();
      }
      this.db.raw.prepare('ATTACH DATABASE ? AS legacy').run(tmp);
      try {
        this.tx(() => {
          for (const table of COURSE_TABLES) {
            const columns = (this.db.raw.prepare(`PRAGMA legacy.table_info(${table})`).all() as { name: string; pk: number; type: string }[])
              // Numbered rows get new numbers here, in the same order.
              .filter((col) => col.name !== 'course' && !(col.name === 'id' && col.type === 'INTEGER'))
              .map((col) => col.name)
              .join(', ');
            const where = table === 'settings' ? `WHERE key NOT IN (${GLOBAL_KEYS.map(() => '?').join(',')})` : '';
            this.db.raw
              .prepare(`INSERT INTO main.${table} (course, ${columns}) SELECT ?, ${columns} FROM legacy.${table} ${where} ORDER BY rowid`)
              .run(this.course, ...(table === 'settings' ? GLOBAL_KEYS : []));
          }
          this.setSetting('legacyImported', true);
        });
      } finally {
        this.db.raw.exec('DETACH DATABASE legacy');
      }
      return true;
    } finally {
      for (const p of [...parts, '-shm']) fs.rmSync(tmp + p, { force: true });
    }
  }
}

// ───────────────────────── row mapping ─────────────────────────

function rowToProgress(r: Row): ProgressEntry {
  return {
    status: r.status as Status,
    updatedAt: Number(r.updated_at),
    reviewDueAt: r.review_due_at === null ? null : Number(r.review_due_at),
    reviewCount: Number(r.review_count),
  };
}

function rowToReflection(r: Row): Reflection {
  return {
    id: Number(r.id),
    exerciseId: r.exercise_id as string,
    confidence: Number(r.confidence) as Reflection['confidence'],
    how: JSON.parse(r.how as string) as HowSolved[],
    comment: r.comment as string,
    createdAt: Number(r.created_at),
  };
}

function rowToAnnotation(r: Row): Annotation {
  return {
    id: r.id as string,
    target: r.target as string,
    part: r.part as string,
    quote: r.quote as string,
    prefix: r.prefix as string,
    suffix: r.suffix as string,
    color: r.color as AnnotationColor,
    label: (r.label as string | null) ?? null,
    comment: r.comment as string,
    review: (r.review as AnnotationReview | null) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function emptyStats(): Stats {
  return { activeSeconds: 0, checkRuns: 0, checkPasses: 0, hintsRevealed: 0, solutionViewedAt: null, firstOpenedAt: null, lastOpenedAt: null };
}

function rowToStats(r: Row): Stats {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    activeSeconds: Number(r.active_seconds),
    checkRuns: Number(r.check_runs),
    checkPasses: Number(r.check_passes),
    hintsRevealed: Number(r.hints_revealed),
    solutionViewedAt: n(r.solution_viewed_at),
    firstOpenedAt: n(r.first_opened_at),
    lastOpenedAt: n(r.last_opened_at),
  };
}
