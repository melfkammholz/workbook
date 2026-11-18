import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import {
  type Settings,
} from '@wb/shared';
import { migrate } from './migrations.js';
import { WorkPart } from './store/work.js';
import { TicketsPart } from './store/tickets.js';
import { TodosPart } from './store/todos.js';
import { ChangesPart } from './store/changes.js';
import { AnnotationsPart } from './store/annotations.js';
import { TagsPart } from './store/tags.js';
import { SettingsPart } from './store/settings.js';
import { DAY, GLOBAL } from './store/shared.js';
import type { ChangeCreators, Row, SearchHit, SearchSource } from './store/shared.js';
export type { ChangeCreators, SearchHit, SearchSource } from './store/shared.js';

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
  readonly db: Db;
  private readonly owner: boolean;

  constructor(file: string | Db, readonly now: () => number = Date.now, readonly course: string = GLOBAL) {
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
  tx<T>(fn: () => T): T {
    return this.db.tx(fn);
  }

  all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }
  get(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }
  run(sql: string, ...params: SQLInputValue[]): void {
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

}

export interface Store extends WorkPart, TicketsPart, TodosPart, ChangesPart, AnnotationsPart, TagsPart, SettingsPart {}

// The methods of each area live in their own file; they join the class here.
for (const part of [WorkPart, TicketsPart, TodosPart, ChangesPart, AnnotationsPart, TagsPart, SettingsPart]) {
  for (const name of Object.getOwnPropertyNames(part.prototype)) {
    if (name !== 'constructor') Object.defineProperty(Store.prototype, name, Object.getOwnPropertyDescriptor(part.prototype, name)!);
  }
}
