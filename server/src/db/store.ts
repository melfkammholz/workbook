import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
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
  type Question,
  type QuestionLink,
  type QuestionLinkKind,
  type AnswerBy,
  QUESTION_LINK_KINDS,
  type Anchor,
  type Change,
  type ChangeField,
  type ChangeRefKind,
  type ChangeValue,
  type CardPayload,
  type HighlightPayload,
  type CreatePayload,
  type Created,
  type QuestionPayload,
  type MergePayload,
  type MergeUndo,
  type WorkPayload,
  type WorkUndo,
  MIN_CONFIDENCE,
  fieldsConfidence,
  type ChangeStatus,
  type QuestionKind,
  QUESTION_KINDS,
  MAX_PENDING_CHANGES,
  type Tag,
  type TagKind,
  MAX_QUESTION,
  type ProgressEntry,
  type Reflection,
  type ReviewData,
  type Settings,
  type Stats,
  type Status,
  type StudentState,
  type TextQuote,
} from '@wb/shared';
import { announceChanges } from './changes-bus.js';
import { COURSE_REFERENCE_TABLES, COURSE_TABLES, GLOBAL_KEYS, migrate } from './migrations.js';

const DAY = 86_400_000;
/** Review intervals in days: how long "review later" waits, growing each time it is chosen again. */
const REVIEW_DAYS = [2, 4, 8, 16, 30];
/** An autosave only becomes a history entry if the last one is at least this old. */
const VERSION_MIN_GAP = 5 * 60_000;
const MAX_VERSIONS = 60;
/** One tick from the client is at most this many seconds, so a forgotten open tab cannot inflate time spent. */
const MAX_TICK_SECONDS = 120;

type Row = Record<string, unknown>;
export type SearchSource = 'note' | 'answer' | 'annotation' | 'question' | 'material';
/** What the index found; `anchor` says where it is (`kind` as in `Anchor`, plus `id` of the highlight, page item or question, and `slot`). */
export interface SearchHit {
  course: string | null;
  anchor: { kind: string; course?: string; id?: string; questionId?: string; target?: string; slot?: string; resource?: string; pageIndex?: number };
  source: SearchSource;
  snippet: string;
}
/** Course of the rows that belong to the student rather than to a course. */
const GLOBAL = '';

/**
 * What accepting a proposal that makes something needs from outside the database: the decks and the uploaded files
 * have services of their own. Set once by whoever owns them (`Store.useCreators`).
 */
export interface ChangeCreators {
  /** Makes a card or a page note; throws `Error` with a message for the student if it cannot. */
  create(kind: 'card' | 'highlight', payload: CreatePayload): Created;
  /** Takes away what `create` made. */
  remove(kind: 'card' | 'highlight', made: Created): void;
  /** True if what the payload points at (deck, material) is gone. */
  gone(kind: 'card' | 'highlight', payload: CreatePayload): boolean;
  /** The deck of each of these cards that still exists (card id to deck id). */
  cardDecks(ids: string[]): Map<string, string>;
}

/** The one SQLite file, shared by every view of it. */
class Db {
  creators: ChangeCreators | null = null;
  readonly raw: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private readonly optimizer: NodeJS.Timeout;
  inTx = false;

  constructor(readonly file: string) {
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

  /** Tells the inbox how to make cards and page notes (see `ChangeCreators`). */
  useCreators(c: ChangeCreators): void {
    this.db.creators = c;
  }

  /** The work of one course. Settings and other global values stay shared with this store. */
  forCourse(course: string): Store {
    return new Store(this.db, this.now, course);
  }

  /** A consistent copy of the whole file (every course), written while the app keeps running. */
  snapshotTo(file: string): void {
    this.db.raw.prepare('VACUUM INTO ?').run(file);
  }

  /**
   * Replaces the whole database with a copy made by `snapshotTo`, in place: this connection and its views stay open
   * and see the copy's rows. A copy from an older version is brought up to date.
   */
  async restoreFrom(file: string): Promise<void> {
    const source = new DatabaseSync(file, { readOnly: true });
    try {
      // In one step, so no write of the running app lands in between.
      await backup(source, this.db.file, { rate: 1_000_000_000 });
    } finally {
      source.close();
    }
    this.db.raw.exec('PRAGMA journal_mode = WAL');
    migrate(this.db.raw);
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
      questions: this.listQuestions({ course: this.course }),
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

  // ───────────────────────── questions ─────────────────────────

  /** Questions are the student's, in every course: a reset of a course's work keeps them. */
  listQuestions(filter: { course?: string; exercise?: string; resource?: string } = {}): Question[] {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.course !== undefined) {
      where.push('course = ?');
      params.push(filter.course);
    }
    if (filter.exercise !== undefined) {
      where.push("json_extract(anchor, '$.id') = ?");
      params.push(filter.exercise);
    }
    if (filter.resource !== undefined) {
      where.push("json_extract(anchor, '$.resource') = ?");
      params.push(filter.resource);
    }
    const rows = this.all(`SELECT * FROM questions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at, rowid`, ...params);
    const labels = this.tagLinks('question');
    const links = this.questionLinks(rows.map((r) => r.id as string), filter.course === undefined && filter.exercise === undefined && filter.resource === undefined);
    return rows.map((r) => rowToQuestion(r, labels.get(r.id as string) ?? [], links.get(r.id as string) ?? []));
  }

  getQuestion(id: string): Question | null {
    const r = this.get('SELECT * FROM questions WHERE id = ?', id);
    return r ? rowToQuestion(r, this.tagsOf('question', id), this.questionLinks([id], false).get(id) ?? []) : null;
  }

  /** The links of these questions (`all`: of every question, in one query), without those whose target is gone. */
  private questionLinks(ids: string[], all: boolean): Map<string, QuestionLink[]> {
    const rows = all
      ? this.all('SELECT question_id, kind, ref, created_at FROM question_links ORDER BY created_at, ref')
      : ids.length > 50
        ? this.all('SELECT question_id, kind, ref, created_at FROM question_links ORDER BY created_at, ref').filter((r) => ids.includes(r.question_id as string))
        : ids.flatMap((id) => this.all('SELECT question_id, kind, ref, created_at FROM question_links WHERE question_id = ? ORDER BY created_at, ref', id));
    const out = new Map<string, QuestionLink[]>();
    if (!rows.length) return out;
    const decks = this.db.creators?.cardDecks(rows.filter((r) => r.kind === 'card').map((r) => r.ref as string)) ?? new Map<string, string>();
    for (const r of rows) {
      const kind = r.kind as QuestionLinkKind;
      const ref = r.ref as string;
      const link: QuestionLink = { kind, ref, createdAt: Number(r.created_at) };
      if (kind === 'card') {
        const deck = decks.get(ref);
        if (!deck) continue;
        link.deck = deck;
      } else if (!this.targetExists(kind, ref)) continue;
      const q = r.question_id as string;
      (out.get(q) ?? out.set(q, []).get(q)!).push(link);
    }
    return out;
  }

  private targetExists(kind: 'note' | 'highlight', ref: string): boolean {
    if (kind === 'note') return this.get('SELECT 1 FROM pdf_pages WHERE id = ?', ref) !== undefined;
    return this.get('SELECT 1 FROM annotations WHERE id = ?', ref) !== undefined || this.get('SELECT 1 FROM pdf_annotations WHERE id = ?', ref) !== undefined;
  }

  /** Records that something was made from a question. False if the question or the target does not exist (nothing is stored). */
  addQuestionLink(id: string, kind: QuestionLinkKind, ref: string): boolean {
    if (!(QUESTION_LINK_KINDS as readonly string[]).includes(kind) || !ref || !this.get('SELECT 1 FROM questions WHERE id = ?', id)) return false;
    const exists = kind === 'card' ? (this.db.creators?.cardDecks([ref]).has(ref) ?? false) : this.targetExists(kind, ref);
    if (!exists) return false;
    this.run('INSERT OR IGNORE INTO question_links (question_id, kind, ref, created_at) VALUES (?,?,?,?)', id, kind, ref, this.now());
    return true;
  }

  removeQuestionLink(id: string, kind: string, ref: string): boolean {
    if (this.get('SELECT 1 FROM question_links WHERE question_id = ? AND kind = ? AND ref = ?', id, kind, ref) === undefined) return false;
    this.run('DELETE FROM question_links WHERE question_id = ? AND kind = ? AND ref = ?', id, kind, ref);
    return true;
  }

  addQuestion(q: { id?: string | undefined; text: string; anchor: Anchor; highlightId?: string | null; who?: string }): Question {
    const t = this.now();
    const id = q.id ?? `q-${randomUUID()}`;
    const course = 'course' in q.anchor ? q.anchor.course : '';
    this.tx(() => {
      this.run(
        `INSERT INTO questions (id, text, anchor, course, highlight_id, status, who, created_at, updated_at) VALUES (?,?,?,?,?,'open',?,?,?)`,
        id, q.text.trim().slice(0, MAX_QUESTION), JSON.stringify(q.anchor), course, q.highlightId ?? null, q.who ?? null, t, t,
      );
    });
    return this.getQuestion(id)!;
  }

  /** Reopening forgets when it was done; the answer, if any, stays. */
  updateQuestion(id: string, patch: { text?: string; status?: 'open' | 'done'; answer?: string | null; answerBy?: AnswerBy }): Question | null {
    const cur = this.getQuestion(id);
    if (!cur) return null;
    const t = this.now();
    const status = patch.status ?? cur.status;
    const doneAt = status === 'done' ? (cur.status === 'done' ? cur.doneAt : t) : null;
    // Reopening a merged duplicate is the student disagreeing: it stands on its own again.
    if (patch.status === 'open') this.run('UPDATE questions SET merged_into = NULL WHERE id = ?', id);
    const answer = patch.answer === undefined ? cur.answer : patch.answer?.trim() ? patch.answer : null;
    this.run(
      'UPDATE questions SET text = ?, status = ?, answer = ?, answer_by = ?, done_at = ?, updated_at = ? WHERE id = ?',
      patch.text === undefined ? cur.text : patch.text.trim().slice(0, MAX_QUESTION),
      status,
      answer,
      answer === null ? null : patch.answer === undefined ? cur.answerBy : (patch.answerBy ?? 'you'),
      doneAt,
      t,
      id,
    );
    return this.getQuestion(id);
  }

  /**
   * "Come back to" is an open question without text about the highlight or page `source` (its `highlight_id`):
   * open means to come back to it, done that it is cleared up. The question keeps its own anchor, so it outlives
   * the highlight.
   */
  reviews(): Map<string, AnnotationReview> {
    const out = new Map<string, AnnotationReview>();
    for (const r of this.all('SELECT highlight_id, status FROM questions WHERE highlight_id IS NOT NULL ORDER BY created_at DESC, rowid DESC')) out.set(r.highlight_id as string, r.status === 'done' ? 'resolved' : 'open');
    return out;
  }

  /** Sets, changes or (null) clears the come-back question of `source`; a cleared one with text of its own stays, unlinked. */
  setReview(source: string, review: AnnotationReview | null, anchor: Anchor): void {
    const cur = this.get('SELECT id, text FROM questions WHERE highlight_id = ? ORDER BY created_at, rowid LIMIT 1', source);
    if (review === null) {
      if (!cur) return;
      if (cur.text) this.run('UPDATE questions SET highlight_id = NULL WHERE id = ?', cur.id as string);
      else {
        this.run('DELETE FROM questions WHERE id = ?', cur.id as string);
        this.unlinkAll('question', cur.id as string);
      }
      return;
    }
    const status = review === 'resolved' ? 'done' : 'open';
    if (cur) this.updateQuestion(cur.id as string, { status });
    else {
      const q = this.addQuestion({ text: '', anchor, highlightId: source });
      if (status === 'done') this.updateQuestion(q.id, { status });
    }
  }

  private textAnchor(id: string): Anchor {
    const a = this.get('SELECT target, part, quote, prefix, suffix FROM annotations WHERE id = ? AND course = ?', id, this.course)!;
    return { kind: 'text', course: this.course, target: a.target as string, part: a.part as string, quote: a.quote as string, prefix: a.prefix as string, suffix: a.suffix as string };
  }

  deleteQuestion(id: string): boolean {
    const had = this.get('SELECT 1 FROM questions WHERE id = ?', id) !== undefined;
    if (had) {
      // Duplicates that were merged into it are open questions again.
      this.run("UPDATE questions SET merged_into = NULL, status = 'open', done_at = NULL WHERE merged_into = ?", id);
      this.run('DELETE FROM questions WHERE id = ?', id);
      this.unlinkAll('question', id);
    }
    return had;
  }

  // ───────────────────────── changes (the assistant inbox) ─────────────────────────

  private labelNames(ids: string[]): string[] {
    const names = new Map(this.listTags().map((l) => [l.id, l.name]));
    return ids.flatMap((i) => (names.has(i) ? [names.get(i)!] : []));
  }

  private setQuestionLabels(id: string, names: string[]): void {
    this.setTags('question', id, [...new Set(names.map((x) => x.trim()).filter(Boolean))].map((n) => this.ensureTag(n)));
  }

  /**
   * An assistant proposes changes to one question; they wait in the inbox. A pending proposal for the same field is
   * replaced. Returns what was filed, or why not.
   */
  proposeInner(who: string, questionId: string, p: { kind?: QuestionKind | null; labels?: string[]; answer?: string; text?: string; reason?: string }): { ids: string[] } | { error: string } {
    const q = this.getQuestion(questionId);
    if (!q) return { error: 'unknown question' };
    const wanted: [ChangeField, string | string[] | null, string | string[] | null][] = [];
    if (p.kind !== undefined) {
      if (p.kind !== null && !QUESTION_KINDS.includes(p.kind)) return { error: `type must be one of ${QUESTION_KINDS.join(', ')}` };
      if (p.kind !== q.kind) wanted.push(['kind', q.kind, p.kind]);
    }
    if (p.labels !== undefined) {
      const names = [...new Set(p.labels.map((x) => x.trim().slice(0, 60)).filter(Boolean))].slice(0, 8);
      const cur = this.labelNames(q.labels);
      const next = [...new Set([...cur, ...names])];
      if (next.length !== cur.length) wanted.push(['labels', cur, next]);
    }
    if (p.answer !== undefined && p.answer.trim()) wanted.push(['answer', q.answer, p.answer.trim().slice(0, 8000)]);
    if (p.text !== undefined && p.text.trim() && p.text.trim() !== q.text) wanted.push(['text', q.text, p.text.trim().slice(0, MAX_QUESTION)]);
    if (!wanted.length) return { error: 'nothing to change' };
    const pending = Number(this.get("SELECT COUNT(*) AS n FROM changes WHERE status = 'pending'")!.n);
    const replaced = wanted.filter(([f]) => this.get("SELECT 1 FROM changes WHERE status = 'pending' AND ref_kind = 'question' AND ref_id = ? AND field = ?", questionId, f)).length;
    if (pending - replaced + wanted.length > MAX_PENDING_CHANGES) return { error: 'inbox full: the student has to go through what is waiting first' };
    const t = this.now();
    const group = `g-${randomUUID()}`;
    const ids: string[] = [];
    this.tx(() => {
      for (const [field, before, after] of wanted) {
        this.run("DELETE FROM changes WHERE status = 'pending' AND ref_kind = 'question' AND ref_id = ? AND field = ?", questionId, field);
        const id = `ch-${randomUUID()}`;
        this.run(
          `INSERT INTO changes (id, who, ref_kind, ref_id, field, before, after, base_version, group_id, status, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`,
          id, who, 'question', questionId, field, JSON.stringify(before), JSON.stringify(after), q.updatedAt, group, (p.reason ?? '').slice(0, 500), t,
        );
        ids.push(id);
      }
    });
    return { ids };
  }

  /**
   * The assistant proposes making something: a card, a note on a PDF page, a question. It waits in the inbox as a
   * `create` change whose `after` is the payload. Returns the id of the change, or why not.
   */
  proposeCreateInner(who: string, kind: ChangeRefKind, payload: CreatePayload, reason = ''): { id: string } | { error: string } {
    if (Number(this.get("SELECT COUNT(*) AS n FROM changes WHERE status = 'pending'")!.n) >= MAX_PENDING_CHANGES) return { error: 'inbox full: the student has to go through what is waiting first' };
    const err = this.checkCreate(kind, payload);
    if (err) return { error: err };
    const id = `ch-${randomUUID()}`;
    this.run(
      `INSERT INTO changes (id, who, ref_kind, ref_id, field, before, after, base_version, group_id, status, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`,
      id, who, kind, '', 'create', null, JSON.stringify(payload), 0, `g-${randomUUID()}`, reason.slice(0, 500), this.now(),
    );
    return { id };
  }

  /**
   * The assistant proposes merging duplicates into `survivor`. One waits per survivor (a new one replaces it).
   */
  proposeMergeInner(who: string, survivor: string, duplicates: string[], opts: { text?: string; reason?: string } = {}): { id: string } | { error: string } {
    const ids = [...new Set(duplicates)];
    const err = this.checkMerge(survivor, ids);
    if (err) return { error: err };
    if (opts.text !== undefined && (!opts.text.trim() || opts.text.length > MAX_QUESTION)) return { error: 'text must be a question of reasonable length' };
    this.run("DELETE FROM changes WHERE status = 'pending' AND ref_kind = 'question' AND ref_id = ? AND field = 'merge'", survivor);
    if (Number(this.get("SELECT COUNT(*) AS n FROM changes WHERE status = 'pending'")!.n) >= MAX_PENDING_CHANGES) return { error: 'inbox full: the student has to go through what is waiting first' };
    const id = `ch-${randomUUID()}`;
    const payload: MergePayload = { duplicates: ids, ...(opts.text?.trim() ? { text: opts.text.trim() } : {}) };
    this.run(
      `INSERT INTO changes (id, who, ref_kind, ref_id, field, before, after, base_version, group_id, status, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`,
      id, who, 'question', survivor, 'merge', null, JSON.stringify(payload), 0, `g-${randomUUID()}`, (opts.reason ?? '').slice(0, 500), this.now(),
    );
    return { id };
  }

  /**
   * The assistant proposes the fields of a reference the parser was unsure about (see `flaggedWork`). One waits per
   * work; a new one replaces it.
   */
  proposeWorkInner(who: string, workId: string, p: WorkPayload, reason = ''): { id: string } | { error: string } {
    const row = this.get('SELECT * FROM works WHERE id = ?', workId);
    if (!row) return { error: 'unknown reference' };
    if (!this.isFlagged(row)) return { error: 'this reference is not flagged: only references the parser was unsure about can be fixed' };
    const clean = this.checkWork(p);
    if ('error' in clean) return clean;
    this.run("DELETE FROM changes WHERE status = 'pending' AND ref_kind = 'work' AND ref_id = ?", workId);
    if (Number(this.get("SELECT COUNT(*) AS n FROM changes WHERE status = 'pending'")!.n) >= MAX_PENDING_CHANGES) return { error: 'inbox full: the student has to go through what is waiting first' };
    const id = `ch-${randomUUID()}`;
    this.run(
      `INSERT INTO changes (id, who, ref_kind, ref_id, field, before, after, base_version, group_id, status, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`,
      id, who, 'work', workId, 'work', null, JSON.stringify(clean), 0, `g-${randomUUID()}`, reason.slice(0, 500), this.now(),
    );
    return { id };
  }

  /** The reference entries whose fields the parser could not read (the app shows their text as it is). Not the imported ones. */
  isFlagged(r: Row): boolean {
    if (Number(r.imported) === 1) return false;
    const stored = r.confidence === undefined || r.confidence === null ? -1 : Number(r.confidence);
    const c = stored >= 0 ? stored : fieldsConfidence({ title: r.title as string, authors: r.authors as string, year: r.year === null ? null : Number(r.year), venue: r.venue as string, doi: r.doi as string, url: r.url as string });
    return c < MIN_CONFIDENCE;
  }

  private checkWork(p: WorkPayload): WorkPayload | { error: string } {
    const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
    const title = s(p?.title, 300);
    const authors = s(p?.authors, 400);
    const venue = s(p?.venue, 300);
    const year = p?.year === null || p?.year === undefined ? null : p.year;
    if (!title) return { error: 'a reference needs a title' };
    if (year !== null && (!Number.isInteger(year) || year < 1000 || year > 2200)) return { error: 'year must be a four-digit number or null' };
    return { title, authors, year, venue };
  }

  private applyWork(c: Change, value: ChangeValue, undo: boolean): string | null {
    const row = this.get('SELECT * FROM works WHERE id = ?', c.ref.id);
    if (undo) {
      const u = c.before as WorkUndo | null;
      if (!row || !u) return null;
      this.run('UPDATE works SET title = ?, authors = ?, year = ?, venue = ?, confidence = ?, source = ?, updated_at = ? WHERE id = ?', u.title, u.authors, u.year, u.venue, u.confidence, u.source, u.updatedAt, c.ref.id);
      return null;
    }
    if (!row) return 'the reference is gone';
    const p = this.checkWork(value as WorkPayload);
    if ('error' in p) return p.error;
    const before: WorkUndo = { title: row.title as string, authors: row.authors as string, year: row.year === null ? null : Number(row.year), venue: row.venue as string, confidence: row.confidence === null ? -1 : Number(row.confidence), source: row.source as string, updatedAt: Number(row.updated_at) };
    this.run('UPDATE works SET title = ?, authors = ?, year = ?, venue = ?, confidence = 1, updated_at = ? WHERE id = ?', p.title, p.authors, p.year, p.venue, this.now(), c.ref.id);
    this.run('UPDATE changes SET before = ? WHERE id = ?', JSON.stringify(before), c.id);
    return null;
  }

  private checkMerge(survivor: string, duplicates: string[]): string | null {
    const s = this.getQuestion(survivor);
    if (!s) return 'the surviving question does not exist';
    if (s.mergedInto) return 'the surviving question was itself merged into another';
    if (!duplicates.length) return 'name at least one duplicate';
    if (duplicates.length > 20) return 'at most 20 duplicates';
    for (const d of duplicates) {
      if (d === survivor) return 'a question cannot be merged into itself';
      const q = this.getQuestion(d);
      if (!q) return `unknown question ${d}`;
      if (q.mergedInto) return `question ${d} was merged already`;
    }
    return null;
  }

  private applyMerge(c: Change, value: ChangeValue, undo: boolean): string | null {
    if (undo) {
      const u = c.before as MergeUndo | null;
      if (!u?.survivor) return null;
      const s = u.survivor;
      if (this.getQuestion(c.ref.id)) {
        this.run('UPDATE questions SET text = ?, answer = ?, answer_by = ?, status = ?, done_at = ?, updated_at = ? WHERE id = ?', s.text, s.answer, s.answer === null ? null : (s.answerBy ?? 'assistant'), s.status, s.doneAt, s.updatedAt, c.ref.id);
        this.setTags('question', c.ref.id, s.labels);
      }
      for (const d of u.duplicates) {
        if (!this.getQuestion(d.id)) continue;
        this.run('UPDATE questions SET merged_into = NULL, status = ?, done_at = ?, answer = ?, answer_by = ? WHERE id = ?', d.status, d.doneAt, d.answer, d.answer === null ? null : (d.answerBy ?? 'assistant'), d.id);
      }
      for (const l of u.links ?? []) {
        if (!this.getQuestion(l.from)) continue;
        if (!l.kept) this.run('DELETE FROM question_links WHERE question_id = ? AND kind = ? AND ref = ?', c.ref.id, l.kind, l.ref);
        this.run('INSERT OR IGNORE INTO question_links (question_id, kind, ref, created_at) VALUES (?,?,?,?)', l.from, l.kind, l.ref, l.createdAt);
      }
      return null;
    }
    const p = value as MergePayload;
    const dups = Array.isArray(p?.duplicates) ? [...new Set(p.duplicates.filter((x): x is string => typeof x === 'string'))] : [];
    const bad = this.checkMerge(c.ref.id, dups);
    if (bad) return bad;
    if (p.text !== undefined && (typeof p.text !== 'string' || !p.text.trim())) return 'the question needs text';
    const s = this.getQuestion(c.ref.id)!;
    const all = dups.map((d) => this.getQuestion(d)!);
    const moved: NonNullable<MergeUndo['links']> = [];
    const undo_: MergeUndo = {
      survivor: { text: s.text, answer: s.answer, answerBy: s.answerBy, status: s.status, doneAt: s.doneAt, updatedAt: s.updatedAt, labels: s.labels },
      duplicates: all.map((q) => ({ id: q.id, status: q.status, doneAt: q.doneAt, answer: q.answer, answerBy: q.answerBy, labels: q.labels })),
      links: moved,
    };
    // The survivor's answer wins; without one it takes the first duplicate's. Labels are the union, links move over.
    const donor = s.answer?.trim() ? s : all.find((q) => q.answer?.trim());
    const t = this.now();
    this.run('UPDATE questions SET text = ?, answer = ?, answer_by = ?, updated_at = ? WHERE id = ?', (p.text?.trim() ?? s.text).slice(0, MAX_QUESTION), donor?.answer ?? null, donor ? donor.answerBy : null, t, s.id);
    for (const d of all) {
      for (const l of this.all('SELECT kind, ref, created_at FROM question_links WHERE question_id = ?', d.id)) {
        const kind = l.kind as QuestionLinkKind;
        const ref = l.ref as string;
        const kept = this.get('SELECT 1 FROM question_links WHERE question_id = ? AND kind = ? AND ref = ?', s.id, kind, ref) !== undefined;
        moved.push({ from: d.id, kind, ref, createdAt: Number(l.created_at), kept });
        this.run('INSERT OR IGNORE INTO question_links (question_id, kind, ref, created_at) VALUES (?,?,?,?)', s.id, kind, ref, Number(l.created_at));
      }
      this.run('DELETE FROM question_links WHERE question_id = ?', d.id);
    }
    this.setTags('question', s.id, [...new Set(all.flatMap((q) => q.labels))]);
    for (const q of all) this.run("UPDATE questions SET merged_into = ?, status = 'done', done_at = ? WHERE id = ?", s.id, q.status === 'done' ? (q.doneAt ?? t) : t, q.id);
    this.run('UPDATE changes SET before = ? WHERE id = ?', JSON.stringify(undo_), c.id);
    return null;
  }

  private checkCreate(kind: ChangeRefKind, p: CreatePayload): string | null {
    const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
    if (kind === 'question') return text((p as QuestionPayload).text, MAX_QUESTION) && (p as QuestionPayload).anchor ? null : 'a question needs text and a place';
    if (kind === 'card') {
      const c = p as CardPayload;
      if (!text(c.front, 4000) || !text(c.back, 4000) && c.cardKind !== 'cloze' && c.cardKind !== 'quiz') return 'a card needs a front and a back';
      return 'id' in c.deck || ('title' in c.deck && text(c.deck.title, 120)) ? null : 'a card needs a deck';
    }
    const h = p as HighlightPayload;
    return text(h.quote, 2000) && typeof h.note === 'string' && Number.isInteger(h.pageIndex) && h.pageIndex >= 0 && text(h.resource, 100) ? null : 'a page note needs a material, a page and a quote';
  }

  // Each of these tells the open tabs that the inbox changed.
  proposeCreate(...a: Parameters<Store['proposeCreateInner']>): ReturnType<Store['proposeCreateInner']> {
    const r = this.proposeCreateInner(...a);
    announceChanges();
    return r;
  }
  proposeWork(...a: Parameters<Store['proposeWorkInner']>): ReturnType<Store['proposeWorkInner']> {
    const r = this.proposeWorkInner(...a);
    announceChanges();
    return r;
  }
  proposeMerge(...a: Parameters<Store['proposeMergeInner']>): ReturnType<Store['proposeMergeInner']> {
    const r = this.proposeMergeInner(...a);
    announceChanges();
    return r;
  }
  propose(...a: Parameters<Store['proposeInner']>): ReturnType<Store['proposeInner']> {
    const r = this.proposeInner(...a);
    announceChanges();
    return r;
  }
  decideChange(...a: Parameters<Store['decideChangeInner']>): ReturnType<Store['decideChangeInner']> {
    const r = this.decideChangeInner(...a);
    announceChanges();
    return r;
  }
  undoChange(...a: Parameters<Store['undoChangeInner']>): ReturnType<Store['undoChangeInner']> {
    const r = this.undoChangeInner(...a);
    announceChanges();
    return r;
  }
  acceptBatch(...a: Parameters<Store['acceptBatchInner']>): ReturnType<Store['acceptBatchInner']> {
    const r = this.acceptBatchInner(...a);
    announceChanges();
    return r;
  }
  undoBatch(...a: Parameters<Store['undoBatchInner']>): ReturnType<Store['undoBatchInner']> {
    const r = this.undoBatchInner(...a);
    announceChanges();
    return r;
  }

  /** Pending ones first, then the latest decided ones. Proposals that no longer fit (question gone, answer edited) expire. */
  listChanges(opts: { limit?: number } = {}): Change[] {
    this.expireStale();
    const rows = [
      ...this.all("SELECT * FROM changes WHERE status = 'pending' ORDER BY created_at, rowid"),
      ...this.all("SELECT * FROM changes WHERE status <> 'pending' ORDER BY COALESCE(decided_at, created_at) DESC, rowid DESC LIMIT ?", opts.limit ?? 60),
    ];
    return rows.map(rowToChange);
  }

  hasPendingChanges(): boolean {
    this.expireStale();
    return this.get("SELECT 1 FROM changes WHERE status = 'pending' LIMIT 1") !== undefined;
  }

  private expireStale(): void {
    const t = this.now();
    this.run("UPDATE changes SET status = 'expired', decided_at = ? WHERE status = 'pending' AND ref_kind = 'question' AND field <> 'create' AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.id = changes.ref_id)", t);
    // A creation only goes stale when what it points at (the deck, the material) is gone.
    for (const r of this.all("SELECT id, ref_kind, after FROM changes WHERE status = 'pending' AND field = 'create' AND ref_kind <> 'question'")) {
      if (this.db.creators?.gone(r.ref_kind as 'card' | 'highlight', JSON.parse(r.after as string) as CreatePayload)) this.run("UPDATE changes SET status = 'expired', decided_at = ? WHERE id = ?", t, r.id as string);
    }
    // A reference goes stale when it is gone or no longer unsure (looked up online, or fixed by the student).
    for (const r of this.all("SELECT id, ref_id FROM changes WHERE status = 'pending' AND field = 'work'")) {
      const w = this.get('SELECT * FROM works WHERE id = ?', r.ref_id as string);
      if (!w || !this.isFlagged(w)) this.run("UPDATE changes SET status = 'expired', decided_at = ? WHERE id = ?", t, r.id as string);
    }
    for (const r of this.all("SELECT id, ref_id, after FROM changes WHERE status = 'pending' AND field = 'merge'")) {
      const p = JSON.parse(r.after as string) as MergePayload;
      if (this.checkMerge(r.ref_id as string, p.duplicates)) this.run("UPDATE changes SET status = 'expired', decided_at = ? WHERE id = ?", t, r.id as string);
    }
    this.run("UPDATE changes SET status = 'expired', decided_at = ? WHERE status = 'pending' AND field IN ('answer','text') AND EXISTS (SELECT 1 FROM questions q WHERE q.id = changes.ref_id AND q.updated_at <> changes.base_version)", t);
  }

  /** Applies a proposal (`after` replaces the proposed value, for accept after editing) or turns it down. */
  decideChangeInner(id: string, decision: 'accept' | 'reject', opts: { feedback?: string; after?: ChangeValue } = {}): Change | { error: string } {
    this.expireStale();
    const r = this.get('SELECT * FROM changes WHERE id = ?', id);
    if (!r) return { error: 'unknown change' };
    const c = rowToChange(r);
    if (c.status !== 'pending') return { error: `already ${c.status}` };
    const t = this.now();
    const feedback = (opts.feedback ?? '').slice(0, 500);
    if (decision === 'reject') this.run("UPDATE changes SET status = 'rejected', feedback = ?, decided_at = ? WHERE id = ?", feedback, t, id);
    else {
      const after = opts.after === undefined ? c.after : opts.after;
      try {
        this.tx(() => {
          const err = this.applyChange(c, after);
          if (err) throw new ChangeError(err);
          this.run("UPDATE changes SET status = 'applied', after = ?, feedback = ?, decided_at = ? WHERE id = ?", JSON.stringify(after), feedback, t, id);
        });
      } catch (e) {
        if (e instanceof ChangeError) return { error: e.message };
        throw e;
      }
    }
    return rowToChange(this.get('SELECT * FROM changes WHERE id = ?', id)!);
  }

  /** Puts back what an applied change replaced. */
  undoChangeInner(id: string): Change | { error: string } {
    const r = this.get('SELECT * FROM changes WHERE id = ?', id);
    if (!r) return { error: 'unknown change' };
    const c = rowToChange(r);
    if (c.status !== 'applied') return { error: `is ${c.status}, not applied` };
    try {
      this.tx(() => {
        const err = this.applyChange(c, c.before, true);
        if (err) throw new ChangeError(err);
        this.run("UPDATE changes SET status = 'undone', decided_at = ? WHERE id = ?", this.now(), id);
      });
    } catch (e) {
      if (e instanceof ChangeError) return { error: e.message };
      throw e;
    }
    return rowToChange(this.get('SELECT * FROM changes WHERE id = ?', id)!);
  }

  /** Accepts several proposals as one batch (one undo). All or none: if one cannot be applied, nothing changes. */
  acceptBatchInner(ids: string[]): { batch: string; changes: Change[] } | { error: string } {
    this.expireStale();
    const unique = [...new Set(ids)];
    if (!unique.length) return { error: 'nothing to accept' };
    const batch = `b-${randomUUID()}`;
    try {
      this.tx(() => {
        for (const id of unique) {
          const r = this.get('SELECT * FROM changes WHERE id = ?', id);
          if (!r) throw new ChangeError('unknown change');
          const c = rowToChange(r);
          if (c.status !== 'pending') throw new ChangeError(`already ${c.status}`);
          const err = this.applyChange(c, c.after);
          if (err) throw new ChangeError(err);
          this.run("UPDATE changes SET status = 'applied', batch_id = ?, decided_at = ? WHERE id = ?", batch, this.now(), id);
        }
      });
    } catch (e) {
      if (e instanceof ChangeError) return { error: e.message };
      throw e;
    }
    return { batch, changes: unique.map((id) => rowToChange(this.get('SELECT * FROM changes WHERE id = ?', id)!)) };
  }

  /** Undoes every applied change of a batch, newest first. All or none. */
  undoBatchInner(batch: string): Change[] | { error: string } {
    const rows = this.all("SELECT * FROM changes WHERE batch_id = ? AND status = 'applied' ORDER BY decided_at DESC, rowid DESC", batch);
    if (!rows.length) return { error: 'nothing to undo in this batch' };
    try {
      this.tx(() => {
        for (const r of rows) {
          const c = rowToChange(r);
          const err = this.applyChange(c, c.before, true);
          if (err) throw new ChangeError(err);
          this.run("UPDATE changes SET status = 'undone', decided_at = ? WHERE id = ?", this.now(), c.id);
        }
      });
    } catch (e) {
      if (e instanceof ChangeError) return { error: e.message };
      throw e;
    }
    return rows.map((r) => rowToChange(this.get('SELECT * FROM changes WHERE id = ?', r.id as string)!));
  }

  /** Applies one change (or, with `undo`, takes it back): a field of a question, or a creation. */
  private applyChange(c: Change, value: ChangeValue, undo = false): string | null {
    if (c.field === 'merge') return this.applyMerge(c, value, undo);
    if (c.field === 'work') return this.applyWork(c, value, undo);
    if (c.field !== 'create') return this.applyField(c.ref.id, c.field, value as string | string[] | null, undo);
    const kind = c.ref.kind as Exclude<ChangeRefKind, 'work'>;
    if (undo) {
      const made = c.before as Created | null;
      if (!made?.id) return null;
      if (kind === 'question') this.deleteQuestion(made.id);
      else this.db.creators?.remove(kind, made);
      this.run("UPDATE changes SET ref_id = '' WHERE id = ?", c.id);
      return null;
    }
    const payload = value as CreatePayload;
    const bad = this.checkCreate(kind, payload);
    if (bad) return bad;
    let made: Created;
    if (kind === 'question') {
      const q = payload as QuestionPayload;
      made = { id: this.addQuestion({ text: q.text, anchor: q.anchor, who: c.who }).id };
    } else {
      if (!this.db.creators) return 'cannot be made here';
      try {
        made = this.db.creators.create(kind, payload);
      } catch (e) {
        return e instanceof Error ? e.message : 'could not be made';
      }
    }
    this.run('UPDATE changes SET ref_id = ?, before = ? WHERE id = ?', made.id, JSON.stringify(made), c.id);
    return null;
  }

  /** Kind and labels leave `updated_at` alone, so a proposal for the answer is not made stale by another one of the group. */
  private applyField(questionId: string, field: ChangeField, value: string | string[] | null, undo = false): string | null {
    const q = this.getQuestion(questionId);
    if (!q) return 'the question is gone';
    if (field === 'kind') {
      if (value !== null && !(QUESTION_KINDS as readonly string[]).includes(value as string)) return 'unknown type';
      this.run('UPDATE questions SET kind = ? WHERE id = ?', (value as string | null) ?? null, questionId);
    } else if (field === 'labels') {
      this.setQuestionLabels(questionId, Array.isArray(value) ? value : []);
    } else if (field === 'text') {
      if (typeof value !== 'string' || !value.trim()) return 'the question needs text';
      this.updateQuestion(questionId, { text: value });
    } else {
      // An answer does not settle the question: it stays open (or done) as the student left it.
      if (undo) this.updateQuestion(questionId, { answer: (value as string | null) ?? null });
      else this.updateQuestion(questionId, { answer: typeof value === 'string' ? value : null, answerBy: 'assistant' });
    }
    if (field === 'answer' || field === 'text') {
      // Another waiting proposal for the same question (answer and rewrite come in one group) stays current.
      const now = this.getQuestion(questionId)!.updatedAt;
      this.run("UPDATE changes SET base_version = ? WHERE status = 'pending' AND ref_kind = 'question' AND ref_id = ? AND field IN ('answer','text')", now, questionId);
    }
    return null;
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
    const reviews = this.reviews();
    const tags = this.tagLinks('highlight');
    return rows.map((r) => rowToAnnotation(r, reviews, tags.get(r.id as string) ?? []));
  }

  getAnnotation(id: string): Annotation | null {
    const r = this.get('SELECT * FROM annotations WHERE id = ? AND course = ?', id, this.course);
    return r ? rowToAnnotation(r, this.reviews(), this.tagsOf('highlight', id)) : null;
  }

  addAnnotation(a: AnnotationPlace & TextQuote & { id?: string; color: AnnotationColor; tags?: string[]; comment?: string; review?: AnnotationReview | null }): Annotation {
    const id = a.id ?? randomUUID();
    const t = this.now();
    this.tx(() => {
      this.run(
        'INSERT INTO annotations (course, id, target, part, quote, prefix, suffix, color, comment, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        this.course,
        id,
        a.target,
        a.part,
        a.quote,
        a.prefix,
        a.suffix,
        a.color,
        (a.comment ?? '').slice(0, 4000),
        t,
        t,
      );
      if (a.tags?.length) this.setTags('highlight', id, a.tags);
      if (a.review) this.setReview(id, a.review, this.textAnchor(id));
    });
    return this.getAnnotation(id)!;
  }

  /** Null when there is no such annotation. */
  updateAnnotation(id: string, patch: { color?: AnnotationColor; tags?: string[]; comment?: string; review?: AnnotationReview | null }): Annotation | null {
    const prev = this.getAnnotation(id);
    if (!prev) return null;
    const next = { ...prev, ...patch, comment: (patch.comment ?? prev.comment).slice(0, 4000) };
    this.tx(() => {
      this.run(
        'UPDATE annotations SET color = ?, comment = ?, updated_at = ? WHERE id = ? AND course = ?',
        next.color,
        next.comment,
        this.now(),
        id,
        this.course,
      );
      if (patch.tags) this.setTags('highlight', id, patch.tags);
      if (patch.review !== undefined) this.setReview(id, patch.review, this.textAnchor(id));
    });
    return this.getAnnotation(id);
  }

  deleteAnnotation(id: string): boolean {
    const prev = this.getAnnotation(id);
    if (!prev) return false;
    this.tx(() => {
      this.run('DELETE FROM annotations WHERE id = ? AND course = ?', id, this.course);
      this.unlinkAll('highlight', id);
    });
    return true;
  }

  resolvedMarkCount(): number {
    return Number(this.get("SELECT COUNT(*) AS n FROM questions q JOIN annotations a ON a.id = q.highlight_id AND a.course = q.course WHERE q.course = ? AND q.status = 'done' AND q.merged_into IS NULL", this.course)!.n);
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
    const raw = this.getRaw<Partial<Settings>>(GLOBAL, 'settings', {});
    return { ...DEFAULT_SETTINGS, ...raw };
  }

  saveSettings(patch: Partial<Settings>): Settings {
    this.setRaw(GLOBAL, 'settings', { ...this.getSettings(), ...patch });
    return this.getSettings();
  }

  // ───────────────────────── assistant digests ─────────────────────────

  listDigests(): { id: string; resource: string | null; course: string | null; title: string; content: string; updatedAt: number }[] {
    return this.all('SELECT * FROM assistant_digests ORDER BY updated_at DESC').map((r) => ({
      id: r.id as string,
      resource: (r.resource as string | null) ?? null,
      course: (r.course as string | null) ?? null,
      title: r.title as string,
      content: r.content as string,
      updatedAt: Number(r.updated_at),
    }));
  }

  /** One digest per id: writing again replaces it. */
  writeDigest(d: { id?: string; resource?: string | null; course?: string | null; title: string; content: string }): string {
    const id = d.id ?? `dg-${randomUUID()}`;
    this.run(
      'INSERT INTO assistant_digests (id, resource, course, title, content, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET resource=excluded.resource, course=excluded.course, title=excluded.title, content=excluded.content, updated_at=excluded.updated_at',
      id,
      d.resource ?? null,
      d.course ?? null,
      d.title,
      d.content,
      Date.now(),
    );
    return id;
  }

  deleteDigest(id: string): boolean {
    const had = this.all('SELECT 1 FROM assistant_digests WHERE id = ?', id).length > 0;
    this.run('DELETE FROM assistant_digests WHERE id = ?', id);
    return had;
  }

  /** The text of one page (0-based) of the current file of a material, once it has been read. */
  resourcePageText(resource: string, pageIndex: number): string | null {
    const r = this.all(
      `SELECT t.text FROM resource_text t JOIN resources r ON r.id = t.resource JOIN resource_versions v ON v.id = r.current_version AND v.sha256 = t.version WHERE t.resource = ? AND t.page_index = ?`,
      resource,
      pageIndex,
    )[0];
    return r ? (r.text as string) : null;
  }

  // ───────────────────────── tags ─────────────────────────

  /** The student's tags in their order. Global, like decks: a tag is not tied to a course. */
  listTags(): Tag[] {
    return this.all('SELECT id, name, color FROM tags ORDER BY sort, id').map((r) => ({ id: r.id as string, name: r.name as string, color: r.color as string }));
  }

  /** The tag of this name (any case), made if there is none. Returns its id. */
  ensureTag(name: string): string {
    name = name.trim().slice(0, 60);
    const found = this.get('SELECT id FROM tags WHERE name = ? COLLATE NOCASE', name);
    if (found) return found.id as string;
    return this.createTag(name, '').id;
  }

  createTag(name: string, color: string): Tag {
    const t = this.now();
    const id = `tg-${randomUUID()}`;
    const sort = Number(this.get('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM tags')!.n);
    this.run('INSERT INTO tags (id, name, color, sort, created_at, updated_at) VALUES (?,?,?,?,?,?)', id, name.trim().slice(0, 60), color, sort, t, t);
    return { id, name: name.trim().slice(0, 60), color };
  }

  /** Changes a tag's name or color. False when it is unknown or the name is another tag's (any case). */
  updateTag(id: string, patch: { name?: string; color?: string }): boolean {
    const cur = this.get('SELECT name, color FROM tags WHERE id = ?', id);
    if (!cur) return false;
    const name = (patch.name ?? (cur.name as string)).trim().slice(0, 60);
    if (!name) return false;
    if (this.get('SELECT 1 AS x FROM tags WHERE name = ? COLLATE NOCASE AND id <> ?', name, id)) return false;
    this.run('UPDATE tags SET name = ?, color = ?, updated_at = ? WHERE id = ?', name, patch.color ?? (cur.color as string), this.now(), id);
    return true;
  }

  /** Deletes a tag from everything it is on. */
  deleteTag(id: string): boolean {
    return this.tx(() => {
      const had = this.get('SELECT 1 AS x FROM tags WHERE id = ?', id) !== null;
      this.run('DELETE FROM tag_links WHERE tag_id = ?', id);
      this.run('DELETE FROM tags WHERE id = ?', id);
      return had;
    });
  }

  /** Everything `from` is on gets `into` instead; `from` goes. */
  mergeTags(from: string, into: string): boolean {
    if (from === into || !this.get('SELECT 1 AS x FROM tags WHERE id = ?', from) || !this.get('SELECT 1 AS x FROM tags WHERE id = ?', into)) return false;
    this.tx(() => {
      this.run('INSERT OR IGNORE INTO tag_links (tag_id, kind, ref, created_at) SELECT ?, kind, ref, created_at FROM tag_links WHERE tag_id = ?', into, from);
      this.deleteTag(from);
    });
    return true;
  }

  /** The ids of the tags on one thing, oldest link first. */
  tagsOf(kind: TagKind, ref: string): string[] {
    return this.all('SELECT tag_id FROM tag_links WHERE kind = ? AND ref = ? ORDER BY created_at, tag_id', kind, ref).map((r) => r.tag_id as string);
  }

  /** The tags on every thing of one kind: ref to tag ids. */
  tagLinks(kind: TagKind): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const r of this.all('SELECT tag_id, ref FROM tag_links WHERE kind = ? ORDER BY created_at, tag_id', kind)) {
      const ref = r.ref as string;
      (out.get(ref) ?? out.set(ref, []).get(ref)!).push(r.tag_id as string);
    }
    return out;
  }

  /** Makes the tags on one thing exactly these (unknown ids are skipped). */
  setTags(kind: TagKind, ref: string, ids: string[]): void {
    this.tx(() => {
      const keep = [...new Set(ids)];
      for (const id of this.tagsOf(kind, ref)) if (!keep.includes(id)) this.run('DELETE FROM tag_links WHERE tag_id = ? AND kind = ? AND ref = ?', id, kind, ref);
      const t = this.now();
      for (const id of keep) this.run('INSERT OR IGNORE INTO tag_links (tag_id, kind, ref, created_at) SELECT id, ?, ?, ? FROM tags WHERE id = ?', kind, ref, t, id);
    });
  }

  /** Takes every tag off one thing, for when it is deleted. */
  unlinkAll(kind: TagKind, ref: string): void {
    this.run('DELETE FROM tag_links WHERE kind = ? AND ref = ?', kind, ref);
  }

  /** Forgets all work in this course, and nothing else. */
  resetWork(): void {
    this.tx(() => {
      for (const table of COURSE_TABLES) {
        if (table === 'settings') continue;
        this.run(`DELETE FROM ${table} WHERE course = ?`, this.course);
      }
      this.run("DELETE FROM tag_links WHERE kind = 'highlight' AND ref NOT IN (SELECT id FROM annotations)");
      // Course '' is also where the student's own values live.
      this.run(`DELETE FROM settings WHERE course = ? AND key NOT IN (${GLOBAL_KEYS.map(() => '?').join(',')})`, this.course, ...GLOBAL_KEYS);
    });
  }

  /** Back to the defaults, as on the first start. */
  resetSettings(): void {
    this.run("DELETE FROM settings WHERE course = '' AND key = 'settings'");
    this.run('DELETE FROM tags');
  }

  /** Every highlight on a course's text, in every course: part of starting over, not of resetting one course. */
  resetHighlights(): void {
    this.tx(() => {
      for (const table of COURSE_REFERENCE_TABLES) this.run(`DELETE FROM ${table}`);
    });
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

  /**
   * Full-text search over the student's own text (notes, answers, highlights, questions) and the text of materials,
   * in the given courses (default: this one) and in what belongs to no course. The index is kept by triggers.
   */
  search(query: string, o: { courses?: string[]; materials?: boolean; limit?: number } = {}): SearchHit[] {
    const terms = query.match(/[\p{L}\p{N}_]+/gu);
    if (!terms) return [];
    const match = terms.map((t) => `"${t}"*`).join(' ');
    const courses = o.courses ?? [this.course];
    return this.all(
      `SELECT d.course, d.anchor, d.source, snippet(search, 0, '«', '»', '…', 12) AS snippet
       FROM search JOIN search_docs d ON d.id = search.rowid
       WHERE search MATCH ? AND ${o.materials ? "d.source = 'material'" : "d.source <> 'material'"} AND (d.course IS NULL OR d.course IN (${courses.map(() => '?').join(',') || "''"}))
       ORDER BY search.rank LIMIT ?`,
      match,
      ...courses,
      o.limit ?? 20,
    ).map((r) => ({ course: (r.course as string | null) ?? null, anchor: JSON.parse(r.anchor as string) as SearchHit['anchor'], source: r.source as SearchSource, snippet: r.snippet as string }));
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
    return { progress: state.progress, reflections: this.listReflections(), questions: state.questions, stats: state.stats, answers, notes };
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
          for (const table of [...COURSE_TABLES, ...COURSE_REFERENCE_TABLES]) {
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
          // Questions are global and carry their course in the anchor too.
          this.db.raw
            .prepare(
              `INSERT INTO main.questions (id, text, anchor, course, highlight_id, status, answer, created_at, updated_at, done_at)
               SELECT id, text, json_set(anchor, '$.course', ?), ?, highlight_id, status, answer, created_at, updated_at, done_at FROM legacy.questions ORDER BY rowid`,
            )
            .run(this.course, this.course);
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

class ChangeError extends Error {}

function rowToChange(r: Row): Change {
  const parse = (v: unknown) => (typeof v === 'string' ? (JSON.parse(v) as ChangeValue) : null);
  return {
    id: r.id as string,
    who: r.who as string,
    ref: { kind: r.ref_kind as ChangeRefKind, id: r.ref_id as string },
    field: r.field as ChangeField,
    before: parse(r.before),
    after: parse(r.after),
    group: r.group_id as string,
    batch: (r.batch_id as string | null) ?? null,
    status: r.status as ChangeStatus,
    reason: r.reason as string,
    feedback: r.feedback as string,
    createdAt: Number(r.created_at),
    decidedAt: r.decided_at === null ? null : Number(r.decided_at),
  };
}

function rowToQuestion(r: Row, labels: string[] = [], links: QuestionLink[] = []): Question {
  return {
    id: r.id as string,
    text: r.text as string,
    anchor: JSON.parse(r.anchor as string) as Anchor,
    course: r.course as string,
    highlightId: (r.highlight_id as string | null) ?? null,
    unplaced: Number(r.unplaced) === 1,
    status: r.status as 'open' | 'done',
    answer: (r.answer as string | null) ?? null,
    answerBy: r.answer ? ((r.answer_by as AnswerBy | null) ?? 'assistant') : null,
    links,
    kind: (r.kind as QuestionKind | null) ?? null,
    who: (r.who as string | null) ?? null,
    mergedInto: (r.merged_into as string | null) ?? null,
    labels,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    doneAt: r.done_at === null ? null : Number(r.done_at),
  };
}

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

function rowToAnnotation(r: Row, reviews: Map<string, AnnotationReview>, tags: string[]): Annotation {
  return {
    id: r.id as string,
    target: r.target as string,
    part: r.part as string,
    quote: r.quote as string,
    prefix: r.prefix as string,
    suffix: r.suffix as string,
    color: r.color as AnnotationColor,
    tags,
    comment: r.comment as string,
    review: reviews.get(r.id as string) ?? null,
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
