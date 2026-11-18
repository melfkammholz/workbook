import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_SETTINGS,
  type NoteFormat,
  type ReviewData,
  type Settings,
} from '@wb/shared';
import { COURSE_REFERENCE_TABLES, COURSE_TABLES, GLOBAL_KEYS, migrate } from '../migrations.js';
import type { Store } from '../store.js';
import { type SearchSource, type SearchHit, GLOBAL } from './shared.js';

export class SettingsPart {
  // ───────────────────────── settings ─────────────────────────

  /** The student's settings, the same from every view. */
  getSettings(this: Store): Settings {
    const raw = this.getRaw<Partial<Settings>>(GLOBAL, 'settings', {});
    return { ...DEFAULT_SETTINGS, ...raw };
  }

  saveSettings(this: Store, patch: Partial<Settings>): Settings {
    this.setRaw(GLOBAL, 'settings', { ...this.getSettings(), ...patch });
    return this.getSettings();
  }

  // ───────────────────────── assistant digests ─────────────────────────

  listDigests(this: Store): { id: string; resource: string | null; course: string | null; title: string; content: string; updatedAt: number }[] {
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
  writeDigest(this: Store, d: { id?: string; resource?: string | null; course?: string | null; title: string; content: string }): string {
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

  deleteDigest(this: Store, id: string): boolean {
    const had = this.all('SELECT 1 FROM assistant_digests WHERE id = ?', id).length > 0;
    this.run('DELETE FROM assistant_digests WHERE id = ?', id);
    return had;
  }

  /** The text of one page (0-based) of the current file of a material, once it has been read. */
  resourcePageText(this: Store, resource: string, pageIndex: number): string | null {
    const r = this.all(
      `SELECT t.text FROM resource_text t JOIN resources r ON r.id = t.resource JOIN resource_versions v ON v.id = r.current_version AND v.sha256 = t.version WHERE t.resource = ? AND t.page_index = ?`,
      resource,
      pageIndex,
    )[0];
    return r ? (r.text as string) : null;
  }

  /** Forgets all work in this course, and nothing else. */
  resetWork(this: Store): void {
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
  resetSettings(this: Store): void {
    this.run("DELETE FROM settings WHERE course = '' AND key = 'settings'");
    this.run('DELETE FROM tags');
  }

  /** Every highlight on a course's text, in every course: part of starting over, not of resetting one course. */
  resetHighlights(this: Store): void {
    this.tx(() => {
      for (const table of COURSE_REFERENCE_TABLES) this.run(`DELETE FROM ${table}`);
    });
  }

  /** A named value outside the student's settings and outside any course, e.g. the list of courses. */
  getValue<T>(this: Store, key: string, fallback: T): T {
    return this.getRaw(GLOBAL, key, fallback);
  }

  setValue(this: Store, key: string, value: unknown): void {
    this.setRaw(GLOBAL, key, value);
  }

  /** A value of this course, e.g. which exercise was open last. */
  getSettingRaw<T>(this: Store, key: string, fallback: T): T {
    return this.getRaw(this.course, key, fallback);
  }

  setSetting(this: Store, key: string, value: unknown): void {
    this.setRaw(this.course, key, value);
  }

  getRaw<T>(this: Store, course: string, key: string, fallback: T): T {
    const r = this.get('SELECT value FROM settings WHERE course = ? AND key = ?', course, key);
    if (!r) return fallback;
    try {
      return JSON.parse(r.value as string) as T;
    } catch {
      return fallback;
    }
  }

  setRaw(this: Store, course: string, key: string, value: unknown): void {
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
  search(this: Store, query: string, o: { courses?: string[]; materials?: boolean; limit?: number } = {}): SearchHit[] {
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

  reviewData(this: Store): Omit<ReviewData, 'checklists'> {
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
  importLegacy(this: Store, file: string): boolean {
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
              `INSERT INTO main.tickets (id, text, anchor, course, highlight_id, archived, answer, created_at, updated_at, archived_at)
               SELECT id, text, json_set(anchor, '$.course', ?), ?, highlight_id, archived, answer, created_at, updated_at, archived_at FROM legacy.tickets ORDER BY rowid`,
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
