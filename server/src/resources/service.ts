import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Placed, Reanchored, StaleItems, UnplacedItems, AnnotationColor, AnnotationReview, NewPdfAnnotation, PageRect, PdfAnnotation, PdfPageFields, PdfPageItem, Resource, TocEdit, TocEditFields, ResourceFields, ResourceSeries, ResourcesResponse, ResourceType } from '@wb/shared';
import { MAX_TOC_LEVEL, MAX_TOC_TITLE } from '@wb/shared';
import type { Store } from '../db/store.js';

export class ResourceError extends Error {
  constructor(readonly code: 'unknown-resource' | 'unknown-series' | 'unknown-item' | 'same-file' | 'page-taken' | 'no-file') {
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
  (SELECT group_concat(course, char(31)) FROM resource_courses WHERE resource = r.id) AS courses,
  (SELECT COUNT(*) FROM resource_versions WHERE resource = r.id) AS versions,
  (SELECT COUNT(*) FROM pdf_annotations WHERE resource = r.id AND version <> v.sha256)
    + (SELECT COUNT(*) FROM pdf_pages WHERE resource = r.id AND version <> v.sha256)
    + (SELECT COUNT(*) FROM pdf_toc WHERE resource = r.id AND embedded_key IS NULL AND version <> v.sha256) AS stale,
  (SELECT COUNT(*) FROM pdf_annotations WHERE resource = r.id AND unplaced = 1)
    + (SELECT COUNT(*) FROM pdf_pages WHERE resource = r.id AND unplaced = 1)
    + (SELECT COUNT(*) FROM pdf_toc WHERE resource = r.id AND unplaced = 1) AS unplaced`;

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
    versions: Number(r.versions),
    stale: Number(r.stale),
    unplaced: Number(r.unplaced),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function toToc(r: Row): TocEdit {
  return {
    id: r.id as string,
    resource: r.resource as string,
    version: r.version as string,
    pageIndex: Number(r.page_index),
    fingerprint: r.fingerprint as string,
    title: r.title as string,
    level: r.level === null ? null : Number(r.level),
    hidden: Number(r.hidden) === 1,
    embeddedKey: (r.embedded_key as string | null) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function toPage(r: Row): PdfPageItem {
  let marks: string[] = [];
  try {
    const m = JSON.parse(r.marks as string) as unknown;
    if (Array.isArray(m)) marks = m.filter((x): x is string => typeof x === 'string');
  } catch {
    /* none */
  }
  return {
    id: r.id as string,
    resource: r.resource as string,
    version: r.version as string,
    pageIndex: Number(r.page_index),
    fingerprint: r.fingerprint as string,
    note: r.note as string,
    marks,
    review: (r.review as AnnotationReview | null) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function toHighlight(r: Row): PdfAnnotation {
  return {
    id: r.id as string,
    resource: r.resource as string,
    version: r.version as string,
    pageIndex: Number(r.page_index),
    rects: JSON.parse(r.rects as string) as PageRect[],
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

  // ───────────────────────── highlights in PDFs ─────────────────────────

  /** Every highlight of one resource, or of all of them, in the order they are on the page. */
  listHighlights(resource?: string): PdfAnnotation[] {
    const rows = resource
      ? this.sql.all('SELECT * FROM pdf_annotations WHERE resource = ? AND unplaced = 0 ORDER BY page_index, created_at, id', resource)
      : this.sql.all('SELECT * FROM pdf_annotations WHERE unplaced = 0 ORDER BY resource, page_index, created_at, id');
    return rows.map(toHighlight);
  }

  getHighlight(id: string): PdfAnnotation | null {
    const r = this.sql.get('SELECT * FROM pdf_annotations WHERE id = ?', id);
    return r ? toHighlight(r) : null;
  }

  addHighlight(resource: string, a: NewPdfAnnotation): PdfAnnotation {
    this.get(resource);
    const id = a.id ?? crypto.randomUUID();
    const t = this.now();
    this.sql.run(
      'INSERT INTO pdf_annotations (id, resource, version, page_index, rects, quote, prefix, suffix, color, label, comment, review, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, resource, a.version, a.pageIndex, JSON.stringify(a.rects), a.quote, a.prefix, a.suffix, a.color, a.label ?? null, (a.comment ?? '').slice(0, 4000), a.review ?? null, t, t,
    );
    return this.getHighlight(id)!;
  }

  updateHighlight(id: string, patch: { color?: AnnotationColor; label?: string | null; comment?: string; review?: AnnotationReview | null }): PdfAnnotation | null {
    const prev = this.getHighlight(id);
    if (!prev) return null;
    const next = { ...prev, ...patch };
    this.sql.run('UPDATE pdf_annotations SET color = ?, label = ?, comment = ?, review = ?, updated_at = ? WHERE id = ?', next.color, next.label, next.comment.slice(0, 4000), next.review, this.now(), id);
    return this.getHighlight(id);
  }

  deleteHighlight(id: string): boolean {
    if (!this.getHighlight(id)) return false;
    this.sql.run('DELETE FROM pdf_annotations WHERE id = ?', id);
    return true;
  }

  // ───────────────────────── notes on pages ─────────────────────────

  /** Every page item of one resource, or of all of them. */
  listPages(resource?: string): PdfPageItem[] {
    const rows = resource ? this.sql.all('SELECT * FROM pdf_pages WHERE resource = ? AND unplaced = 0 ORDER BY page_index', resource) : this.sql.all('SELECT * FROM pdf_pages WHERE unplaced = 0 ORDER BY resource, page_index');
    return rows.map(toPage);
  }

  getPage(id: string): PdfPageItem | null {
    const r = this.sql.get('SELECT * FROM pdf_pages WHERE id = ?', id);
    return r ? toPage(r) : null;
  }

  /**
   * Makes the page's item or changes it: what is given replaces what was there, the rest stays. `id` is only used when
   * the item is new.
   */
  savePage(resource: string, pageIndex: number, f: Partial<PdfPageFields> & Pick<PdfPageFields, 'version' | 'fingerprint'>): PdfPageItem {
    this.get(resource);
    const t = this.now();
    const prev = this.sql.get('SELECT * FROM pdf_pages WHERE resource = ? AND page_index = ? AND unplaced = 0', resource, pageIndex);
    if (!prev) {
      const id = f.id ?? crypto.randomUUID();
      this.sql.run(
        'INSERT INTO pdf_pages (id, resource, version, page_index, fingerprint, note, marks, review, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        id, resource, f.version, pageIndex, f.fingerprint, f.note ?? '', JSON.stringify([...new Set(f.marks ?? [])]), f.review ?? null, t, t,
      );
      return this.getPage(id)!;
    }
    const cur = toPage(prev);
    const marks = f.marks ? [...new Set(f.marks)] : cur.marks;
    this.sql.run('UPDATE pdf_pages SET note = ?, marks = ?, review = ?, updated_at = ? WHERE id = ?', f.note ?? cur.note, JSON.stringify(marks), f.review === undefined ? cur.review : f.review, t, cur.id);
    return this.getPage(cur.id)!;
  }

  /** Takes mark ids that no longer exist off every page, so no page keeps a dead one. Returns how many pages changed. */
  pruneMarks(keep: string[]): number {
    const ok = new Set(keep);
    let n = 0;
    this.sql.tx(() => {
      for (const r of this.sql.all('SELECT * FROM pdf_pages')) {
        const p = toPage(r);
        const marks = p.marks.filter((id) => ok.has(id));
        if (marks.length === p.marks.length) continue;
        this.sql.run('UPDATE pdf_pages SET marks = ? WHERE id = ?', JSON.stringify(marks), p.id);
        n++;
      }
    });
    return n;
  }

  // ───────────────────────── table of contents ─────────────────────────

  /** The student's entries and changes to the embedded outline, of one resource. */
  listToc(resource: string): TocEdit[] {
    return this.sql.all('SELECT * FROM pdf_toc WHERE resource = ? AND unplaced = 0 ORDER BY page_index, created_at, id', resource).map(toToc);
  }

  /**
   * Makes an entry or changes it. An embedded entry's change is found by its key, an own entry by `id`; what is given
   * replaces what was there.
   */
  saveToc(resource: string, f: TocEditFields): TocEdit {
    this.get(resource);
    const t = this.now();
    const title = (f.title ?? '').trim().slice(0, MAX_TOC_TITLE);
    const level = f.level === undefined || f.level === null ? null : Math.min(MAX_TOC_LEVEL, Math.max(0, Math.round(f.level)));
    const prev =
      f.embeddedKey != null
        ? this.sql.get('SELECT * FROM pdf_toc WHERE resource = ? AND embedded_key = ?', resource, f.embeddedKey)
        : f.id
          ? this.sql.get('SELECT * FROM pdf_toc WHERE resource = ? AND id = ? AND embedded_key IS NULL', resource, f.id)
          : undefined;
    if (!prev) {
      const id = f.id ?? crypto.randomUUID();
      this.sql.run(
        'INSERT INTO pdf_toc (id, resource, version, page_index, fingerprint, title, level, hidden, embedded_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        id, resource, f.version, f.pageIndex, f.fingerprint, title, level, f.hidden ? 1 : 0, f.embeddedKey ?? null, t, t,
      );
      return toToc(this.sql.get('SELECT * FROM pdf_toc WHERE id = ?', id)!);
    }
    const cur = toToc(prev);
    this.sql.run(
      'UPDATE pdf_toc SET title = ?, level = ?, hidden = ?, updated_at = ? WHERE id = ?',
      f.title === undefined ? cur.title : title,
      f.level === undefined ? cur.level : level,
      f.hidden === undefined ? (cur.hidden ? 1 : 0) : f.hidden ? 1 : 0,
      t,
      cur.id,
    );
    return toToc(this.sql.get('SELECT * FROM pdf_toc WHERE id = ?', cur.id)!);
  }

  deleteToc(resource: string, id: string): boolean {
    if (!this.sql.get('SELECT id FROM pdf_toc WHERE resource = ? AND id = ?', resource, id)) return false;
    this.sql.run('DELETE FROM pdf_toc WHERE id = ?', id);
    return true;
  }

  // ───────────────────────── new versions of a file ─────────────────────────

  /**
   * A new file for the resource: it becomes the current one. The old file goes unless some resource still uses it
   * (snapshots keep their own copies). The student's highlights and page items are placed on the new file afterwards,
   * by the browser (`reanchor`).
   */
  addVersion(id: string, file: { sha256: string; filename: string; size: number }): Resource {
    const before = this.get(id);
    if (before.file.sha256 === file.sha256) throw new ResourceError('same-file');
    const now = this.now();
    this.sql.tx(() => {
      this.sql.run('INSERT INTO resource_versions (resource, sha256, filename, mime, size, uploaded_at) VALUES (?,?,?,?,?,?)', id, file.sha256, file.filename, mimeOf(file.filename), file.size, now);
      const version = Number(this.sql.get('SELECT last_insert_rowid() AS id')!.id);
      this.sql.run('UPDATE resources SET current_version = ?, updated_at = ? WHERE id = ?', version, now, id);
    });
    this.removeIfSuperseded(before.file.sha256);
    return this.get(id);
  }

  /** Items made on an older file than the current one. */
  listStale(id: string): StaleItems {
    const version = this.get(id).file.sha256;
    return {
      version,
      highlights: this.sql.all('SELECT id, page_index, quote, prefix, suffix FROM pdf_annotations WHERE resource = ? AND version <> ?', id, version).map((r) => ({ id: r.id as string, pageIndex: Number(r.page_index), quote: r.quote as string, prefix: r.prefix as string, suffix: r.suffix as string })),
      pages: this.sql.all('SELECT id, page_index, fingerprint FROM pdf_pages WHERE resource = ? AND version <> ?', id, version).map((r) => ({ id: r.id as string, pageIndex: Number(r.page_index), fingerprint: r.fingerprint as string })),
      toc: this.sql.all('SELECT id, page_index, fingerprint FROM pdf_toc WHERE resource = ? AND embedded_key IS NULL AND version <> ?', id, version).map((r) => ({ id: r.id as string, pageIndex: Number(r.page_index), fingerprint: r.fingerprint as string })),
    };
  }

  /**
   * What the browser found out about the stale items: placed ones move to their new page and file, the rest are
   * `unplaced` (and on the new file, so nobody looks again). Returns what is left to fix.
   */
  reanchor(id: string, found: Reanchored): UnplacedItems {
    if (this.get(id).file.sha256 !== found.version) throw new ResourceError('no-file');
    const t = this.now();
    this.sql.tx(() => {
      // Page items first leave the one-per-page key, so moving them onto each other's pages cannot collide.
      for (const p of found.pages) this.sql.run('UPDATE pdf_pages SET unplaced = 1 WHERE id = ? AND resource = ?', p.id, id);
      for (const h of found.highlights) {
        if (h.place) this.sql.run('UPDATE pdf_annotations SET version = ?, page_index = ?, rects = ?, unplaced = 0, updated_at = ? WHERE id = ? AND resource = ?', found.version, h.place.pageIndex, JSON.stringify(h.place.rects), t, h.id, id);
        else this.sql.run('UPDATE pdf_annotations SET version = ?, unplaced = 1 WHERE id = ? AND resource = ?', found.version, h.id, id);
      }
      for (const p of found.pages) {
        if (p.pageIndex === null) {
          this.sql.run('UPDATE pdf_pages SET version = ? WHERE id = ? AND resource = ?', found.version, p.id, id);
          continue;
        }
        try {
          this.sql.run('UPDATE pdf_pages SET version = ?, page_index = ?, fingerprint = COALESCE(?, fingerprint), unplaced = 0, updated_at = ? WHERE id = ? AND resource = ?', found.version, p.pageIndex, p.fingerprint ?? null, t, p.id, id);
        } catch {
          // A page item made on the new file is already there: this one is left to the student.
          this.sql.run('UPDATE pdf_pages SET version = ? WHERE id = ? AND resource = ?', found.version, p.id, id);
        }
      }
      for (const e of found.toc) {
        if (e.pageIndex === null) this.sql.run('UPDATE pdf_toc SET version = ?, unplaced = 1 WHERE id = ? AND resource = ?', found.version, e.id, id);
        else this.sql.run('UPDATE pdf_toc SET version = ?, page_index = ?, fingerprint = COALESCE(?, fingerprint), unplaced = 0, updated_at = ? WHERE id = ? AND resource = ?', found.version, e.pageIndex, e.fingerprint ?? null, t, e.id, id);
      }
    });
    return this.listUnplaced(id);
  }

  /** What the new file could not place, to fix or drop. */
  listUnplaced(id: string): UnplacedItems {
    this.get(id);
    return {
      highlights: this.sql.all('SELECT * FROM pdf_annotations WHERE resource = ? AND unplaced = 1 ORDER BY page_index, created_at', id).map(toHighlight),
      pages: this.sql.all('SELECT * FROM pdf_pages WHERE resource = ? AND unplaced = 1 ORDER BY page_index', id).map(toPage),
      toc: this.sql.all('SELECT * FROM pdf_toc WHERE resource = ? AND unplaced = 1 ORDER BY page_index', id).map(toToc),
    };
  }

  /** Puts an unplaced item on a page of the current file. A page that has its own item already says no. */
  placeUnplaced(id: string, kind: 'highlight' | 'page' | 'toc', item: string, where: { pageIndex: number; rects?: Placed['rects']; fingerprint?: string }): void {
    const version = this.get(id).file.sha256;
    const t = this.now();
    this.unplacedRow(id, kind, item);
    if (kind === 'highlight') {
      if (!where.rects?.length) throw new ResourceError('unknown-item');
      this.sql.run('UPDATE pdf_annotations SET version = ?, page_index = ?, rects = ?, unplaced = 0, updated_at = ? WHERE id = ? AND resource = ? AND unplaced = 1', version, where.pageIndex, JSON.stringify(where.rects), t, item, id);
    } else if (kind === 'page') {
      if (this.sql.get('SELECT 1 AS x FROM pdf_pages WHERE resource = ? AND page_index = ? AND unplaced = 0', id, where.pageIndex)) throw new ResourceError('page-taken');
      this.sql.run('UPDATE pdf_pages SET version = ?, page_index = ?, fingerprint = COALESCE(?, fingerprint), unplaced = 0, updated_at = ? WHERE id = ? AND resource = ? AND unplaced = 1', version, where.pageIndex, where.fingerprint ?? null, t, item, id);
    } else {
      this.sql.run('UPDATE pdf_toc SET version = ?, page_index = ?, fingerprint = COALESCE(?, fingerprint), unplaced = 0, updated_at = ? WHERE id = ? AND resource = ? AND unplaced = 1', version, where.pageIndex, where.fingerprint ?? null, t, item, id);
    }
  }

  /** Throws an unplaced item away. */
  dropUnplaced(id: string, kind: 'highlight' | 'page' | 'toc', item: string): void {
    const table = kind === 'highlight' ? 'pdf_annotations' : kind === 'page' ? 'pdf_pages' : 'pdf_toc';
    this.unplacedRow(id, kind, item);
    this.sql.run(`DELETE FROM ${table} WHERE id = ?`, item);
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

  private unplacedRow(id: string, kind: 'highlight' | 'page' | 'toc', item: string): void {
    const table = kind === 'highlight' ? 'pdf_annotations' : kind === 'page' ? 'pdf_pages' : 'pdf_toc';
    if (!this.sql.get(`SELECT 1 AS x FROM ${table} WHERE id = ? AND resource = ? AND unplaced = 1`, item, id)) throw new ResourceError('unknown-item');
  }

  /** The file of a replaced version goes, unless some resource has it as its current file. */
  private removeIfSuperseded(sha256: string): void {
    if (this.sql.get('SELECT 1 AS x FROM resources r JOIN resource_versions v ON v.id = r.current_version WHERE v.sha256 = ? LIMIT 1', sha256)) return;
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
