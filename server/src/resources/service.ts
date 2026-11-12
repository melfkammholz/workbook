import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Resource, ResourceFields, ResourceSeries, ResourcesResponse, ResourceType } from '@wb/shared';
import type { Store } from '../db/store.js';

export class ResourceError extends Error {
  constructor(readonly code: 'unknown-resource' | 'unknown-series') {
    super(code);
  }
}

/** What a stored file is sent as. Anything else (HTML and SVG above all) is a download, never shown by the app's origin. */
const SAFE_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export function mimeOf(filename: string): string {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return SAFE_MIME[ext] ?? 'application/octet-stream';
}

const COLUMNS = `r.id, r.title, r.type, r.author, r.date, r.series, r.position, r.last_page, r.created_at, r.updated_at,
  v.sha256, v.filename, v.mime, v.size, v.uploaded_at,
  (SELECT group_concat(course, char(31)) FROM resource_courses WHERE resource = r.id) AS courses`;

type Row = Record<string, unknown>;

function toResource(r: Row): Resource {
  return {
    id: r.id as string,
    title: r.title as string,
    type: r.type as ResourceType,
    author: r.author as string,
    date: r.date as string,
    series: (r.series as string | null) ?? null,
    position: Number(r.position),
    lastPage: r.last_page === null ? null : Number(r.last_page),
    courses: r.courses ? (r.courses as string).split('\x1f').sort() : [],
    file: { sha256: r.sha256 as string, filename: r.filename as string, mime: r.mime as string, size: Number(r.size), uploadedAt: Number(r.uploaded_at) },
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/**
 * The student's materials: files with a title, type, author, date, courses and series. They belong to the student, not
 * to a course. The files are `<data>/files/<sha256>`, so the same file uploaded twice is stored once.
 */
export class Resources {
  readonly filesDir: string;

  constructor(
    private readonly store: Store,
    dataDir: string,
    private readonly courses: () => { id: string; title: string }[] = () => [],
    private readonly now: () => number = Date.now,
  ) {
    this.filesDir = path.join(dataDir, 'files');
  }

  private get sql() {
    return this.store.sql;
  }

  /** Every resource (of one course, if given) and every series, in one query each. */
  list(course?: string): ResourcesResponse {
    const rows = course
      ? this.sql.all(
          `SELECT ${COLUMNS} FROM resource_courses c JOIN resources r ON r.id = c.resource JOIN resource_versions v ON v.id = r.current_version
           WHERE c.course = ? ORDER BY r.series, r.position, r.created_at`,
          course,
        )
      : this.sql.all(`SELECT ${COLUMNS} FROM resources r JOIN resource_versions v ON v.id = r.current_version ORDER BY r.series, r.position, r.created_at`);
    const resources = rows.map(toResource);
    const used = new Set(resources.map((r) => r.series).filter((s): s is string => !!s));
    const series = (this.sql.all('SELECT id, title, type FROM resource_series ORDER BY title') as unknown as ResourceSeries[]).filter((s) => !course || used.has(s.id));
    return { resources, series, courses: this.courses() };
  }

  get(id: string): Resource {
    const row = this.sql.get(`SELECT ${COLUMNS} FROM resources r JOIN resource_versions v ON v.id = r.current_version WHERE r.id = ?`, id);
    if (!row) throw new ResourceError('unknown-resource');
    return toResource(row);
  }

  /** The path of a stored file, or null if the hash is not a hash or the file is gone. */
  filePath(sha256: string): string | null {
    if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
    const file = path.join(this.filesDir, sha256);
    return fs.existsSync(file) ? file : null;
  }

  /** A new resource from a file that is already stored. Several in one series go in order. */
  create(fields: ResourceFields, file: { sha256: string; filename: string; size: number }): Resource {
    const id = `r-${crypto.randomBytes(5).toString('hex')}`;
    const now = this.now();
    this.sql.tx(() => {
      const series = this.seriesFor(fields);
      const position = series ? Number(this.sql.get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM resources WHERE series = ?', series)!.p) : 0;
      this.sql.run(
        'INSERT INTO resources (id, title, type, author, date, series, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        id, fields.title, fields.type, fields.author, fields.date, series, position, now, now,
      );
      this.sql.run('INSERT INTO resource_versions (resource, sha256, filename, mime, size, uploaded_at) VALUES (?,?,?,?,?,?)', id, file.sha256, file.filename, mimeOf(file.filename), file.size, now);
      const version = Number(this.sql.get('SELECT last_insert_rowid() AS id')!.id);
      this.sql.run('UPDATE resources SET current_version = ? WHERE id = ?', version, id);
      this.setCourses(id, fields.courses);
    });
    return this.get(id);
  }

  update(id: string, fields: ResourceFields): Resource {
    const before = this.get(id);
    this.sql.tx(() => {
      const series = this.seriesFor(fields);
      const position = series === before.series ? before.position : series ? Number(this.sql.get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM resources WHERE series = ?', series)!.p) : 0;
      this.sql.run('UPDATE resources SET title = ?, type = ?, author = ?, date = ?, series = ?, position = ?, updated_at = ? WHERE id = ?', fields.title, fields.type, fields.author, fields.date, series, position, this.now(), id);
      this.setCourses(id, fields.courses);
      this.dropEmptySeries();
    });
    return this.get(id);
  }

  /** Removes the resource, and its file unless another resource uses the same one. */
  delete(id: string): void {
    this.get(id);
    const shas = (this.sql.all('SELECT DISTINCT sha256 FROM resource_versions WHERE resource = ?', id) as { sha256: string }[]).map((x) => x.sha256);
    this.sql.tx(() => {
      this.sql.run('DELETE FROM resources WHERE id = ?', id);
      this.dropEmptySeries();
    });
    for (const sha of shas) this.removeIfUnused(sha);
  }

  /** The viewer remembers where the student was. */
  setLastPage(id: string, page: number): void {
    this.get(id);
    this.sql.run('UPDATE resources SET last_page = ? WHERE id = ?', page, id);
  }

  /** Starts over: every resource and every file. Snapshots keep their own copies. */
  reset(): void {
    this.sql.tx(() => {
      for (const table of ['resources', 'resource_series']) this.sql.run(`DELETE FROM ${table}`);
    });
    fs.rmSync(this.filesDir, { recursive: true, force: true });
  }

  removeIfUnused(sha256: string): void {
    if (this.sql.get('SELECT 1 AS x FROM resource_versions WHERE sha256 = ? LIMIT 1', sha256)) return;
    const file = this.filePath(sha256);
    if (file) fs.rmSync(file, { force: true });
  }

  private setCourses(id: string, courses: string[]): void {
    this.sql.run('DELETE FROM resource_courses WHERE resource = ?', id);
    for (const c of new Set(courses)) this.sql.run('INSERT INTO resource_courses (resource, course) VALUES (?, ?)', id, c);
  }

  /** The series a resource goes into: a new one if the fields name one, else an existing one. */
  private seriesFor(f: ResourceFields): string | null {
    if (f.newSeries?.trim()) {
      const title = f.newSeries.trim();
      const found = this.sql.get('SELECT id FROM resource_series WHERE title = ? AND type = ?', title, f.type);
      if (found) return found.id as string;
      const id = `s-${crypto.randomBytes(5).toString('hex')}`;
      this.sql.run('INSERT INTO resource_series (id, title, type, created_at) VALUES (?,?,?,?)', id, title, f.type, this.now());
      return id;
    }
    if (f.series && !this.sql.get('SELECT 1 AS x FROM resource_series WHERE id = ?', f.series)) throw new ResourceError('unknown-series');
    return f.series;
  }

  private dropEmptySeries(): void {
    this.sql.run('DELETE FROM resource_series WHERE NOT EXISTS (SELECT 1 FROM resources WHERE series = resource_series.id)');
  }
}
